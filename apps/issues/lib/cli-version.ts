// Source of truth for the bk CLI versions the API advertises. Every API
// response carries these as headers (set in lib/api/handler.ts):
//
//   X-BK-CLI-Latest  — newest published CLI; the CLI prints a soft "update
//                      available" notice when the user is behind it.
//   X-BK-CLI-Min     — minimum CLI the API still supports; the CLI refuses to
//                      run (hard upgrade) when the user is below it.
//
// Bump these on each CLI release. Raise CLI_MIN_VERSION whenever a server change
// is incompatible with older CLIs (e.g. the milestone→task / key-removal rename),
// so stale clients get a clear "please upgrade" instead of cryptic 404s.
// Both are overridable via env without a redeploy.
//
// ORDER MATTERS. Publish the new CLI to npm and verify a clean install BEFORE
// raising CLI_MIN_VERSION. Raising the floor first locks out every user with no
// working version to move to. Because both values read from env, the floor can
// also be rolled back instantly without a redeploy.
//
// Current state (2026-08-03): 1.9.0 adds `bk guide` and `bk skill`, which is what
// makes the CLI self-describing and self-repairing. The floor stays at 1.8.7
// deliberately — a 1.8.x client still works, it just doesn't have those commands.
// Raise the floor to 1.9.0 only after 1.9.0 has soaked (see
// AGENT-SURFACE-SIMPLIFICATION-PLAN.md §8.6), by setting BK_CLI_MIN=1.9.0 — no
// redeploy needed.

export const CLI_LATEST_VERSION = process.env.BK_CLI_LATEST ?? '1.9.3'
export const CLI_MIN_VERSION = process.env.BK_CLI_MIN ?? '1.9.1'
