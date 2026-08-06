// @blackcode/platform-auth — platform identity.
//
// Four things, all of which a second app needs UNCHANGED:
//
//   tokens            `bk_live_` API tokens: one token, every app  (Phase 6)
//   whitelist         who may exist on the platform at all         (Phase 6)
//   password          hashing + the validators that go with it     (Phase 6)
//   session-cookie    one sign-in across every app        (Phase 1h, D-16)
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
// here in Phase 6 and did not. **The reason it did not has since been fixed, and
// it still is not moving. Read this before proposing it again.**
//
// The Phase 6 reason was what it dragged along: five callbacks reaching into
// ~1,250 unextracted lines of one app's query layer, one of which imported
// `recordEvent`, which imported fan-out rules written in terms of issues, tasks
// and project watchers. On 2026-08-06 (Phase 1b-C) that was untangled — four of
// the five callbacks are in `platform-db`'s `sign-in.ts`, and the event spine was
// split at the platform/app seam (D-23). So the old blocker is gone.
//
// WHAT REMAINS IS NOT A BLOCKER, IT IS THE ANSWER. `authOptions` is a bundle of
// things that are each genuinely one app's:
//
//   - which PROVIDERS that app offers, and their client credentials
//   - its `pages` — where an unauthenticated visitor is sent, and where an error
//     lands. Those are that app's URLs
//   - its `pages` again — see above; nothing else about the cookie is app-local
//     any more. **The session cookie itself moved HERE on 2026-08-06** (D-16,
//     Phase 1h): it is one credential shared across every deployment, so two
//     apps disagreeing about its name or domain would produce a session that
//     works in one place and silently does not in the other. See
//     `./session-cookie.ts`.
//   - `ensureDefaultWorkspace`, the one sign-in callback that stayed app-local,
//     because each app has an app-specific post-create step (issues inserts
//     `issues.workspace_counters`)
//
// Sharing it would mean passing all of that in as parameters, which is the "if
// you have to add a parameter to make it generic, leave it in the app" rule
// verbatim. What IS shared is what those callbacks do to the database — one
// login, one `platform.users` row — and that is `platform-db`'s `sign-in.ts`.
//
// `session.ts` and `resolve.ts` stay for the same reason: they are thin glue over
// `authOptions`. `AppContext.resolveUser` / `resolveSessionUser` are how a shared
// route reaches them without this package knowing they exist.

// The shared session cookie (D-16). An app spreads this into
// `authOptions.cookies` and configures nothing else about it.
export {
  sessionCookieConfig,
  sessionCookieName,
  domainCoversHost,
  SessionCookieDomainError,
} from './session-cookie'
export type { SessionCookieConfig, SessionCookieInput } from './session-cookie'

export { mintToken, verifyToken, listTokens, revokeToken } from './tokens'
export type { MintedToken, TokenSummary } from './tokens'

export {
  addWhitelistEntry,
  getSuperAdminEmails,
  isSuperAdmin,
  isWhitelistEnabled,
  isEmailAllowed,
  isEmailAllowedByDb,
} from './whitelist'

export { hashPassword, verifyPassword, validatePassword, validateEmail } from './password'

// Resetting a password: the OTP lifecycle, and the loopback URL `bk login`
// redirects a freshly minted token to. Both are platform because one login
// serves every app (2026-08-06, Phase 1b-C). Sending the email is NOT here —
// the message carries an app's name and branding; see password-reset.ts.
export {
  OTP_EXPIRES_IN_MINUTES,
  hashNewPassword,
  requestPasswordOtp,
  verifyOtpAndResetPassword,
} from './password-reset'
export type { RequestOtpResult, VerifyResetResult } from './password-reset'
export { buildCallbackRedirect, parseCallbackURL } from './cli-callback'
export type { ParsedCallback } from './cli-callback'
