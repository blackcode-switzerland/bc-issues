// Shared blob storage for every Blackcode app.
//
// What lives here is what a second app would need UNCHANGED: the ledger, the
// path convention, the store's caps, workspace attribution, the recognizer, the
// reference-scanner registry and the garbage collector. What stays in an app is
// the one thing only that app can know — its content tables, which is the
// scanner it registers.
//
// The upload LIMITS moved here on 2026-08-06 (they were "an app's own" when this
// header was written, and that was wrong: there is one store, so a size cap and
// a blocked content type are properties of the store). They are also exported as
// their own dependency-free entry point, `@blackcode/platform-storage/limits`,
// because browser code checks the size before sending bytes and must not pull
// the Drizzle ledger into the client bundle.
//
// The barrel is safe to import from a server module; nothing here has an import
// side effect. Registering a scanner is an explicit call the app makes, not
// something a barrel can do for it — see references.ts.
export * from './apps'
export * from './attribution'
export * from './limits'
export * from './assets'
export * from './paths'
export * from './references'
export * from './index-refs'
export * from './gc'
export * from './uploads'
