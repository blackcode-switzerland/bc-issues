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
//   - limits      : every server-enforced cap (upload size, title/name lengths,
//                   page sizes, undo count), imported from the modules that
//                   enforce them (lib/limits.ts, lib/upload.ts)
//   - media       : how an uploaded url renders in a rich-text body, and which
//                   MIME types upload refuses
//   - cli         : the advertised bk versions (lib/cli-version.ts)
//
// The last three exist so the embedded `bk guide` never has to restate a value
// that can change without a CLI release. Guide = static behaviour, meta =
// dynamic data. See AGENT-SURFACE-SIMPLIFICATION-PLAN.md §2.1 and lib/agent-meta.ts.
//
// Authenticated (session or bk_live_ token). For how to USE any of this, run
// `bk guide` — it is the complete usage guide for the binary in the agent's hand.

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
import { META_LIMITS, META_MEDIA, META_CLI } from '@/lib/agent-meta'

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
    // Every server-enforced cap, imported from the code that enforces it. The
    // guide points here rather than restating a number that can change without
    // a CLI release.
    limits: META_LIMITS,
    // How an uploaded url renders once it is referenced in a rich-text body,
    // and what upload refuses outright.
    media: META_MEDIA,
    // The bk versions this server advertises (also sent as X-BK-CLI-* headers).
    cli: META_CLI,
    // Pointers only — the behaviour itself lives in `bk guide`, which ships
    // inside the binary and therefore always describes the binary in your hand.
    conventions: {
      interface:
        'This product is operated through the bk CLI. Run `bk guide` for the complete, current usage guide for your installed binary; `bk <group> <command> --help` for flags.',
      id: 'A project/task/issue is addressed by its workspace #number (the #N shown in the app), unique per workspace. References back to a work item (comment.parent_id, attachment.issue_id, project_update.project_id) are this #number too — the internal db id is never exposed.',
      workspace_selection:
        'Before creating anything, confirm which workspace you are writing to. The `workspaces` array above lists every workspace you belong to; match the user\'s intent by `name`/`slug`, never by the numeric `id` (ids are opaque and easy to confuse). `active_workspace` is only a default — it is NOT necessarily where the user means to write. Set it with `bk workspace use <slug>`, or target one command with `bk --ws <slug> …`.',
      staying_current:
        'If a command that used to work now fails, run `bk skill sync` (updates your agent skill, and tells you when the binary itself is behind), then `bk changelog` for the dated record.',
    },
    labels,
    projects: projects.map(publicProject),
    members,
  })
})
