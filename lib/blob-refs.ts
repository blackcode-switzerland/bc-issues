// Reference engine for uploaded files — the safety core of storage cleanup.
//
// A file uploaded through our pipeline (Vercel Blob in prod, /uploads in dev) is
// referenced by its URL appearing inside content: the HTML body of an issue /
// task / project description, a project summary, a comment, or a project-update
// body, or as an attachment row's file_url. Nothing tracks these references at
// write time — they live inside the text — so to know whether a file is still
// in use we scan the content.
//
// Two guarantees this module exists to provide:
//   1. The Storage page can show, per file, exactly what still references it.
//   2. Deletion is gated by isUrlReferencedAnywhere() — a *live* scan run at the
//      moment of deletion — so a file is only ever deletable when nothing points
//      at it. This is what makes manual cleanup safe: undo, trash-restore, and
//      copy-pasted-into-another-place all keep a reference alive, and the scan
//      sees it. We deliberately include soft-deleted (trashed) rows: an item in
//      the recycle bin can be restored, so its files must count as in use.
//
// The "is this one of our URLs" rule is imported from rich-text.ts (the same
// recognizer used to embed files), so embedding and cleanup can never disagree.

import { sql } from 'drizzle-orm'
import { isUploadedAsset } from './rich-text'

// Lazily import the db client so this module stays import-side-effect-free: the
// pure extractUploadedUrls() can be used (and unit-tested) without a configured
// DATABASE_URL. The query functions below pull it in on first call.
async function getDb() {
  return (await import('./db/client')).db
}

// Matches absolute (blob) URLs and local /uploads paths. The character class
// stops at whitespace and the delimiters that wrap a URL in Markdown/HTML
// (quotes, angle brackets, parentheses, square brackets), so a URL embedded as
// ![](url), <img src="url">, or data-file-url="url" is captured cleanly. Our
// stored URLs only ever contain [A-Za-z0-9._/:-] plus the blob host, so this
// never over-captures.
const URL_RE = /(?:https?:\/\/[^\s"'<>()[\]]+|\/uploads\/[^\s"'<>()[\]]+)/gi

// Pull every distinct our-origin upload URL out of a body of text/HTML.
export function extractUploadedUrls(text: string | null | undefined): string[] {
  if (!text) return []
  const found = new Set<string>()
  const matches = text.match(URL_RE)
  if (matches) {
    for (let m of matches) {
      // Trim trailing prose punctuation that can cling to a bare URL.
      m = m.replace(/[.,;:!?]+$/, '')
      if (isUploadedAsset(m)) found.add(m)
    }
  }
  return [...found]
}

export type RefType = 'issue' | 'task' | 'project' | 'comment' | 'project_update' | 'attachment'

export interface Reference {
  type: RefType
  // Internal row id of the referencing entity.
  id: number
  // Workspace #number where one exists (issue/task/project); null otherwise.
  seq: number | null
  // A short human label (title/name) where cheaply available.
  label: string | null
  // True when the referencing row is in the recycle bin (still restorable).
  trashed: boolean
}

interface Row {
  [k: string]: unknown
}

// Build url → references[] for an entire workspace, scanning every content
// surface INCLUDING trashed rows. Used by the Storage page to show each file's
// usage. O(total content size) — one pass per table, URL extraction per row.
export async function computeWorkspaceReferences(
  workspaceId: number
): Promise<Map<string, Reference[]>> {
  const map = new Map<string, Reference[]>()
  const add = (url: string, ref: Reference) => {
    const list = map.get(url)
    if (list) list.push(ref)
    else map.set(url, [ref])
  }
  const scan = (text: unknown, ref: Reference) => {
    for (const url of extractUploadedUrls(text as string)) add(url, ref)
  }

  const db = await getDb()
  const [issues, tasks, projects, comments, updates, atts] = await Promise.all([
    db.execute(sql`SELECT id, seq, title, description, deleted_at FROM issues WHERE workspace_id = ${workspaceId}`),
    db.execute(sql`SELECT id, seq, name, description, deleted_at FROM tasks WHERE workspace_id = ${workspaceId}`),
    db.execute(sql`SELECT id, seq, name, summary, description, deleted_at FROM projects WHERE workspace_id = ${workspaceId}`),
    db.execute(sql`SELECT id, content, parent_type FROM comments WHERE workspace_id = ${workspaceId}`),
    db.execute(sql`SELECT id, body FROM project_updates WHERE workspace_id = ${workspaceId}`),
    db.execute(sql`SELECT id, issue_id, file_url, filename FROM attachments WHERE workspace_id = ${workspaceId}`),
  ])

  for (const r of issues.rows as Row[]) {
    const ref: Reference = { type: 'issue', id: Number(r.id), seq: r.seq as number | null, label: (r.title as string) ?? null, trashed: r.deleted_at != null }
    scan(r.description, ref)
  }
  for (const r of tasks.rows as Row[]) {
    const ref: Reference = { type: 'task', id: Number(r.id), seq: r.seq as number | null, label: (r.name as string) ?? null, trashed: r.deleted_at != null }
    scan(r.description, ref)
  }
  for (const r of projects.rows as Row[]) {
    const ref: Reference = { type: 'project', id: Number(r.id), seq: r.seq as number | null, label: (r.name as string) ?? null, trashed: r.deleted_at != null }
    scan(r.summary, ref)
    scan(r.description, ref)
  }
  for (const r of comments.rows as Row[]) {
    const ref: Reference = { type: 'comment', id: Number(r.id), seq: null, label: null, trashed: false }
    scan(r.content, ref)
  }
  for (const r of updates.rows as Row[]) {
    const ref: Reference = { type: 'project_update', id: Number(r.id), seq: null, label: null, trashed: false }
    scan(r.body, ref)
  }
  for (const r of atts.rows as Row[]) {
    // An attachment row references its file by exact URL.
    const url = r.file_url as string
    if (url && isUploadedAsset(url)) {
      add(url, { type: 'attachment', id: Number(r.id), seq: r.issue_id as number | null, label: (r.filename as string) ?? null, trashed: false })
    }
  }

  return map
}

// Authoritative delete-time safety gate: is this URL referenced ANYWHERE in the
// system right now? Scans every content surface (including trashed rows) plus
// the attachments table, across ALL workspaces — deliberately broader than one
// workspace, because the same uploaded URL can be copy-pasted across workspaces
// and we must never delete a blob that anything still points at.
//
// strpos() (not LIKE) is used so the URL is matched as a literal substring —
// filenames may contain `_`/`%`, which LIKE would treat as wildcards.
export async function isUrlReferencedAnywhere(url: string): Promise<boolean> {
  if (!url) return true // unknown → treat as referenced (fail safe)
  const db = await getDb()
  const res = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM issues          WHERE strpos(coalesce(description, ''), ${url}) > 0
      UNION ALL
      SELECT 1 FROM tasks           WHERE strpos(coalesce(description, ''), ${url}) > 0
      UNION ALL
      SELECT 1 FROM projects        WHERE strpos(coalesce(description, ''), ${url}) > 0
                                       OR strpos(coalesce(summary, ''), ${url}) > 0
      UNION ALL
      SELECT 1 FROM comments        WHERE strpos(coalesce(content, ''), ${url}) > 0
      UNION ALL
      SELECT 1 FROM project_updates WHERE strpos(coalesce(body, ''), ${url}) > 0
      UNION ALL
      SELECT 1 FROM attachments     WHERE file_url = ${url}
    ) AS referenced
  `)
  return Boolean((res.rows[0] as Row)?.referenced)
}
