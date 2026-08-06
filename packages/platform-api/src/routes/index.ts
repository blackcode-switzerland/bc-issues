// The platform route factories — one module per shared route, each a function
// taking an `AppContext` and returning Next.js App Router handlers.
//
// ---------------------------------------------------------------------------
// WHY THEY ARE FACTORIES AND NOT ROUTES
// ---------------------------------------------------------------------------
// Every "platform verb" route — `/api/me`, `/api/meta`, `/api/upload`,
// `/api/workspaces/**`, search, activity, links, tokens — physically lived under
// `apps/issues/app/api/**`. With one app that was invisible. With two it breaks
// three ways, all of them silent (docs/sales-app-plan.md B-2):
//
//   - an app on its own domain 404s on its own `/api/me`
//   - `bk upload` through the wrong host records the file as that host's app,
//     because `platform.uploads.app` is set by whoever served the request
//   - `resolveWorkspace` checks access to the SERVING app, so a user granted
//     sales and not issues gets 403 on `bk search`
//
// A factory fixes all three at once: the route is one implementation, and the
// app that mounts it supplies its own identity. Mounting is three lines:
//
//   import { searchRoute } from '@blackcode/platform-api/routes'
//   import { appContext } from '@/lib/api'
//   export const GET = searchRoute(appContext)
//
// ---------------------------------------------------------------------------
// MOUNTING ONE IS NOT THE WHOLE JOB
// ---------------------------------------------------------------------------
// The mount file must still exist at the right path in each app — Next.js routes
// by filesystem, so there is no way to mount these centrally, and nothing warns
// you about a route you forgot. `lib/cli-parity.test.ts` is what catches it:
// every route `bk` claims must exist in the tree of an app that says it mounts
// the platform routes (`hostsPlatformRoutes`). Set that flag when you mount
// them, or your app's missing routes are nobody's failure.

export { searchRoute } from './search'
