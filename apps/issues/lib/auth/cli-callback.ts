// The loopback callback `bk login` redirects a freshly minted token to.
//
// Moved to `@blackcode/platform-auth` on 2026-08-06 with /api/cli/authorize:
// D-21 makes that route Tier 1 for every deployed app, and an app
// re-implementing this validation is an app that can get it slightly wrong —
// which means posting a live credential somewhere it should not go.
//
// The `/cli-callback` SUBPATH, not the package root: the authorize page parses
// the callback in the browser and must not pull bcryptjs and Drizzle into the
// client bundle.
export {
  buildCallbackRedirect,
  parseCallbackURL,
  type ParsedCallback,
} from '@blackcode/platform-auth/cli-callback'
