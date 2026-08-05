// The issues app's reference scanner.
//
// This is the app half of the storage contract: `platform-storage` owns the
// registry, the ledger and the delete gate; this file owns the only thing the
// platform cannot know — which of *this* app's tables can hold a file url.
//
// The queries are the ones that lived in `lib/blob-refs.ts` before Phase 7, kept
// deliberately intact: they are the code that has been protecting production
// files, and a rewrite alongside a registry change would have made any
// regression impossible to attribute.
//
// Six surfaces carry urls: issue / task / project descriptions, project
// summaries, comments, project-update bodies, and attachment rows (which
// reference a file by exact url rather than by embedding it).
//
// TRASHED ROWS COUNT. Both queries include soft-deleted rows on purpose — an
// item in the recycle bin can be restored, so its files are still in use. This
// is the property that makes trash-restore and undo safe against cleanup.
//
// FAILING IS THE POINT. Neither method may swallow an error and report "no
// references": `platform-storage` treats a rejection as "cannot delete", which
// is the safe answer, and a caught error would turn it into the unsafe one.

import { sql } from 'drizzle-orm'
import {
  extractUploadedUrls,
  isUploadedAsset,
  type Executor,
  type ReferenceScanner,
  type ScannedReference,
} from '@blackcode/platform-storage'
import { APP_SLUG } from '@/lib/app'
import { attachments, comments, issues, projectUpdates, projects, tasks } from '@/lib/db/schema'

interface Row {
  [k: string]: unknown
}

export const issuesReferenceScanner: ReferenceScanner = {
  app: APP_SLUG,

  async scanWorkspace(db: Executor, workspaceId: number): Promise<Map<string, ScannedReference[]>> {
    const map = new Map<string, ScannedReference[]>()
    const add = (url: string, ref: ScannedReference) => {
      const list = map.get(url)
      if (list) list.push(ref)
      else map.set(url, [ref])
    }
    const scan = (text: unknown, ref: ScannedReference) => {
      for (const url of extractUploadedUrls(text as string)) add(url, ref)
    }

    const [issueRows, taskRows, projectRows, commentRows, updates, atts] = await Promise.all([
      db.execute(sql`SELECT id, seq, title, description, deleted_at FROM ${issues} WHERE workspace_id = ${workspaceId}`),
      db.execute(sql`SELECT id, seq, name, description, deleted_at FROM ${tasks} WHERE workspace_id = ${workspaceId}`),
      db.execute(sql`SELECT id, seq, name, summary, description, deleted_at FROM ${projects} WHERE workspace_id = ${workspaceId}`),
      db.execute(sql`SELECT id, content, parent_type FROM ${comments} WHERE workspace_id = ${workspaceId}`),
      db.execute(sql`SELECT id, body FROM ${projectUpdates} WHERE workspace_id = ${workspaceId}`),
      db.execute(sql`SELECT id, issue_id, file_url, filename FROM ${attachments} WHERE workspace_id = ${workspaceId}`),
    ])

    for (const r of issueRows.rows as Row[]) {
      scan(r.description, { type: 'issue', id: Number(r.id), seq: r.seq as number | null, label: (r.title as string) ?? null, trashed: r.deleted_at != null })
    }
    for (const r of taskRows.rows as Row[]) {
      scan(r.description, { type: 'task', id: Number(r.id), seq: r.seq as number | null, label: (r.name as string) ?? null, trashed: r.deleted_at != null })
    }
    for (const r of projectRows.rows as Row[]) {
      const ref: ScannedReference = { type: 'project', id: Number(r.id), seq: r.seq as number | null, label: (r.name as string) ?? null, trashed: r.deleted_at != null }
      scan(r.summary, ref)
      scan(r.description, ref)
    }
    for (const r of commentRows.rows as Row[]) {
      scan(r.content, { type: 'comment', id: Number(r.id), seq: null, label: null, trashed: false })
    }
    for (const r of updates.rows as Row[]) {
      scan(r.body, { type: 'project_update', id: Number(r.id), seq: null, label: null, trashed: false })
    }
    for (const r of atts.rows as Row[]) {
      // An attachment row references its file by exact URL.
      const url = r.file_url as string
      if (url && isUploadedAsset(url)) {
        add(url, { type: 'attachment', id: Number(r.id), seq: r.issue_id as number | null, label: (r.filename as string) ?? null, trashed: false })
      }
    }

    return map
  },

  // Across ALL workspaces, deliberately: the same uploaded url can be
  // copy-pasted between workspaces, and we must never delete a blob anything
  // still points at.
  //
  // strpos() (not LIKE) so the url is matched as a literal substring — filenames
  // may contain `_`/`%`, which LIKE would treat as wildcards.
  async isUrlReferenced(db: Executor, url: string): Promise<boolean> {
    const res = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM ${issues}          WHERE strpos(coalesce(description, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${tasks}           WHERE strpos(coalesce(description, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${projects}        WHERE strpos(coalesce(description, ''), ${url}) > 0
                                         OR strpos(coalesce(summary, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${comments}        WHERE strpos(coalesce(content, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${projectUpdates} WHERE strpos(coalesce(body, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${attachments}     WHERE file_url = ${url}
      ) AS referenced
    `)
    return Boolean((res.rows[0] as Row | undefined)?.referenced)
  },
}
