// GET /api/meta — the bootstrap call for agents (and humans).
//
// Returns, in one round-trip:
//   - user        : who you are + how you authenticated (via)
//   - active_workspace : the resolved workspace (?ws= override, else the user's
//                        active workspace; null if none / not a member)
//   - workspaces  : EVERY workspace the caller belongs to (id, name, slug, role,
//                   is_active) — so an agent can pick the right target BY NAME
//                   instead of guessing an opaque numeric id
//   - vocabulary  : the valid issue/project enum values (with labels + colors),
//                   straight from lib/work-items — so an agent never guesses a
//                   status/priority
//   - labels / projects / members : the active workspace's entities, to ground on
//
// Authenticated (session or bk_live_ token). Pair with GET /api/openapi.json for
// the full surface.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, publicProject } from '@/lib/api'
import { resolveAuth } from '@/lib/auth/resolve'
import { getUserById } from '@/lib/db/queries/users'
import { getWorkspaceForUser, listWorkspaceMembers, listMyWorkspaces } from '@/lib/db/queries/workspaces'
import { listProjectsInWorkspace } from '@/lib/db/queries/projects'
import { listLabelsInWorkspace } from '@/lib/db/queries/labels'
import { isSuperAdmin } from '@/lib/auth/whitelist'
import {
  ISSUE_STATUSES,
  ISSUE_PRIORITIES,
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  PROJECT_UPDATE_STATUSES,
} from '@/lib/work-items'

export const GET = apiHandler(async (request: NextRequest) => {
  const auth = await resolveAuth(request)
  if (!auth) throw Errors.unauthorized()
  const fresh = await getUserById(auth.user.id)
  if (!fresh) throw Errors.notFound('user')

  // Workspace: explicit ?ws=<slug|id> override, else the caller's active one.
  // getWorkspaceForUser returns null if it doesn't exist or the caller isn't a
  // member (no existence leak).
  const wsParam = request.nextUrl.searchParams.get('ws')
  const slugOrId = wsParam ?? (fresh.active_workspace_id ? String(fresh.active_workspace_id) : null)
  const workspace = slugOrId ? await getWorkspaceForUser(slugOrId, auth.user.id) : null

  // Every workspace the caller belongs to — the disambiguation list an agent
  // needs to target the right tenant by (human-readable) name/slug.
  const myWorkspaces = await listMyWorkspaces(auth.user.id)

  const [labels, projects, members] = workspace
    ? await Promise.all([
        listLabelsInWorkspace(workspace.id),
        listProjectsInWorkspace(workspace.id, {}),
        listWorkspaceMembers(workspace.id),
      ])
    : [[], [], []]

  return NextResponse.json({
    user: {
      id: fresh.id,
      email: fresh.email,
      name: fresh.name,
      avatar_url: fresh.avatar_url,
      via: auth.via,
      is_super_admin: isSuperAdmin(fresh.email),
    },
    active_workspace: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          role: workspace.member_role,
        }
      : null,
    // Every workspace you belong to. Pick the target by `name`/`slug` — do NOT
    // rely on the numeric `id` to know which team it is. Address a workspace in
    // routes as /api/workspaces/{slug}/… (or pass ?ws=<slug> to this endpoint).
    workspaces: myWorkspaces.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      role: w.member_role,
      is_active: workspace ? w.id === workspace.id : false,
    })),
    vocabulary: {
      issue_statuses: ISSUE_STATUSES,
      issue_priorities: ISSUE_PRIORITIES,
      project_statuses: PROJECT_STATUSES,
      project_priorities: PROJECT_PRIORITIES,
      project_update_health: PROJECT_UPDATE_STATUSES,
    },
    // The `id` of a project/task/issue is its workspace #number (the value shown
    // in the app), unique per workspace. Address everything by it. Breaking
    // changes are listed in docs/api-changelog.md.
    conventions: {
      recommended_interface:
        'For agents we recommend the bk CLI (npm install -g @blackcode_sa/bc-issues, then bk login) over calling this HTTP API directly — it wraps the same endpoints but handles auth, JSON encoding, pagination, file upload+embed and stable exit codes, so automated runs are more reliable. The API stays supported; use it directly when the CLI cannot cover a case. Recommendation, not a requirement.',
      id: 'workspace-scoped number (the #N shown in the UI); address items by it. References back to a work item (comment.parent_id, attachment.issue_id, project_update.project_id) are this #number too — the internal db id is never exposed',
      workspace_selection:
        'Before creating anything, confirm which workspace you are writing to. The `workspaces` array above lists every workspace you belong to; match the user\'s intent to a workspace by its `name`/`slug`, not its numeric `id` (ids are opaque and easy to confuse). Then target it as /api/workspaces/{slug}/… — the {ws} path segment accepts the slug or the id, but prefer the slug. `active_workspace` is only a default; it is NOT necessarily where the user means to write.',
      changelog: '/docs/api-changelog.md',
      rich_text: 'description/comment/body fields accept Markdown or HTML, stored as sanitized HTML. GFM/HTML tables render natively; embed video/audio by uploading it (raw <iframe> and external media are stripped)',
      file_embeds:
        'POST a file to /api/upload (multipart field "file") -> { url }, then reference it in a body as ![name](url) for images or [name](url) for any other file; uploaded urls render inline (preview/player/download card). Max 100MB.',
      storage:
        'Uploaded files are tracked per workspace. The owner can review/clean them: GET /api/workspaces/{ws}/storage lists every file with what references it + total usage; DELETE /api/workspaces/{ws}/storage/{id} removes an orphan (refused with 409 if anything, including trashed items, still references it). Cleanup is also automatic on terminal deletes: hard-deleting a comment/reply or purging an item from Trash frees the files that content referenced once nothing else references them. Editing a file out of a body (without deleting the item) does NOT delete the bytes — that orphan is cleared via the owner Storage delete.',
    },
    labels,
    projects: projects.map(publicProject),
    members,
  })
})
