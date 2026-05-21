# Marketing content

Source-of-truth content for the landing page and other marketing surfaces. Lists every feature, who it's for, what tone to write in, and which claims are real today vs. on the roadmap. Use this as the brief — the page itself is built on top.

> **Honesty rule.** Every feature listed below carries a status tag:
> - **Live** — shipped, working in production today.
> - **In preview** — exists but with caveats; the caveats are spelled out.
> - **Coming soon** — not yet built; marketing may reference but must label clearly.
>
> The previous landing page over-claimed in places. We're keeping every original feature on the page but labeling honestly.

---

## Table of contents

1. [At a glance](#at-a-glance)
2. [Positioning](#positioning)
3. [Audiences](#audiences)
4. [Headline & sub-headline options](#headline--sub-headline-options)
5. [Feature catalog](#feature-catalog)
6. [Surface areas](#surface-areas)
7. [Architecture summary (for the "How it works" section)](#architecture-summary-for-the-how-it-works-section)
8. [Use cases](#use-cases)
9. [Roadmap (Coming soon, grouped)](#roadmap-coming-soon-grouped)
10. [Brand assets](#brand-assets)
11. [Voice & tone](#voice--tone)
12. [Sample landing-page outline](#sample-landing-page-outline)
13. [FAQ seed](#faq-seed)

---

## At a glance

- **Product name**: **blackcode issues**
- **Tagline (current)**: *AI-Native Issue Tracking*
- **One-line pitch**: An issue tracker designed for AI agents and the humans who direct them — clean integer IDs, a typed HTTP API, a first-class CLI, and a polished web UI.
- **Category**: Project / issue management. Adjacent to Linear, Jira, GitHub Issues.
- **License**: Internal (see repo for definitive terms).
- **Status**: Working alpha — usable end-to-end, with documented gaps the roadmap is closing.

---

## Positioning

Most issue trackers were built for humans clicking through forms. blackcode issues was built so an AI agent (or a power user at a terminal) can do the same work without losing context: integer IDs you can remember, a stable HTTP API, a Go CLI with predictable exit codes and machine-readable output, and a web UI for everyone else.

It's the **memory layer** of an AI-augmented workflow. The agent does the work; this is where the work lives.

### Three things that make it different

1. **Integer IDs everywhere.** No UUID hell. Agents (and humans) can refer to "issue 42" instead of `c47ad9b3-...`.
2. **Three equal interfaces.** Web UI, HTTP API, and a Go CLI — all driven by the same auth model and the same data. Pick whichever fits the moment.
3. **Undoable mutations.** Issue edits are journaled to a transaction log and can be reversed with one command. (Today this covers issue updates; broader coverage is on the roadmap.)

---

## Audiences

### Primary

- **Solo developers and small teams** who want issue tracking without Jira-grade ceremony.
- **AI/agent builders** who need a place for the agent to read, write, and remember work — with an interface that's actually scriptable.
- **Terminal-first developers** who'd rather type `bk issue create --title "..."` than open a tab.

### Secondary

- **Indie product teams** that want one tool covering Kanban + timeline + lists.
- **Operations / lightweight project owners** who need milestones and member roles without enterprise overhead.

---

## Headline & sub-headline options

Pick one set; vary tone to match the chosen design direction.

### Option A — confident technical
- **H1**: Issue tracking for humans and the AI working alongside them.
- **Sub**: Integer IDs. A stable HTTP API. A CLI built like Go. A web UI built like Linear. One data model behind all three.

### Option B — agent-forward
- **H1**: An issue tracker your agents can actually use.
- **Sub**: Memorable IDs, a typed API, a Go CLI with stable exit codes, and an undo button for the times your agent (or you) gets it wrong.

### Option C — pragmatic
- **H1**: A focused issue tracker. Three ways to use it.
- **Sub**: Web, CLI, or HTTP. Same auth, same data, same workflows. Built for teams that move fast and the agents that help them.

### Existing taglines that still work

- "AI-Native Issue Tracking"
- "Prompt → Tools → Software"

---

## Feature catalog

The feature set the landing page can credibly draw from. Each card or section should pick from this list and label the status honestly.

### 🟢 Live — Identity & access

**Sign in your way**
Email + password (bcrypt-hashed, 8+ chars) or Google OAuth. The OAuth button only appears if you've configured the credentials, so self-hosters aren't pushed into Google.
*Status: Live*

**API tokens for scripts and agents**
Mint a `bk_live_…` token from your settings, paste it into a CLI, agent, or curl. Stored as a SHA-256 hash with an 8-char visible prefix so you can see "which token did what" without ever exposing the secret again.
*Status: Live*

**Role-based access on projects**
Owner, admin, member, viewer. Owners control deletion and ownership transfer; admins manage members and destructive operations; members read/write everything else; viewers are read-only.
*Status: Live*

**Admin bootstrap**
The first user can promote themselves to system admin once, so a fresh deployment has a real admin without anybody touching the database.
*Status: Live*

### 🟢 Live — Project management

**Projects with rich metadata**
Name, description, status, priority bucket, visibility, color, icon, banner, start/end dates. All fields are server-validated. Each project gets its own member roster and its own Kanban.
*Status: Live*

**Team membership**
Invite by email, set role, remove. Membership and project deletion are role-checked end to end.
*Status: Live*

**Milestones**
Group issues into time-boxed milestones with optional due dates. Each milestone surfaces its open/total issue counts.
*Status: Live*

### 🟢 Live — Issue workflows

**Issues with the fields that matter**
Title, description (rich text), status (`backlog` / `todo` / `in_progress` / `blocked` / `in_review` / `done` / `cancelled`), priority (1–5), assignee, reporter, milestone, start date, due date, estimated hours.
*Status: Live*

**Three views, one dataset**
- **Kanban board** — drag-and-drop columns per status, with persisted moves.
- **Gantt / timeline** — issues placed on a date axis using their start/due dates.
- **All-issues list** — flat, filterable view across all your projects with status, priority, assignee and project filters.

*Status: Live*

**Rich-text descriptions and comments**
TipTap editor with bold, italic, lists, blockquotes, code blocks, links, and inline images. HTML is sanitized via DOMPurify before save.
*Status: Live*

**File attachments**
Drag-and-drop or pick a file. Stored on Vercel Blob in production; in local development without a Blob token, files are served from `public/uploads/` so you can iterate fully offline. Max 10 MB, common image/text/PDF types.
*Status: Live*

**Comments**
Per-issue conversation thread with author avatars and timestamps.
*Status: Live*

**Activity feed**
Two scopes:
- Per-issue: merged comments + the issue's change history.
- Global: a chronological feed of every mutation logged across the workspace.

*Status: Live*

### 🟢 Live — Identity & memory for agents

**Integer IDs**
Every record — projects, issues, milestones, comments, attachments, members, tokens — uses a plain integer primary key. "Issue 42" is easier to dictate, easier to grep, and easier for a model to keep in working memory than a 36-character UUID.
*Status: Live. Matches the original landing-page claim.*

**Three equally-supported interfaces**
- **Web UI** at `/dashboard` — for humans.
- **HTTP API** under `/api/*` — JSON in, JSON out, documented in [`docs/backend.md`](./backend.md).
- **Go CLI** `bk` — documented in [`docs/cli.md`](./cli.md), with table/JSON/YAML output and stable exit codes.

All three share the same auth and the same data model. Anything you can do in one, you can do in the others.
*Status: Live*

**Predictable JSON errors**
Every error response is `{ error, suggestion?, details? }`. The CLI maps HTTP statuses to stable exit codes (401→3, 403→4, 404→5, 400/422→6) so scripts and agents can branch reliably.
*Status: Live*

### 🟡 In preview — Reliability features

**Instant rollback (undo)**
Issue updates are journaled to a transaction log with full `old_data`/`new_data` JSON snapshots. `POST /api/undo` or `bk undo --count N` reverses your most recent operations (up to 10 per call) and marks them rolled back so they can't double-undo.

**Caveats** (be transparent on the page):
- Coverage today is **issue updates only**. Issue **creates** can be undone (the row is deleted); issue **deletes**, comments, attachments, project/member/milestone mutations are not yet journaled.
- Broader coverage is on the roadmap.

*Status: In preview. Card copy should soften the previous "every operation is reversible" claim.*

### 🟢 Live — Polish

**Dark mode, by default**
Theme controlled by `next-themes`; flips a `.dark` class on the html element. All color tokens live in `app/globals.css` and use OKLCH for perceptually uniform lightness.
*Status: Live*

**Designed around a single brand color**
Re-theming the entire app — buttons, gradients, focus rings, hover states — takes one edit: change `--primary` in `app/globals.css`.
*Status: Live*

**Built on Tailwind v4 + shadcn/ui**
Polished defaults, accessible primitives (Radix under the hood), full ownership of every component file in `components/ui/` for easy customization.
*Status: Live*

### 🟡 In preview — Analytics

**Workspace analytics**
Admin-only dashboard with:
- issues by status,
- top projects by issue count,
- top assignees by issue count,
- 30-day issue creation trend.

The data is real and live. The visual presentation is functional but not yet polished.
*Status: In preview*

### 🔵 Coming soon — Performance & contracts

**Sub-15-millisecond responses**
The original landing page advertised "2-15ms latency." The architecture is set up to deliver in that range (Postgres with appropriate indexes, integer keys, drizzle's prepared queries, single round-trip per route), but the project doesn't ship benchmarks or perf tests yet.

**Plan**: add a perf harness, publish numbers, and back them with CI guards before re-asserting the claim.
*Status: Coming soon — the claim, not the speed.*

### 🔵 Coming soon — Batch operations

**Move 50 issues at once. Create 100 comments. Atomic, undoable.**
The original landing page advertised this. It isn't built — there are no bulk endpoints yet. The data model supports it; the routes and CLI verbs don't exist.

**Plan**: ship `POST /api/issues/bulk`, `PATCH /api/issues/bulk`, etc., wire `bk` verbs (`bk issue bulk-move`, etc.), and tie every batch into the transaction log so a single `undo` rolls the entire batch.
*Status: Coming soon*

### 🔵 Coming soon — Natural language queries

**"Show blocked issues from Q4 assigned to Andrea."**
The original landing page advertised this. It isn't built — there's no NL parser, no LLM client, no `/api/query` route.

**Plan**: a thin `/api/query` endpoint that parses plain English into the typed filter set the issues route already supports. Returns the same shape `/api/issues` does so existing consumers don't need to change.
*Status: Coming soon*

### 🔵 Coming soon — Trinity-bound CI

**Prompt, Tools, Software — tested together.**
The original page promised "CI fails if they drift apart." There is no CI in this repo today, no test suite, no contract tests.

**Plan**: GitHub Actions, lint+typecheck+contract tests on every PR; a separate suite that verifies the Companion (MCP) → API contract once the MCP layer ships.
*Status: Coming soon*

### 🔵 Coming soon — MCP server / agent tools

**A first-class MCP server**
So agents (including Claude, custom agents, etc.) can `create_issue`, `update_issue`, `add_comment`, etc. as native tools.

**Plan**: ship `mcp/` server in this repo, exposing the API as MCP tools with rich JSON schemas. The code sample on the current landing page (`tool: create_issue …`) describes what those tool definitions should look like.
*Status: Coming soon (companion repo / future this-repo work).*

### 🔵 Coming soon — Polish bets

The kind of items that will make the product feel done:

- **Labels** — schema is in place, UI is not.
- **Saved filters / views** — the all-issues page has filters; persisting them is the missing step.
- **Notifications** — in-app + email for `@mentions`, assignments, due dates.
- **Mobile UI** — current pages are desktop-first.
- **Per-scope API tokens** — the `scopes` column exists; enforcement doesn't.
- **Per-project Gantt with critical-path** — current Gantt is render-only.
- **Search** — keyword search across issues; currently filters only.

---

## Surface areas

The landing page should make it obvious that there are **three** ways to use the product. This is unusual — most issue trackers privilege the web. Lean into it.

### Web (`/dashboard`)
For humans. Kanban, Gantt, list, issue detail with rich text, comments, attachments.

### HTTP API (`/api/*`)
JSON in, JSON out. Two auth modes — session cookie (for the web) or `Authorization: Bearer bk_live_…` (for everything else). Documented in `docs/backend.md`. Pagination is cursor-based.

### CLI (`bk`)
Go binary. `bk login` opens a browser to authenticate, drops the token in `~/.config/bk/config.json`, and you're off. Commands for everything the web does, plus `bk undo`. Output as table / JSON / YAML. Stable exit codes for shell scripts and agents.

---

## Architecture summary (for the "How it works" section)

For the "Architecture" / "Under the hood" landing-page section. Show that this isn't a black box.

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Web (you)  │   │  CLI / bk    │   │  Agent / MCP │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │ cookie           │ Bearer token     │  Bearer token
       └─────────┬────────┴───────┬──────────┘
                 │                │
                 ▼                ▼
        ┌─────────────────────────────────┐
        │   Next.js 16 — /api/*           │
        │   Route handlers · validation   │
        │   resolveUser() unifies auth    │
        └─────────────────┬───────────────┘
                          │
                          ▼
            ┌─────────────────────────┐
            │   Postgres 16           │
            │   Drizzle ORM           │
            │   Integer PKs, indexed  │
            │   Transaction log       │
            └─────────────────────────┘
```

Three call-out facts the page can use:

- **Same auth everywhere.** Bearer token or session cookie — pick one per request. The backend doesn't care.
- **One data model.** Every interface reads and writes the same Postgres tables.
- **Reversible by design.** Issue updates are journaled. Broader undo is coming.

---

## Use cases

Concrete scenarios to ground the abstract claims:

### "I'm a solo developer with three side-projects"
Spin it up locally with Docker, sign in with a password, organize work into projects, use Kanban when you're triaging and the list view when you're executing.

### "My agent should manage issues for me"
Mint an API token. Drop it in the agent's config. The agent now reads, writes, comments, and (when MCP ships) executes tools — using the same data you see in the web UI.

### "I scripted a release process"
`bk issue list --status in_review --json | jq '.data[].id' | xargs -I{} bk issue edit {} --status done`
Use stable exit codes to fail-fast in CI.

### "I made a mistake during a bulk update"
`bk undo --count 5`. The five issues you edited are restored to their previous state.

### "I'm comparing this to Linear/Jira"
You won't find sprint planning, custom fields, or advanced permissions yet. You will find a clean API, an honest data model, integer IDs you can dictate, and a CLI that doesn't suck.

---

## Roadmap (Coming soon, grouped)

For a public "What's next" section. Groupings, not specific dates.

### Reliability
- Broader undo (creates, deletes, non-issue resources)
- Batch operations + batched undo
- CI with contract tests
- Performance benchmarks

### Agent ergonomics
- MCP server with native tool definitions
- Natural-language query endpoint
- Per-scope API tokens (read-only / per-project / etc.)

### Product polish
- Labels (UI to a backend that's already there)
- Saved filters / views
- Notifications
- Search
- Mobile-friendly layouts

---

## Brand assets

### Color
- **Primary**: `#0ea5e9` (Tailwind sky-500).
  - Used for: primary buttons, focus rings, gradients, accent strokes, brand mark.
  - Stays identical in light and dark mode.
- **Neutrals**: Tailwind slate-derived OKLCH (defined in `app/globals.css`).
- **Destructive**: red (OKLCH).
- **Charts**: five OKLCH values designed to read in both light and dark.

### Typography
- **Family**: Google Sans. Loaded via Google's CSS API.
  - Note for marketing surfaces with public reach: Google Sans is technically not in the public Google Fonts directory; for any commercial deployment that may attract licensing scrutiny, swap to Inter or DM Sans (both open-licensed and visually similar) — see `docs/frontend.md`.
- **Weights in use**: 400 (body), 500 (mid-emphasis), 700 (display).

### Logo
- File: `public/logo.png`. Used in the header and as favicon.
- Visual: a stylized monochrome mark on a flat surface (current page uses it at 32×32 in the header).

### Voice marks
- `blackcode issues` — always lowercase. Avoid title-case "Blackcode Issues" unless required by a parent context.
- `bk` — the CLI's binary name. Lowercase, mono font.
- `bk_live_…` — token prefix, mono font.

---

## Voice & tone

### What we sound like

- **Direct.** "We log every issue update so you can undo it" beats "leverage advanced audit trails."
- **Specific.** Numbers, formats, examples. `bk login` over "easy CLI authentication."
- **Confident without overclaim.** If a feature is in preview, say so. The product earns more trust by being honest about gaps than by pretending they don't exist.
- **A little dry-witty.** "No more UUID chaos. Just speed." is fine. "Revolutionary AI-powered" is not.

### What we don't sound like

- ❌ Buzzword soup ("synergistic," "next-generation," "leverage")
- ❌ Vague superlatives ("the best," "world-class") with nothing behind them
- ❌ Defensive ("simple and easy" without showing it)
- ❌ Aspirational copy presented as factual

### Phrases we like

- "Three equal interfaces."
- "Integer IDs. No UUID hell."
- "Built for terminals, agents, and people."
- "Coming soon" — used unembarrassed, with a roadmap link.

---

## Sample landing-page outline

A possible structure once the page is rewritten. Each section maps to features above.

1. **Hero**
   - Logo + product name.
   - H1 from one of the [options above](#headline--sub-headline-options).
   - Two CTAs: "Get started" (→ `/login`) and "View on GitHub" or "Read the docs".

2. **Three surfaces** (highlight differentiator)
   - Web · CLI · API — three cards, one sentence each.

3. **Feature grid** (current → new)
   - Mix of Live and In preview cards. Each card carries a small status pill.
   - Suggested initial set: Integer IDs · Three Surfaces · Kanban · Gantt · Rich-text Issues · File Attachments · Undo · Role-based Access · API Tokens · Dark Mode.

4. **How it works**
   - The architecture diagram from above.
   - Three bullets: "Same auth everywhere." "One data model." "Reversible by design."

5. **For agents**
   - A snippet showing `bk issue create --project 1 --title "..." --priority 2 --json`.
   - A second snippet showing the equivalent HTTP `POST /api/issues`.
   - The "coming soon" code sample (`tool: create_issue …`) re-framed as "What MCP integration will look like — coming soon."

6. **Roadmap teaser**
   - 3–5 items from the [Roadmap section](#roadmap-coming-soon-grouped).

7. **Founder / made-with footer**
   - Keep the existing "by minds — carbon and silicon" line if you want; it's distinctive without overpromising.

---

## FAQ seed

For an FAQ section or a "Learn more" page.

### What is the Trinity Architecture?
A three-part design: a *prompt* (the agent's instructions), the *tools* (an MCP server exposing this API), and the *software* (this app, which is the memory). The page may reference all three; today only the software half is in this repo. The MCP layer is on the roadmap.

### Can I self-host?
Yes. The app runs against a Postgres database — Docker Compose provides one locally; managed Postgres (Vercel, Neon, Supabase, RDS) works in production. See `README.md`.

### How do I sign up?
By email + password on `/login`, or with Google if the deployment has OAuth configured.

### Is there a free tier?
For self-hosting, the whole thing is free. There's no hosted SaaS today.

### How do agents authenticate?
Mint an API token at `/dashboard/settings`. Pass it in `Authorization: Bearer bk_live_…`. Tokens carry an optional expiry; tokens can be revoked from the same page.

### How does undo work?
Issue updates are journaled with the previous and new field values. Hitting `POST /api/undo` (or `bk undo`) reverses your most recent changes, up to 10 at a time. Broader coverage is on the roadmap.

### What languages and stacks does the project use?
Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui + Postgres + drizzle on the server. Go for the CLI. See `docs/frontend.md`, `docs/backend.md`, `docs/cli.md`.

### Is it open source?
See the repository for the definitive license. (If contributing publicly, clarify the license on the page itself; this doc deliberately doesn't make a legal claim.)

---

## Status quick-reference

A compact table for when you're laying out a feature grid and need to decide which pill to put on each card.

| Feature | Card title | Status pill |
|---|---|---|
| Integer IDs | "Integer IDs" | Live |
| Web + CLI + API parity | "Three surfaces" | Live |
| Google OAuth + email | "Sign in your way" | Live |
| API tokens | "API tokens for scripts" | Live |
| Project roles | "Role-based access" | Live |
| Project CRUD | "Project management" | Live |
| Milestones | "Milestones" | Live |
| Issue CRUD + workflows | "Full issue workflow" | Live |
| Kanban | "Kanban board" | Live |
| Gantt / timeline | "Timeline view" | Live |
| All-issues list with filters | "All issues, filtered" | Live |
| Rich-text descriptions | "Rich-text editor" | Live |
| Comments | "Conversations on every issue" | Live |
| File attachments | "Attachments" | Live |
| Activity feed | "Activity feed" | Live |
| Dark mode | "Dark mode by default" | Live |
| Undo / rollback (issue updates) | "Reversible by design" | **In preview** |
| Analytics dashboard | "Workspace analytics" | **In preview** |
| 2–15 ms latency claim | "Built for speed" | **Coming soon** |
| Batch operations | "Batch operations" | **Coming soon** |
| Natural-language queries | "Ask in plain English" | **Coming soon** |
| Trinity-bound CI | "Tested together" | **Coming soon** |
| MCP server | "Native agent tools" | **Coming soon** |
| Labels | "Labels" | **Coming soon** |
| Notifications | "Notifications" | **Coming soon** |
| Saved filters | "Saved views" | **Coming soon** |
| Search | "Search" | **Coming soon** |
| Mobile UI | "Mobile" | **Coming soon** |

---

## See also

- [Frontend documentation](./frontend.md) — for build-time facts when wiring the page.
- [Backend documentation](./backend.md) — for accurate technical claims.
- [CLI documentation](./cli.md) — for CLI screenshots and snippets.
