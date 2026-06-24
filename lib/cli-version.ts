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

export const CLI_LATEST_VERSION = process.env.BK_CLI_LATEST ?? '1.8.3'
export const CLI_MIN_VERSION = process.env.BK_CLI_MIN ?? '1.8.3'
