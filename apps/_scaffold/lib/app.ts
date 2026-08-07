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
export const APP_SLUG = 'scaffold'

// ── THE ONE PLACE THIS SCAFFOLD IS DELIBERATELY INCONSISTENT ─────────────────
// The directory is `apps/_scaffold` but the slug is `scaffold`, without the
// underscore. That is not an oversight: **npm refuses a package name starting
// with an underscore** (`EINVALIDPACKAGENAME`), and the directory is an npm
// workspace. The leading underscore is kept on the directory alone, where it
// sorts the scaffold to the top of `apps/` and marks it as not-a-product.
//
// A real app has no such split — `apps/sales`, slug `sales`, everywhere. When
// you copy this, rename BOTH to the same thing and delete this note.
//
// ── AND WHY THE SLUG IS `scaffold` AND NOT `template` (D-38) ─────────────────
// It was `template` until 2026-08-07. That word is not available: `sales` has a
// `template` ENTITY (`bk sales template list`, URN `bc:sales:{ws}/template/{n}`),
// Go code has locals called `template`, and `apps/*/lib/db/migrations/` is full
// of the word in prose. Three guards mis-fired on the collision in a single
// phase, and every one of them looked correct.
//
// The lesson generalises past this repo: **an app slug is matched against text
// by guards you did not write, so it must be a word that means one thing.**
// Prefer a slug no other app would ever use as an entity name, a variable or a
// directory. Check with `grep -rw '<slug>'` BEFORE you commit to it — the cost
// of finding out later is one rename across five places plus a deprecation row.
