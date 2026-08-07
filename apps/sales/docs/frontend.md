# b/sales — frontend

**This app only.** Platform-wide conventions — the tokens, the
`@blackcode/platform-ui` primitives, the app shell pattern, data fetching — live
in the root [`docs/frontend.md`](../../../docs/frontend.md) and are not repeated
here. An app's docs never describe another app
(`docs/platform-architecture.md` §7.5).

Status: **Phase 6 landed 2026-08-07** — the providers, the shell, the two
dashboard empties and the **Today** page. Phase 7's remaining page groups
(Prospects, prospect detail, the ledgers, the catalog, Metrics, Settings) are
next; the search module is Phase 8 and the write affordances are Phase 9.

---

## 1. The four rules this surface is shaped by

Inherited from the validated mockup (`docs/sales-app-plan.md` §1.2). They are the
product, not the styling, and every one of them is a thing this app must *not*
do:

1. **A ledger, not a control surface.** No chat box, no approve button, no AI
   running in the page. Everything shown is a record of something that already
   happened, written by an agent through `bk sales`. The mockup shipped an
   approval UI on the Today page twice by accident and removed it twice — the
   two screenshots `bs-today.png` and `bs-today-no-approvals.png` are the record
   of it, and **the second is the one to build from.**
2. **Triangulation is why it exists.** Client × Product × Message. The prospect
   page displays the STORED result of matching; the matching runs in the agent,
   never here.
3. **Multi-channel is first class.** A prospect shows "3 emails, 2 WhatsApp,
   1 call" at a glance — communications are not an email log with extras.
4. **Meetings are a ledger, not a calendar.** No month grid, no drag to
   reschedule.

## 2. Visual identity

The palette, the radius and the chart series are tokens in `app/globals.css` and
are documented in [`backend.md` §5](./backend.md) beside the reasoning for the
warm neutrals. Two things belong here instead, because tokens cannot carry them:

- **Density is a component convention.** D-4 gives sales an `h-12` header and
  `py-2`/`py-3` rows against issues' `h-11` and tight ones. There is no token for
  spacing, so the header height in `components/sales-shell.tsx` and the row
  padding in each listing are what make it true.
- **Never hardcode a colour in a component.** Chrome comes from the token
  utilities; **vocabulary colours come from `lib/pipeline.ts` and nowhere else.**

### 2.1 `components/chips.tsx` is the only bridge between the two

Every stage, channel, meeting-type, objection, product, template, document and
next-action badge is the same `Chip` with a different lookup, and each lookup is
one of `lib/pipeline.ts`'s `…Color()` helpers. A component that wanted to name a
hex would have to come through here to do it.

The hex reaches the DOM as an inline `style`, which is deliberate rather than a
shortcut around Tailwind: these are **data** values. The vocabulary is served
live by `bk meta` and can gain a stage without a deploy, so a utility class per
value would be a class that has to exist before the value does — and Tailwind
cannot generate `bg-[#e08658]` for a string it has never seen. The fill is the
colour at low alpha with the colour itself as text, so one hex drives both and
the chip stays legible in either theme without a second value being picked for
dark mode.

> **Nothing in the repo catches a violation of this rule.** Verified on
> 2026-08-07 by hardcoding a stage colour in `chips.tsx`: `npm run typecheck`,
> `npm run lint`, `npm test` and `npm run build` all stayed green, and eslint did
> not even flag the now-unused `stageColor` import. It is a convention held by
> this document and by code review, not by a guard.

## 3. The shape of a page

Thin server page → one `'use client'` feature component → TanStack Query.

```
app/dashboard/[ws]/page.tsx          server: awaits params, renders <TodayPage ws={ws} />
components/today/today-page.tsx      client: the whole page, fetching through hooks
lib/hooks.ts                         the query hooks
lib/client.ts                        apiGet, wsPath, query — the only fetch layer
```

Nothing is fetched on the server. A server-rendered first paint would need a
second copy of the data access, and the two would then have to agree about
caching, errors and empty states.

### 3.1 `lib/client.ts` — same-origin, and read-only by construction

Every fetch is a **path**, never an absolute URL and never an env var pointing at
another deployment (D-10). That is what makes the shared route factories (D-2)
mandatory rather than nice: this app serves its own `/api/upload` and `/api/meta`
because a fetch is not allowed to go and find somebody else's. Cross-app links
(D-18) are the exception and they are not fetches — they are anchors carrying an
absolute `url` the *server* built from the other app's registered `base_url`.

It exports exactly one request function, **`apiGet`**, and there is no
`apiPost`/`apiPatch`/`apiDelete` anywhere in the app. That is how D-7's read-only
default is currently true: a property of the module graph, not of anybody's
intent. Phase 9 is what adds the other verbs, behind the `ui_mode` switch.

