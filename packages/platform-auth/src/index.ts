// @blackcode/platform-auth — platform identity.
//
// Three things, all of which a second app needs UNCHANGED:
//
//   tokens            `bk_live_` API tokens: one token, every app  (Phase 6)
//   whitelist         who may exist on the platform at all         (Phase 6)
//   password          hashing + the validators that go with it     (Phase 6)
//
// ---------------------------------------------------------------------------
// LOOKING FOR `requireAppAccess`? IT IS IN @blackcode/platform-api NOW.
// ---------------------------------------------------------------------------
// It was a fourth thing in this list — "who may open which app, in which
// workspace" — until 2026-08-06. It did not move for tidiness, and it is not
// coming back. The reason, in full, because the next person to want it will
// look here first:
//
// 1. It is not an identity question, it is an HTTP one. Whether a user has a
//    grant is a query, and that query is in `platform-db`'s app-access.ts. What
//    this file added on top was the ANSWER SHAPE: status 403 (not 404, because
//    the caller is a member and hiding the workspace hides the one fact they
//    need), the code `app_access_denied`, and the `suggestion` string the CLI
//    prints as `hint:`. All three are decisions about a response.
//
// 2. So it was the only thing in this package that imported `Errors` — the only
//    thing here that knew HTTP existed at all.
//
// 3. That import was survivable while nothing in platform-api needed the check.
//    Phase 1a of docs/sales-app-plan.md put `resolveWorkspace` — its one caller —
//    into platform-api, and the two packages became mutually dependent. Turbo
//    refuses that outright ("Cyclic dependency detected"), so `npm run typecheck`
//    stopped running. It was not a warning we chose to act on; nothing built.
//
// 4. A cycle between two packages usually means a boundary is in the wrong
//    place, and this one was. Moving the enforcement next to the error model it
//    constructs leaves three packages that each do one thing:
//
//        platform-db     the queries
//        platform-api    the enforcement, and the error model it answers with
//        platform-auth   identity only — no HTTP anywhere in it
//
// The check itself is byte-for-byte what it was; only the import path changed.
// Full reasoning lives with the code, in
// `packages/platform-api/src/require-app-access.ts`.
//
// The alternative considered and rejected was an eighth package depending on
// both: it would have split `apiHandler` from `Errors`, which is worse coupling
// than the one it removed.
//
// WHAT DELIBERATELY DID NOT MOVE, and why it is not an oversight.
//
// `apps/issues/lib/auth.ts` — the next-auth `authOptions` — was scheduled to land
// here in Phase 6. It did not, because of what it drags with it. Its callbacks
// call `getUserByEmail`, `touchLastLogin`, `upsertUserFromOAuth`,
// `ensureDefaultWorkspace` and `materializePendingInvitationsForUser`, which are
// `apps/issues/lib/db/queries/{users,workspaces,invitations}.ts` — ~1,250 lines
// that are not extracted. `workspaces.ts` in turn imports `recordEvent`, and
// `events.ts` imports `fanout.ts`, whose rules are written in terms of issues,
// tasks and project watchers: unambiguously one app's logic.
//
// So moving `authOptions` today means one of two things. Either drag the whole
// query layer along, which puts app-specific fan-out inside a platform package —
// the exact thing the standing rule forbids — or inject five callbacks as
// parameters, which is the "if you have to add a parameter to make it generic,
// leave it" case, verbatim. Both are worse than the wait.
//
// The Phase 2 decision table blamed `events.ts` hardcoding entity types, and
// Phase 6 did generalise the events TABLE (`app`, `subject_urn`). But that was
// only ever half the blocker: the other half is the un-extracted query layer, and
// it is unchanged. Extracting `users.ts` and `workspaces.ts` is its own piece of
// work with its own risk, and it is not what this phase was scoped to do.
//
// `session.ts` and `resolve.ts` stay for the same reason — they are thin glue
// over `authOptions` and follow it whenever it moves.

export { mintToken, verifyToken, listTokens, revokeToken } from './tokens'
export type { MintedToken, TokenSummary } from './tokens'

export {
  getSuperAdminEmails,
  isSuperAdmin,
  isWhitelistEnabled,
  isEmailAllowed,
  isEmailAllowedByDb,
} from './whitelist'

export { hashPassword, verifyPassword, validatePassword, validateEmail } from './password'
