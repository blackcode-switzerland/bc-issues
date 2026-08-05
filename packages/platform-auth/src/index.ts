// @blackcode/platform-auth — platform authentication and authorisation.
//
// Four things, all of which a second app needs UNCHANGED:
//
//   requireAppAccess  who may open which app, in which workspace   (Phase 4)
//   tokens            `bk_live_` API tokens: one token, every app  (Phase 6)
//   whitelist         who may exist on the platform at all         (Phase 6)
//   password          hashing + the validators that go with it     (Phase 6)
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

export { requireAppAccess, isAppAccessEnforced } from './require-app-access'
export type { RequireAppAccessArgs } from './require-app-access'

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