Errors carry the server's `{ error, code, suggestion }` through to the browser —
the same body `bk` prints as a `hint:` line. A 400 an agent could act on should
be one a human can act on too.

### 3.2 Wire types are imported, never retyped

`lib/hooks.ts` uses `import type` from `lib/db/queries/aggregates.ts` and
`lib/views.ts`. The imports are erased at compile time, so no server module and
no drizzle client reaches the browser bundle — what survives is that a change to
`TodayResult` becomes a type error in the page that reads it.

### 3.3 Three states, one implementation

`components/states.tsx` — `BlockSkeleton`, `ErrorState`, `EmptyState`. A failed
fetch renders the error, never the empty state: rendering "you have no prospects"
when the API is down is the most reassuring wrong answer this app could give.

## 4. The shell

`components/sales-shell.tsx`. Fixed left rail, sticky `h-12` header, content
right.

- Nav: Today · Metrics · Prospects · Meetings · Communications · Activity, then
  **Catalog**: Products · Templates · Documents.
- **No workspace switcher and no create-workspace flow** (D-3). `/dashboard`
  resolves the single sales workspace and redirects to `/dashboard/{ws}`; more
  than one renders a picker rather than guessing, because landing somebody in the
  wrong workspace is a silent failure.
- Header title defaults to the nav label for the page and is overridable with
  `usePageTitle()` — a prospect detail page's title is a company name and no
  static table can hold it.
- Account footer: name, email, sign out. **No Settings link yet** — that page is
  a later Phase 7 group, and a nav item pointing at a route that does not exist
  is a 404 wearing a working app's clothes.

## 5. The two empties, and why they must differ

`app/dashboard/layout.tsx`.

| | Condition | What it says |
|---|---|---|
| **No memberships** | `listMyWorkspaces(user)` is empty | *"No workspace yet."* Your account exists but belongs to nothing; ask an owner to invite this address |
| **No app access** | memberships exist, `listMyWorkspaces(user, { app: 'sales' })` is empty | *"No access to b/sales."* Names the workspaces you ARE in, and says an owner grants it from Workspace settings → Apps |

Collapsing them shows a member-without-access an onboarding screen that quietly
*works* while hiding the real problem. **Sales' answer to the first differs from
issues'**: issues offers "create your first workspace", and sales cannot — D-3
removes that flow — so the first empty is a statement of fact plus who fixes it.
The property being preserved is that the two say genuinely different things, not
that they say the same things issues says.

> The app-scoped list only filters when **`PLATFORM_ENFORCE_APP_ACCESS`** is on.
> With it off the two lists are identical and the second branch is unreachable —
> that is the kill switch behaving as designed, not the check being broken. Both
> branches were verified on the seeded database with the switch on, 2026-08-07.

## 6. Auth, and the one thing that fails silently

`lib/auth.ts` is this app's NextAuth config. What is app-local (providers,
`pages`) and what is shared (the session cookie, the sign-in callbacks in
`platform-db`) is argued in full in `packages/platform-auth/src/index.ts`; it is
not repeated here. Two things are this app's own:

- **A first sign-in does not create a workspace.** Issues calls
  `ensureDefaultWorkspace`; sales does not, because D-3 leaves no way to see or
  leave a workspace minted that way, and it would arrive with `sales` not enabled
  on it. Pending invitations *are* still materialised.
- **`middleware.ts` must pass `cookies` to `withAuth`.** `getToken` looks for
  `next-auth.session-token` unless told otherwise, and D-16 renamed the platform's
  session cookie to `blackcode.session-token`. Omitting it does not error: the
  user signs in successfully and bounces back to `/login` forever, 200 on every
  request, nothing in the logs. Import `sessionCookieConfig` from the
  **`/session-cookie` subpath** — the package barrel pulls node `crypto` into the
  Edge runtime.

## 7. Today

`components/today/today-page.tsx`. Four blocks: the greeting, the KPI strip,
**upcoming meetings across every prospect as their own block**, and the pipeline
queue.

- The greeting's date comes from `today.date` — the day the *server* computed
  for — not from the browser clock.
- The queue includes **overdue** actions, flagged. Past the due date the stored
  `due_label` is replaced by the computed phrase: the label is a snapshot of how
  the date read when it was written, so an action written last week says "Today"
  forever. Seen on the seeded database, five times.
- `today.due_actions` carries no deal value, so the queue joins against the
  `/prospects` list route it would load for the Prospects page anyway, and
  TanStack shares the cache entry.
- **`GET …/meetings` orders `starts_at DESC`**, which is right for a ledger and
  wrong for "what is next": a small limit returns the furthest-out meetings. The
  hook asks for a full page and sorts ascending, and renders a line saying so
  when there are more than it could load rather than showing a quietly short
  list.
