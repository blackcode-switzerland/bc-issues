# Frontend

The web app: stack, routes, the theme system, the shared component primitives,
and how data flows. **Source of truth is the code** — this describes the app as
it is today (a monochrome, Linear-style dashboard on Next.js 16 + Tailwind v4).

## Table of contents

- [Stack](#stack)
- [Project layout](#project-layout)
- [Configuration files](#configuration-files)
- [Theme & styling system](#theme--styling-system)
- [Routes](#routes)
- [App shell & providers](#app-shell--providers)
- [Components](#components)
- [Shared design primitives](#shared-design-primitives)
- [State & data fetching](#state--data-fetching)
- [Conventions](#conventions)

## Stack

- **Next.js 16** App Router, **React 18**, **TypeScript** (strict).
- **Tailwind v4**, CSS-first — there is **no `tailwind.config`**; tokens and
  utilities are declared in `app/globals.css` via `@theme inline`.
- **TanStack Query** for all server data.
- **next-themes** for light/dark (class strategy).
- **TipTap** for rich text (`components/rich-text-editor.tsx`).
- **sonner** for toasts, **lucide-react** for icons, **date-fns** for dates,
  **@hello-pangea/dnd** for kanban drag-and-drop.
- A few **shadcn-style** primitives live in `components/ui/`, but most UI is
  bespoke Tailwind. `zustand` and `framer-motion` are dependencies but are not
  currently load-bearing — app state is TanStack Query + local React state.

## Project layout

```
app/
  layout.tsx          root layout (fonts, metadata, <Providers>, <Toaster>)
  providers.tsx       client provider tree
  globals.css         Tailwind v4 entry + design tokens + a little legacy CSS
  page.tsx            landing page
  login/              auth (sign-in / sign-up / password reset)
  privacy, terms      marketing/legal
  status/             public status + error pages
  invitations/[token] invitation accept/decline
  cli/authorize       CLI token grant screen
  dashboard/          the authenticated app (see Routes)
  api/                route handlers (documented in docs/backend.md)
components/
  ui/                 primitives (buttons, modal, confirm dialog, date picker,
                      work-item icons, property select, member avatar, …)
  listings/           list/kanban/timeline views + filter bar + bulk actions + active-ws hook
  analytics/          SVG chart kit (charts.tsx) — KpiCard, AreaLineChart, DonutChart,
                      HorizontalBars, ColumnChart, BurndownChart; no external chart lib
  marketing/          public site chrome
  *.tsx               feature components (detail views, create modals, settings)
lib/                  shared client/server helpers (work-items.ts lives here)
```

## Configuration files

- **`tsconfig.json`** — strict; path alias `@/*` → project root; `jsx:
  react-jsx`; `moduleResolution: bundler`.
- **`next.config.js`** — allows `lh3.googleusercontent.com` images (Google
  avatars); Server Actions origin allow-list for localhost + the Vercel domain.
- **`postcss.config.js`** — single plugin `@tailwindcss/postcss` (Tailwind v4).
- **`components.json`** — shadcn config: `style: new-york`, `baseColor: slate`,
  CSS variables on, `css: app/globals.css`, **no** tailwind config path,
  aliases (`@/components`, `@/lib/utils`, `@/components/ui`), `lucide` icons.
- **No `tailwind.config.(js|ts)`** — intentional; Tailwind v4 is configured in
  CSS.

## Theme & styling system

### One source of truth

`app/globals.css` is the only place to re-theme. It has three blocks:

1. **`:root` / `.dark`** — the token **values** in OKLCH.
2. **`@theme inline`** — maps Tailwind utilities (`bg-primary`, `text-muted-
   foreground`, …) to those variables. You rarely touch this.
3. A small **legacy / component-CSS** tail (kanban classes, the `.prose`
   TipTap output styles, the `.mention` chip, scrollbars).

### The palette

Surfaces are **pure neutral** (OKLCH chroma 0 — a true monochrome
black/white/gray system in the Linear spirit). The only chromatic tokens are:

- **`--primary: #007bd3`** — the single brand accent (buttons, selection, focus
  rings, `--ring`, sidebar/chart-1).
- **`--destructive`** — red, for dangerous actions.

Both light (`:root`) and dark (`.dark`) are defined; default is dark. Status and
priority colors are **not** here — they're canonical in `lib/work-items.ts` and
rendered by the work-item icon set.

### Fonts

`--font-sans` is **Google Sans** (loaded via a `<link>` to Google Fonts in
`app/layout.tsx`, not `next/font`). `--font-mono` is a real mono stack used for
tabular IDs.

### Re-theming

Change the brand accent by editing `--primary` (and `--ring`,
`--sidebar-primary`, `--chart-1`) in both `:root` and `.dark`. To shift surfaces
off pure-neutral, give the OKLCH values a non-zero chroma. Don't hard-code
colors in components — use the token utilities.

### Notable CSS helpers

- **Toast bridge** — `--toast-bg/-text/-border` are read by the `<Toaster>`
  inline style so sonner matches the theme.
- **`.mention`** — the `@mention` chip style used inside TipTap content.
- **Marketing backgrounds** — `.bg-grid*`, `--brand-gradient`, `--hero-glow`,
  `.text-gradient-brand` for the public pages.
- **Legacy** — `.kanban-*`, `.status-*`, and `.prose` are older classes still
  used in a few spots; new work uses the shared primitives and token utilities.
  (The `.status-blocked` / `.status-in_review` classes are leftovers — those
  statuses no longer exist.)

## Routes

### Public

| Path | Renders |
|------|---------|
| `/` | Landing page (`LandingPage`) |
| `/login` | Sign-in / sign-up tabs + password-reset flow |
| `/blocked` | Shown when a non-whitelisted email tries Google OAuth; professional "not on the list" page |
| `/privacy`, `/terms` | Legal pages (marketing layout) |
| `/status` | Public health page (DB / blob / app probes + recent errors) |
| `/status/errors/[id]` | Error detail (owner-gated) |
| `/invitations/[token]` | Accept/decline a workspace invite |
| `/cli/authorize` | Grant a token to the `bk` CLI |

### Authenticated (`/dashboard`, guarded by `middleware.ts` + the dashboard layout)

Workspace-scoped pages live under `/dashboard/[ws]/…` (see "Workspace-scoped
URLs" above). Detail pages use the workspace #number (`seq`); labels use the id.

| Path | Renders |
|------|---------|
| `/dashboard/[ws]` | Projects listing (`ProjectsListing`) |
| `/dashboard/[ws]/projects/[seq]` | Project detail (`ProjectDetailView`) |
| `/dashboard/[ws]/issues` · `/issues/[seq]` | Issues listing · issue detail |
| `/dashboard/[ws]/tasks` · `/tasks/[seq]` | Tasks listing · detail |
| `/dashboard/[ws]/labels` · `/labels/new` · `/labels/[id]` | Labels listing · create page (`LabelCreateView`) · detail (`LabelDetailView`, inline-editable name/color + associated issues) |
| `/dashboard/[ws]/members` · `/members/invite` | Workspace members + invitations |
| `/dashboard/[ws]/activity` | Activity feed |
| `/dashboard/[ws]/analytics` · `/analytics/print` | Analytics · print-to-PDF view |
| `/dashboard/[ws]/trash` | Recycle bin |
| `/dashboard/inbox` | Notifications (cross-workspace, unscoped) |
| `/dashboard/settings/{profile,account,tokens,workspace}` | Settings (own sub-layout + nav, unscoped) |
| `/dashboard/super-admin/*` | Super-admin pages (unscoped) |
| `/dashboard/workspaces` | Workspace manager (`WorkspacesView`) — list + switch; **Manage** shown to owners only |
| `/dashboard/workspaces/new` | Create-workspace page (`WorkspaceCreateView`) — replaces the old modal in this flow |
| `/dashboard/workspaces/[slug]` | Per-workspace settings (`WorkspaceSettingsView`) |

Legacy `/dashboard`, `/dashboard/issues/[id]`, `/dashboard/tasks/[id]`, and old
`/dashboard/{projectId}` paths still resolve — they redirect to the canonical
`/dashboard/{ws}/…` URLs. `WorkspaceCreateModal` is still used by
`OnboardingCreateWorkspace` (the forced first-workspace screen).

`app/dashboard/layout.tsx` validates the session, shows
`OnboardingCreateWorkspace` when the user has no workspace, and renders the
sidebar shell (`DashboardLayout`). It is `force-dynamic`.

`app/dashboard/super-admin/layout.tsx` additionally guards its sub-tree with a
server-side `isSuperAdmin(user.email)` check and redirects non-admins to
`/dashboard`.

## App shell & providers

`app/layout.tsx` sets metadata + the Google Sans `<link>`, renders
`<html lang="en" suppressHydrationWarning>`, mounts `<Providers>`, and a sonner
`<Toaster position="bottom-right">` styled from the toast-bridge variables.

`app/providers.tsx` nests, outermost → innermost:

```tsx
<SessionProvider>                 {/* NextAuth */}
  <QueryClientProvider>           {/* staleTime 60s, refetchOnWindowFocus off */}
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem
                   disableTransitionOnChange>
      <ConfirmProvider>           {/* imperative confirm/prompt — useConfirm() */}
        {children}
```

## Components

### `components/ui/` — primitives

shadcn-style: `button`, `input`, `label`, `card`, `badge`, `alert`, `accordion`,
`tabs`, `separator`. Plus the **bespoke shared primitives** below.

### `components/` — feature components (grouped)

- **Shell:** `dashboard-layout`, `workspace-switcher`, `inbox-badge`,
  `settings-nav`, `super-admin-nav`.
- **Listings (`components/listings/`):** `projects-listing` (+ `projects-kanban`,
  `projects-timeline`), `issues-listing` (+ `issues-kanban`, `issues-timeline`),
  `tasks-listing` (list-only — no kanban/timeline view), plus `filter-bar`
  (`MultiSelect`, `SearchInput`, `ViewToggle`), `labels-pill`,
  (Projects listing filters: Status / Priority / Lead; Tasks listing filters:
  Project / Lead. Both show an inline-editable **Lead** column and the task
  detail sidebar has a **Lead** property — mirrors projects.)
  Filter/search/view state on all three listings persists across navigation via
  `usePersistentState` (`use-persistent-filters.ts`) — an in-memory, per-workspace
  store that survives client-side navigation (open a detail, come back) but
  resets on a full reload. Selection state is intentionally **not** persisted.
  A **Sort** control (`SortSelect` + `sort.ts`, client-side: Manual/Name/Newest/
  Oldest/Updated, plus Priority+Due for issues/projects, Due for tasks) sets the
  order. Drag-to-reorder (`position`) is **only enabled under "Manual"**; other
  sorts disable the drag handle. In kanban, a non-manual sort disables in-column
  reorder but cross-column status-drag still works. Drag-reorder mutations
  invalidate the listing query in `onSettled` so the new order survives
  navigation (previously the optimistic order was lost until a reload).
  List rows animate to their new order on sort change: the list view branches
  on `dragEnabled` — manual → `@hello-pangea/dnd` (dnd owns motion), sorted →
  `motion.li` with `layout` (the two libs don't share an element, avoiding
  conflicts). Detail-page inline title edits write the new title to the query
  cache optimistically (`setQueryData`) so clearing the draft doesn't flash the
  old title during the PATCH + refetch.
  `bulk-action-bar` (multi-select toolbar for batch status/delete), and the
  `use-active-workspace` hook.
- **Detail views:** `project-detail-view`, `issue-detail-view`,
  `task-detail-view`.
- **Create / edit modals:** `issue-create-modal` (kanban flow only — all other
  "new" buttons POST immediately then redirect to the detail page with `?new=1`),
  `project-settings-modal`, `workspace-create-modal`.
- **Management views:** `members-view`, `project-members-panel`, `labels-view`,
  `activity-view` (full workspace feed page), `activity-feed` (reusable feed
  component used by the activity page and issue/project detail sidebars),
  `comment-section` (reusable polymorphic comment thread), `analytics-view`
  (see Analytics dashboard below), `print-analytics-view`, `inbox-view`,
  `trash-view` (recycle bin —
  `/dashboard/trash`), `workspaces-view` (workspace manager at
  `/dashboard/workspaces`).
- **Settings:** `profile-settings-view`, `account-settings-view`,
  `api-tokens-settings`, `workspace-settings-view`.
- **Super admin:** `super-admin-users-view` (platform-wide member table with workspace count),
  `super-admin-whitelist-view` (add/remove allowed domains and emails),
  `super-admin-errors-view` (error log with status/level/date filters, stat cards,
  expandable rows showing stack + sanitized context, resolve/reopen toggle,
  row checkboxes + select-all for bulk delete, and single-row delete;
  destructive actions go through `useConfirm()`; `useInfiniteQuery` cursor pagination).
  All visible only when `me.is_super_admin === true` (from `/api/me`).
- **Client error capture:** `app/error.tsx` (React error boundary, render errors) and
  `global-error-listener` (mounted in `Providers`; catches `window.onerror` +
  unhandled promise rejections, de-duped and capped per session) both POST to
  `/api/errors/client`, feeding the super-admin Errors tab.
- **Auth & marketing:** `landing-page`, `cli-authorize-form`,
  `password-reset-flow`, `onboarding-create-workspace`,
  `accept-invitation-button`, `components/marketing/*`.
- **Helpers:** `rich-text-editor`, `project-icon`, `icon-picker`,
  `image-upload-field`, `image-lightbox`.

> **Legacy / orphaned (safe to ignore — not imported by any route):**
> `project-view.tsx` and its private subtree — `kanban-board.tsx`,
> `issue-list-view.tsx`, `gantt-view.tsx`, `create-issue-modal.tsx` — plus
> `timeline-view.tsx`. These predate the listings rewrite. (`dashboard.tsx` is
> **not** dead — it's a shared utility module imported widely.)

## Analytics dashboard (`analytics-view.tsx`)

The `/dashboard/analytics` page is a multi-tab BI dashboard over the analytics
payload (see `docs/backend.md` → *Analytics contract*). All chart primitives
live in `components/analytics/charts.tsx` (hand-rolled themed SVG — **no chart
library**; use `var(--primary)` and the `SERIES` palette, never hardcode the
old `#5e6ad2`).

- **Controls (sticky):** a scope segmented control (Workspace / Project /
  Task / Member) with a searchable target picker; a granularity toggle
  (Daily / Weekly); date-range presets (7D/30D/90D/12M/All) + a Custom range
  built from two `DatePicker` chips; and a faceted **filter bar** (Status /
  Priority / Assignee / Label multi-selects via `FilterMenu`, with an active
  count badge and "Clear all"). Every control feeds the React Query key, so the
  whole dashboard refetches as one.
- **Tabs:** Overview (KPI grid + velocity + status/priority/project), Throughput
  (velocity, cumulative flow, cycle-time + aging histograms), Workload (assignee
  table, labels), Activity (event series + by-action + top members), and —
  task scope only — Burndown.
- **Export:** "PDF" opens `/dashboard/analytics/print` (the same payload,
  forwarding **all** params incl. filters + interval + theme, then auto-prints).
  "CSV" downloads a client-built summary + velocity table.
- Chart kit: `KpiCard` (value + `TrendBadge` vs. previous period + sparkline),
  `AreaLineChart` (multi-series, gradient fill, hover crosshair + tooltip),
  `DonutChart`, `HorizontalBars`, `ColumnChart` (histograms), `BurndownChart`.

## Shared design primitives

Use these instead of rolling new ones — they keep every surface (listings,
kanban, detail pages, modals) rendering work-item state identically.

- **`components/ui/work-item-icons.tsx`**
  - `StatusIcon({ status, size? })` — backlog dashed circle · todo/planned empty
    circle · in_progress yellow half-pie · done/completed indigo check ·
    cancelled gray ✕.
  - `PriorityIcon({ priority, size? })` with `issuePriorityKey(1..5)` /
    `projectPriorityKey('P0'..'P4')` → urgent ! square · high/medium/low signal
    bars · none dashes.
  - `HealthIcon({ status, size? })` — project update health sparkline:
    `on_track` green rising · `at_risk` amber wavy · `off_track` red falling ·
    `null` dashed "no updates".
  - `ProgressRing({ pct, size?, color? })` — circular percent ring.
- **`components/ui/member-avatar.tsx`** — `MemberAvatar({ name, email,
  avatarUrl, size? })`; image when present, else initials on a deterministic
  hashed color.
- **`components/ui/multi-assignee-select.tsx`** — `MultiAssigneeSelect({ assignees, members, onChange, compact?, align? })`. Multi-select assignee picker that renders stacked `MemberAvatar`s (up to 2, then "+N") and a searchable checkbox dropdown. `onChange` receives the full `number[]` of selected user IDs. Use `compact` mode for tight list rows. Replaces the old single-value `PropertySelect` for assignees everywhere.
- **`components/ui/property-select.tsx`** — `PropertySelect` quiet chip-button
  opening a searchable, keyboard-navigable popover. Replaces native `<select>`
  in detail sidebars and create modals. Options take an optional `icon`.
- **`components/ui/date-picker.tsx`** — `DatePicker({ value, onChange,
  variant: 'chip' | 'inline', label?, align? })`. `value` is a `yyyy-MM-dd`
  string (tolerates ISO); timezone-safe (parsed as a local day). Calendar
  popover; replaces all native `<input type="date">`.
- **`components/ui/confirm-dialog.tsx`** — `ConfirmProvider` + `useConfirm()`:
  `confirm(opts) → Promise<boolean>` and `prompt(opts) → Promise<string|null>`
  (supports `requireMatch` for type-to-confirm deletes). Use this instead of
  `window.confirm/alert/prompt`.
- **`components/ui/delete-with-children-dialog.tsx`** — `DeleteDialogProvider` +
  `useDeleteDialog()`: `confirmDelete(opts) → Promise<{mode:'cascade'|'detach'}|null>`.
  Used when deleting a project or task — fetches live child counts from
  `?preview=1` and shows a cascade-vs-detach toggle before confirming. Wrap the
  app in `<DeleteDialogProvider>` (done in `app/providers.tsx`).
- **`components/ui/restore-conflict-dialog.tsx`** — controlled dialog rendered by
  `trash-view.tsx` when a dry-run restore returns conflicts. Shows per-item
  `restore_parent` / `standalone` choice; calls `onConfirm(resolutions)`.
- **`components/ui/modal.tsx`** — `Modal` overlay (backdrop blur, animate-in,
  ESC/overlay close, scroll lock).
- **`components/rich-text-editor.tsx`** — TipTap.
  - `RichTextEditor({ content, onChange, placeholder?, editable?, onFileUpload?,
    hideToolbar?, minHeight?, variant: 'bordered' | 'seamless', mentionItems?,
    onBlur? })`. `seamless` is for always-editable detail-page bodies; `bordered`
    for modals/composers. A **bubble menu** appears on selection and a **floating
    menu** on empty lines. Passing `mentionItems` (`{ id, label, avatarUrl? }[]`)
    enables `@mentions` (tippy dropdown; the `.mention` chip styles it).
  - `RichTextDisplay({ content })` — read-only render.
  - `MentionItem` — the mention item type.

## Workspace-scoped URLs

All workspace content lives under **`/dashboard/{ws}/…`** where `{ws}` is the
workspace **slug**. Detail URLs use the workspace-scoped **#number (`seq`)**, not
the global id — so the URL matches the number shown in the UI:

```
/dashboard/{ws}                     workspace home (projects)
/dashboard/{ws}/issues/{seq}        issue detail
/dashboard/{ws}/tasks/{seq}         task detail
/dashboard/{ws}/projects/{seq}      project detail
/dashboard/{ws}/{labels|members|activity|analytics|trash}
```

Unscoped (user/platform) routes stay flat: `/dashboard/inbox`,
`/dashboard/settings/*`, `/dashboard/workspaces`, `/dashboard/super-admin/*`.

**URL is the source of truth for the active workspace.** `useActiveWorkspace()`
reads the `ws` route param (falling back to the user's remembered default on
unscoped pages). The `app/dashboard/[ws]/layout.tsx` server layout gates
membership (redirect to `/dashboard` if not a member) and `PersistActiveWorkspace`
records it as the default. The bare `/dashboard` redirects to the default
workspace.

**The `{seq}` IS the id.** The API addresses projects/tasks/issues by the
workspace #number directly (the server resolves seq→internal id), so detail
pages just render the view with the seq — no preflight, no second id. The views
(`IssueDetailView` / `TaskDetailView` / `ProjectDetailView`) take the seq as
their `issueId`/`taskId`/`projectId` and an optional `workspaceSlug`, and fetch
`/api/workspaces/{ws}/{type}/{seq}` (+ sub-resources by the same seq). See
`docs/api-changelog.md`.

There is **no legacy id mapping** — old global-id links are not redirected.

**Inbox** is cross-workspace: each message's `workspace_id` is passed as
`workspaceSlug`, and the entity's seq (`payload.entity_seq` / `payload.issue_seq`)
as the id, so previews open for items in any workspace with no workspace switch.

## State & data fetching

### TanStack Query

Configured in `providers.tsx` with `staleTime: 60s` and
`refetchOnWindowFocus: false`. The active workspace is resolved by
`components/listings/use-active-workspace.ts` (`['active-workspace']`), which
reads `/api/me` then `/api/workspaces`.

Recurring query-key conventions:

| Key | Scope |
|-----|-------|
| `['active-workspace']` | current workspace context |
| `['ws-projects-listing', slug, filters]`, `['ws-issues', slug, filters]`, `['ws-tasks-listing', slug, filters]` | listing pages |
| `['ws-members', slug]`, `['ws-projects', slug]`, `['ws-labels', slug]`, `['ws-tasks', slug]` | dropdown sources in modals |
| `['project', id, slug]`, `['issue', id]`, `['task', id, slug]` | detail pages |
| `['project-updates', id, slug]`, `['project-members', id]`, `['*-comments', id]` | detail sub-resources |
| `['inbox', unreadOnly]`, `['inbox-unread']` | inbox + badge |
| `['ws-activity', …]`, `['ws-analytics', …]` | activity / analytics |
| `['ws-trash', slug, type]` | trash (recycle bin) listing |
| `['workspace-members', slug]`, `['workspace-invitations', slug]` | settings |

After a mutation, invalidate both the detail key and the relevant listing key
(e.g. posting a project update invalidates `['project-updates', id]`,
`['project', id]`, and `['ws-projects-listing']` so the listing's health column
refreshes).

### Toasts

`import { toast } from 'sonner'`. Every mutating action should
`toast.success`/`toast.error`. Quiet autosaves (e.g. issue/project description)
deliberately skip success toasts and show an inline "Saving…" indicator instead.

## Conventions

- **Where things live:** primitives in `components/ui/`, feature components in
  `components/`, listing views in `components/listings/`, shared data helpers in
  `lib/`. Status/priority/health values + colors are canonical in
  `lib/work-items.ts` — never hard-code them.
- **Client vs server:** dashboard pages are thin server components that render a
  `'use client'` feature component which does the data fetching with TanStack
  Query.
- **Forms & mutations:** local `useState` for form fields → `useMutation` →
  `toast` on settle → `queryClient.invalidateQueries`. Use the shared
  `PropertySelect` / `DatePicker` / `RichTextEditor` rather than native inputs
  so the look stays consistent.
- **Page chrome:** in-app pages use a slim sticky header
  (`h-11 border-b bg-background/80 backdrop-blur`) and edge-to-edge borderless
  list rows (`px-6 hover:bg-secondary/40`) — no boxed `rounded-lg border` list
  containers. Detail pages are a centered `max-w-3xl` document column + a right
  properties sidebar of `PropertySelect` rows.
- **Confirmations:** use `useConfirm()`, never the native browser dialogs.
