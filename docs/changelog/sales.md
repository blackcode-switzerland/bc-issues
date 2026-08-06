# Changelog — sales app

Breaking and notable changes to the **sales** app: prospects and their contacts,
meetings, communications, objections, products, templates and documents. Newest
first. If a command that used to work now fails, check here first — and check
`platform.md` too, which carries changes to workspaces, members, files, tokens
and the `bk` CLI itself.

For how the CLI **works** (rather than what changed), run **`bk guide`** — the
complete usage guide, embedded in the binary, so it always describes the version
you are running. For live values (vocabularies, limits, your workspaces), run
**`bk meta`**.

Surfaced at: `GET /api/changelog` (JSON or `?format=markdown`) and `bk changelog`,
which merge every app's file into one feed by date, each entry tagged with its
app. `bk changelog --app sales` filters to this file.

> **Process rule:** every change to a route or user-facing feature must add a
> dated entry here. Timestamp it and describe what changed and how to adapt.
> A change touching shared platform data goes in `platform.md` instead, even
> when this app is what prompted it.

---

<!--
No entries yet — the app is being built (docs/sales-app-plan.md). The first entry
goes above this comment, as `## YYYY-MM-DD — <clear title>`.

This file existing IS the registration: `packages/platform-agent/src/changelog.ts`
discovers sections by reading this directory, so nothing else lists it.
-->
