// Shared blob storage for every Blackcode app.
//
// What lives here is what a second app would need UNCHANGED: the ledger, the
// path convention, the recognizer, the reference-scanner registry and the
// garbage collector. What stays in an app is what only that app can know — its
// content tables (the scanner it registers) and its own upload limits.
//
// The barrel is safe to import from a server module; nothing here has an import
// side effect. Registering a scanner is an explicit call the app makes, not
// something a barrel can do for it — see references.ts.
export * from './assets'
export * from './paths'
export * from './references'
export * from './gc'
export * from './uploads'
