// This app's identity, in one place.
//
// The slug is the single string that must agree in five places, and the checklist
// in docs/adding-an-app.md exists because forgetting any one of them fails late:
//
//   1. this constant
//   2. the directory name          apps/<slug>/
//   3. the Postgres schema         CREATE SCHEMA <slug>
//   4. the row in platform.apps    slug = '<slug>'
//   5. the CLI namespace           bk <slug> …   and the guide topics directory
//
// Renaming the app means changing all five together. Nothing derives it from
// anything else on purpose: a slug inferred from `process.cwd()` or a directory
// listing would be a slug that changes when someone moves a folder.
export const APP_SLUG = 'template'

// ── THE ONE PLACE THIS SCAFFOLD IS DELIBERATELY INCONSISTENT ─────────────────
// The directory is `apps/_template` but the slug is `template`, without the
// underscore. That is not an oversight: **npm refuses a package name starting
// with an underscore** (`EINVALIDPACKAGENAME`), and the directory is an npm
// workspace. The leading underscore is kept on the directory alone, where it
// sorts the scaffold to the top of `apps/` and marks it as not-a-product.
//
// A real app has no such split — `apps/sales`, slug `sales`, everywhere. When
// you copy this, rename BOTH to the same thing and delete this note.
