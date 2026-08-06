# Renaming the npm package — a runbook for later

**Status: not done, deliberately.** The package is `@blackcode_sa/bc-issues`.
This document exists so the rename can be done safely whenever it is worth
doing, and so nobody re-derives the reasoning under time pressure.

## Why it should eventually change

The package ships **one binary, `bk`, for the whole platform** — `bk issues …`,
and one group per app after that. The name says "issues", which was true when
there was one app and is misleading now that `apps/_template` exists and a
second real app is expected.

## Why it has not been done

Renaming touches the install path **every agent depends on**. The string
`npm install -g @blackcode_sa/bc-issues@latest` appears in the guide, in
`/agent-updator`, in the `bk skill` template, in the README, in `CLAUDE.md` and
in this repo's docs. Miss one and an agent following stale instructions reaches
a dead end with no recovery hint — the exact failure the whole agent-surface
contract exists to prevent.

A confusing package name costs nothing operationally. A broken install path
costs every agent at once.

## The one rule

> **Never `npm unpublish` the old name.** It is the only irreversible mistake
> available here, and npm's unpublish window makes it worse: it can break
> installs for people who already depend on it.

The old name is not removed. It is deprecated — it keeps working forever and
tells people where to go.

## Choosing the name

`@blackcode_sa/bk` reads best: it is the binary's name, it is what people type,
and it stays true no matter how many apps exist. `@blackcode_sa/blackcode-platform`
also works but is long for something typed into an install command.

Decide before starting. Renaming twice is worse than not renaming.

## The sequence

Best done **as part of a CLI release you were cutting anyway** — it needs a
version bump and a full pass over the install strings either way.

1. **Publish under the new name.** `cli/npm/package.json` → new `name`, same
   version. `npm publish --access public`. Both names now exist and both work.

2. **Deprecate the old name** — do not unpublish:
   ```bash
   npm deprecate @blackcode_sa/bc-issues \
     "renamed to @blackcode_sa/bk — install that instead; this name still works"
   ```
   Anyone installing the old name still gets a working CLI, plus a notice.

3. **Update every install string, in the same release.** Search the whole repo
   for the old name — do not work from this list alone, work from `grep`:
   - `cli/npm/package.json`
   - `cli/internal/guide/topics/platform/*.md` (install & auth, staying current)
   - `cli/internal/skill/template.md`
   - the `/agent-updator` page content
   - `devops/release.sh` (`npm_package`, the GitHub release notes body)
   - `README.md`, `CLAUDE.md`, `AGENTS.md`
   - `docs/cli.md`, `docs/devops.md`
   - the exit-8 upgrade message and any `hintFor()` text in `cmd/bk/main.go`

4. **Dated entry in `docs/changelog/platform.md`** stating the package moved,
   the new name, and that the old name still resolves. This is agent-visible —
   an agent that reads the changelog should not have to guess.

5. **Verify both paths, with real installs:**
   ```bash
   npm install -g @blackcode_sa/bk && bk version          # new: works
   npm install -g @blackcode_sa/bc-issues && bk version   # old: works + notice
   ```
   Then `bk guide` and `bk skill sync` on the new install, and confirm neither
   still prints the old name anywhere.

## Stop conditions

If any of the following is true, **leave the name alone and close this out as
"still not worth it"**:

- step 3's `grep` finds occurrences you cannot update in the same release
- you cannot verify both install paths end to end
- a CLI release is not already happening

## Good time to do it

Bundle it with the **`CLI_MIN_VERSION` raise**, which is separately owed. Both
are one-line-ish changes that need a release and a careful pass over agent-facing
strings, and doing them together halves the ceremony. Do not bundle either with
a feature release.
