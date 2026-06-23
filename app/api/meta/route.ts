// GET /api/meta — the bootstrap call for agents (and humans).
//
// Returns, in one round-trip:
//   - user        : who you are + how you authenticated (via)
//   - active_workspace : the resolved workspace (?ws= override, else the user's
//                        active workspace; null if none / not a member)
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
import { getWorkspaceForUser, listWorkspaceMembers } from '@/lib/db/queries/workspaces'
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
      id: 'workspace-scoped number (the #N shown in the UI); address items by it',
      changelog: '/docs/api-changelog.md',
      rich_text: 'description/comment/body fields accept Markdown or HTML, stored as sanitized HTML',
      file_embeds:
        'POST a file to /api/upload (multipart field "file") -> { url }, then reference it in a body as ![name](url) for images or [name](url) for any other file; uploaded urls render inline (preview/player/download card). Max 100MB.',
    },
    labels,
    projects: projects.map(publicProject),
    members,
  })
})
