// May this user use this app in this workspace?
//
// The data layer is @blackcode/platform-db's app-access.ts. This file is the
// enforcement layer, and it exists separately because a denial is a product
// decision, not a query: what status, what code, what the caller is told to do
// next, and whether it is logged. There is exactly one of each.
//
// ---------------------------------------------------------------------------
// WHY IT LIVES IN platform-api AND NOT platform-auth
// ---------------------------------------------------------------------------
// It was in `@blackcode/platform-auth` until 2026-08-06. It moved when the
// shared request layer was extracted (docs/sales-app-plan.md Phase 1a, D-2):
// `resolveWorkspace` is the one caller, it now lives in `./handler.ts`, and
// importing it from platform-auth made the two packages depend on each other —
// platform-auth needed `Errors` from here for the only thing this file does.
// Turbo refuses that cycle, and it was right to: a cycle between two packages
// usually means the boundary is in the wrong place, and it was.
//
// This file is HTTP. Its entire job is turning a query result into a 403 with a
// hint an agent can act on — the status, the code, the `suggestion` string. That
// belongs beside the error model it constructs. What is left in platform-auth is
// identity and nothing else (tokens, whitelist, password), with no knowledge of
// HTTP at all, which is a cleaner package than the one it replaced.
//
// The move changed the import path and nothing else. There is still exactly one
// place that decides what a denial looks like; it is this one.
//
// ---------------------------------------------------------------------------
// WHY THE KILL SWITCH IS AN OPT-OUT, NOT AN OPT-IN
// ---------------------------------------------------------------------------
// Enforcement is on unless `PLATFORM_ENFORCE_APP_ACCESS` is explicitly falsey.
// Opt-in would mean the intended behaviour depended on remembering to set a
// variable in every environment — and the environment where you forget is the one
// that silently ignores access rules. Opt-out means the safe direction requires
// no configuration, and recovery is one variable to ADD:
//
//     PLATFORM_ENFORCE_APP_ACCESS=0
//
// That restores exactly the pre-Phase-4 behaviour (workspace membership alone
// decides), which is the documented rollback for this phase.
//
// ---------------------------------------------------------------------------
// WHY DENIALS ARE LOGGED LOUDLY
// ---------------------------------------------------------------------------
// Every other phase of this migration failed loudly — a 500, a 42P01, a build
// error. This one fails QUIETLY: a missing app_access row does not crash, it
// renders an empty workspace list, which reads as "working correctly, nothing to
// show". So every denial prints the user, the workspace and the app. If the
// backfill ever misses someone, the log says who instead of leaving a support
// ticket to guess.

import { Errors } from './errors'
import {
  explainAppAccessDenial,
  hasAppAccess,
  type AppAccessDenial,
  type AppAccessTarget,
  type Executor,
} from '@blackcode/platform-db'

const OFF_VALUES = new Set(['', '0', 'false', 'no', 'off'])

/**
 * Is per-app access enforced in this process?
 *
 * Read at call time, not at module load, so a test can flip it without a module
 * cache reset — and so a serverless instance picks up a changed variable on its
 * next cold start rather than needing a redeploy to notice.
 */
export function isAppAccessEnforced(): boolean {
  const raw = process.env.PLATFORM_ENFORCE_APP_ACCESS
  if (raw === undefined) return true
  return !OFF_VALUES.has(raw.trim().toLowerCase())
}

/** What to tell the caller for each way access can be missing. */
function denialMessage(app: string, d: AppAccessDenial): { message: string; suggestion: string } {
  switch (d.reason) {
    case 'app_unknown':
      return {
        message: `Unknown app "${app}".`,
        suggestion: 'Run `bk meta` to see the apps you can reach.',
      }
    case 'app_globally_disabled':
      return {
        message: `The ${app} app is currently disabled.`,
        suggestion: 'This is a platform-wide setting — contact an administrator.',
      }
    case 'app_not_enabled_for_workspace':
      return {
        message: `The ${app} app is not enabled for this workspace.`,
        suggestion: `A workspace owner can enable it with \`bk app enable ${app} --ws <slug>\`, or from Workspace settings → Apps.`,
      }
    case 'no_grant':
      return {
        message:
          d.default_access === 'invite_only'
            ? `You do not have access to the ${app} app in this workspace. It is invite-only here.`
            : `You do not have access to the ${app} app in this workspace.`,
        suggestion: `Ask a workspace owner to grant it: \`bk app access grant ${app} --user <you> --ws <slug>\` (or Workspace settings → Apps).`,
      }
  }
}

export interface RequireAppAccessArgs extends AppAccessTarget {
  /** Included in the denial log line so a support question has an answer. */
  userEmail?: string
  workspaceSlug?: string
}

/**
 * Throw a 403 unless `userId` may use `app` in `workspaceId`.
 *
 * A no-op when enforcement is switched off. The happy path is one indexed
 * lookup; the extra query that distinguishes the four denial reasons runs only
 * when the answer is already "no".
 *
 * Deliberately 403 and not 404: the caller IS a member of this workspace (that
 * was checked before we got here), so hiding the workspace's existence would
 * hide the one fact they need — that access is grantable and by whom.
 */
export async function requireAppAccess(db: Executor, args: RequireAppAccessArgs): Promise<void> {
  if (!isAppAccessEnforced()) return
  if (await hasAppAccess(db, args)) return

  const denial = await explainAppAccessDenial(db, args)
  const { message, suggestion } = denialMessage(args.app, denial)

  console.warn(
    '[app-access] DENIED ' +
      JSON.stringify({
        app: args.app,
        reason: denial.reason,
        user_id: args.userId,
        user_email: args.userEmail ?? null,
        workspace_id: args.workspaceId,
        workspace_slug: args.workspaceSlug ?? null,
      })
  )

  // The suggestion becomes the envelope's `suggestion` field, which the CLI
  // prints as a `hint:` line — the difference between an agent stopping and an
  // agent recovering.
  throw Errors.forbidden(message, suggestion, 'app_access_denied')
}
