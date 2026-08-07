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

## 2026-08-07 — There is a web app now: sign in and watch the pipeline

**What a human can now see.** Until today b/sales had no window: everything an
agent wrote through `bk sales` was real and invisible. Sign in at the sales host
and you land on **Today** — the actions due, the ones already overdue, the
meetings coming up across every prospect, and the open pipeline. The nav carries
the rest of the surface; those pages arrive over the next few changes.

It is **read-only on purpose**, and it will stay that way by default. The agent
operates the funnel and the human supervises: nothing on this surface sends a
message, approves a draft or edits a record, and there is no AI running in the
page. Everything shown is a record of something that already happened.

**The whole surface is there now.** Prospects as a table or a board, a prospect
page with the deal journey, its contacts, what they pushed back on and the
products the agent matched to them — plus anything linked to it in another app,
clickable, wherever that app is deployed. The two ledgers, the catalog, the
document library, the metrics, the bin. **⌘K searches inside the records** — a
phrase in a call summary, a name in a meeting outcome, the body of a template —
not just their titles.

**Nothing changed for agents.** No route was added, removed or altered, no `bk`
command changed, and `bk sales` behaves exactly as it did this morning.

**One page in the plan is not there yet:** Activity. It reads platform-wide
event data that this deployment does not serve, so the page and its nav entry
arrive together with the route rather than as a link that goes nowhere. Settings
and super-admin are not built yet either.

**One thing worth knowing if you script against this host.** Routes under
`/api/workspaces/{ws}/…` now also accept a **browser session** where before they
accepted only a `bk_live_…` bearer token — that is what lets the web pages talk
to their own API. A request that sends an `Authorization: Bearer` header is still
resolved from that token and only that token: an invalid token is an answer, not
a reason to fall back to whatever cookie the browser happens to be carrying. If
your token was revoked, you will get a 401 exactly as before.

---

## 2026-08-07 — The sales app is reachable: `bk sales`, fourteen nouns

**What you can now do.** Run blackcode's business-development pipeline from `bk`.
Start with `bk guide sales/pipeline`, then `bk sales --help`.

```bash
bk sales today                       # what is owed today, and today's meetings
bk sales pipeline                    # deal count and value by stage
bk sales metrics --period 90d        # how the last N days went
bk sales search "abacus"             # full text INSIDE this app's records

bk sales prospect list|show|create|edit|assign|stage|next|delete
bk sales contact  list|add|edit|rm
bk sales journey  list|add
bk sales meeting  list|show|schedule|log|outcome|cancel|rm
bk sales comm     list|log|show|rm
bk sales objection list|raise|counter|resolve|rm
bk sales product  list|show|create|edit|delete
bk sales template list|show|create|edit|delete|render
bk sales doc      list|show|add|edit|rm|link|unlink
bk sales match    list|set|clear

bk sales upload <file>               # store a file AGAINST THIS APP
bk sales trash   list|restore|purge|empty
bk sales label   list|view|create|edit|delete|attach|detach
```

Every vocabulary and every limit is served live by `bk meta` under `apps.sales`.
Nothing in the guide or in `--help` restates one, so nothing there can be stale.

**Nine things worth knowing before you script against it.**

1. **Addressed by #number, never by a row id** — for the six record types that
   have one: prospect, meeting, communication, product, template, document. The
   same number is the tail of the URN (`bc:sales:<workspace>/prospect/12`), which
   is what `bk search` and `bk link` use.

   **Contacts, journey steps, objections and matches have NO #number.** They are
   reached through their prospect, by the id their own listing prints — which is
   why `bk sales contact edit 12 3` takes a prospect #number and then a contact
   id. Their listings show an `ID` column and the numbered ones show `#`.

2. **`bk search` and `bk sales search` are different questions.** The first reads
   the shared entity index — titles only, every app — and returns URNs. The
   second reads this app's full text and finds a phrase in a call summary, a
   meeting outcome or a template body. Over the same term they return different
   things, deliberately. `bk guide sales/pitfalls` opens with this.

3. **Deleting takes the NAME, not the number.** `bk sales prospect delete 12
   --confirm "Roches SA"`, required even with `--yes` and even under
   `BK_NO_PROMPT=1`, and enforced by the server rather than only by the binary. A
   mismatch deletes nothing and names the record that IS at that number. Same for
   `meeting rm` (title), `comm rm` (the prospect's name), `product`/`template`/
   `doc` (name or title), `objection rm` (type).

4. **`bk sales objection rm` is permanent.** It is the one hard delete here:
   objections carry no recycle-bin state. Everything else goes to
   `bk sales trash`, is restorable for 90 days, and then purges. Binning a
   prospect bins its contacts, meetings and communications with it, and restoring
   brings back exactly those — not something you binned separately.

5. **Moving a deal is its own command.** `bk sales prospect stage` writes a
   journey step and, on a closing stage, the close date. `prospect edit` refuses
   `--stage` with a 400 naming the right one. `bk sales journey add` records a
   step WITHOUT moving the deal — for the rungs ahead of where a deal is, and for
   history that predates the record.

6. **Send values, not renderings.** `--value 24000` and not `"CHF 24'000"`;
   `--due 2026-08-11` and not `"next Thursday"`. Where the phrase matters,
   `--due-label` keeps your words verbatim beside the resolved date, displayed in
   preference to it and never parsed back.

7. **An empty value clears a field**; omitting the flag leaves it alone. The
   three states are distinct on the wire. If you build a command line from
   variables, an unset one that becomes `""` will CLEAR the field.

8. **`bk sales template render` refuses a missing variable** rather than leaving
   `{{name}}` in the output, and the error names each missing one and the full
   declared set. Placeholders are parsed out of the body on write — there is no
   flag to declare them.

9. **Nothing here computes a match.** `bk sales match set` stores YOUR verdict
   for a (prospect, product) pair, and re-running it replaces that verdict. There
   is no recommendation engine and there will not be one. The aggregate views
   (`today`, `pipeline`, `metrics`) ARE computed, because summing deal values is
   arithmetic rather than judgement.

**Attribution.** Every logged row records who wrote it, and an agent's rows say
so: the label comes from the API token's NAME. `bk token create --name
<something meaningful>` matters more in this app than anywhere else. The deal
**owner** is always a real person — an agent can log a call and write history, it
cannot own a deal.

**Files.** `bk sales upload` stores a file against THIS app: the app segment
decides where it is filed and who answers for it, and there is no bare
`bk upload`. You still list across every app with `bk storage list` — you upload
INTO one app and list ACROSS all of them. `bk guide platform/apps` has the rule.

**Not breaking.** This app had no reachable surface before today.

**Not built yet, so a script does not assume it:** the web UI (read-only and full
modes), and the `⌘K` palette. The app is also not deployed — these commands work
against a deployment that exists from Phase 12 onward.
