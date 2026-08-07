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

## 2026-08-07 — The sales pipeline is reachable: `bk sales prospect`

**What you can now do.** Run the business-development pipeline from `bk`. A
prospect is a company **and** its deal in one record — there is no separate
account and opportunity to keep in step.

```bash
bk sales prospect list --owner me           # what you are on the hook for
bk sales prospect list --stage <stage>      # `bk meta` for the stage values
bk sales prospect show 12                   # record + deal journey + cross-app links
bk sales prospect create --name "Roches SA" --city Morges --value 15000
bk sales prospect edit 12 --summary "waiting on their board"
bk sales prospect stage 12 <stage> --note "they asked for a revised quote"
bk sales prospect delete 12 --confirm "Roches SA"
```

Start with `bk guide sales/pipeline`. Every vocabulary and every limit is served
live by `bk meta`; nothing in the guide or in `--help` restates one.

**Four things worth knowing before you script against it.**

1. **Everything is addressed by #number, never by a row id.** `bk sales prospect
   show 12` means prospect #12 of that workspace. The same number is the tail of
   its URN — `bc:sales:<workspace>/prospect/12` — which is what `bk search` and
   `bk link` use, so a prospect is addressable from any other app.

2. **`bk sales prospect delete` needs the COMPANY NAME, not the number again.**
   `--confirm "Roches SA"`, required even with `--yes` and even under
   `BK_NO_PROMPT=1`, and enforced by the server rather than only by the binary.
   Repeating the number back proves nothing about whether it is the right one;
   the name is what catches a wrong #number. A mismatch deletes nothing and the
   error names the company that *is* at that number. The delete is reversible —
   it bins the prospect and everything logged against it.

3. **Moving a deal is its own command.** `bk sales prospect stage` writes a step
   in the deal journey, attributed to whoever ran it, and records the close date
   on a closing stage. `bk sales prospect edit` therefore **refuses `--stage`**
   with a 400 naming the right command — a field edit would set the column and
   leave the journey disagreeing with it.

4. **An empty value clears a field.** `--city ""` removes the city, `--owner ""`
   unassigns the deal, and omitting the flag leaves it alone. The three states
   are distinct on the wire.

**Attribution.** Journey steps record who wrote them, and an agent's steps say
so: the label comes from the API token's name. `bk token create --name
<something meaningful>` matters more in this app than elsewhere. The deal
**owner** is always a real person — an agent can log a call and write history, it
cannot own a deal.

**Not breaking.** This app had no reachable surface before today.

**Not built yet, so that a script does not assume it:** contacts, meetings,
communications, objections, products, templates, documents, matches, the
aggregate views (`today`, `pipeline`, `metrics`), `bk sales search`, and the
app-owned verbs `bk sales upload | trash | label`. They land in the same phase
and each gets its own entry here.
