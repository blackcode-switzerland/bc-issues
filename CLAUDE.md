# Blackcode Issues — CLAUDE.md

## Project overview

AI-native issue tracker (Linear-style). Next.js 16 App Router, TypeScript, Tailwind v4, Drizzle ORM + PostgreSQL, next-auth, TanStack Query, Framer Motion.

## Dev commands

```bash
npm run dev      # start dev server (port 3000)
npm run build    # production build
npx tsc --noEmit # type check only
```

## Key architecture

- **`app/`** — Next.js App Router pages + API routes
- **`components/`** — shared UI components; `components/ui/` = primitives
- **`lib/db/`** — Drizzle schema (`schema.ts`), migrations (`migrations/`), query helpers (`queries/`)
- **`lib/`** — auth, utils, work-item constants

## Design system

See memory file `design-system.md` for full details. Short version:

- **Theme**: monochrome Linear-style. `--primary: #007bd3`. Tokens in `app/globals.css`.
- **Dark/light**: `next-themes`, class strategy, `defaultTheme="dark"`.
- **Status/priority colors**: canonical in `lib/work-items.ts` — never hardcode elsewhere.
- **Dialogs**: `useConfirm()` from `components/ui/confirm-dialog.tsx` — never `window.confirm/prompt`.
- **Toasts**: `sonner` — `toast.success` / `toast.error` on all mutations.
- **Page layout**: slim sticky header (`h-11 border-b`), borderless edge-to-edge list rows, no card wrappers in listings.

## Rich text editor

`components/rich-text-editor.tsx` — TipTap-based, used everywhere for descriptions and comments.

- **Slash command** (`/`): H1–H4, Bold, Italic, Strike, Underline, Link, Quote, Code block, Bullet list, Numbered list, Checklist, Attach file.
- **BubbleMenu** (on text selection): full formatting bar — B, I, Strike, Underline, Code, H1–H4, Bullet, Numbered, Checklist, Quote, Link.
- `variant="bordered"` for modals/forms; `variant="seamless"` for detail-page descriptions.
- `hideToolbar` — create-issue-modal sets this; formatting via slash + bubble menus only.
- `onFileUpload?: (file: File) => Promise<string>` — pass `/api/upload` handler to enable paste/drag-drop/slash-attach for **any file type**. Images/video/audio preview inline; PDF gets View+Download; other files get a Download card. After upload, cursor moves to a new line below the attachment.
- `mentionItems` — pass `members.map(m => ({id, label, avatarUrl}))` to enable `@mention` dropdown.

## Create-item UX pattern

"New issue / milestone / project" buttons **do not open a modal**. They POST a minimal record immediately, then `router.push` to the detail page with `?new=1`. On the detail page, `useSearchParams()` detects `?new=1` and auto-focuses + selects the title field so the user can rename right away.

- Issue listing → `POST /api/workspaces/:slug/issues { title: 'New Issue' }` → `/dashboard/issues/:id?new=1`
- Milestone listing → `POST /api/workspaces/:slug/milestones { name: 'New Milestone' }` → `/dashboard/milestones/:id?new=1`
- Project listing → `POST /api/workspaces/:slug/projects { name: 'New Project' }` → `/dashboard/:id?new=1`
- Inside project detail: "New issue" / "New milestone" pre-set `project_id`; per-milestone "+" also pre-sets `milestone_id`.
- Inside milestone detail: "New issue" pre-sets `milestone_id` (and `project_id` if the milestone belongs to one).

The three old create-modal files (`issue-create-modal.tsx`, `milestone-create-modal.tsx`, `project-create-modal.tsx`) have been deleted. `create-issue-modal.tsx` still exists for the kanban "create issue" flow.

## Data fetching

TanStack Query throughout. See memory file `sync-architecture.md` for query key hierarchy, optimistic update patterns, and cache invalidation rules.

## Super admin

Controlled via `SUPER_ADMINS` env var (comma-separated emails) + `email_whitelist` DB table. Pages at `/dashboard/super-admin`. See memory file `super-admin.md`.

## Docs sync rule

**After every code change, check whether any file in `docs/` is now outdated or incomplete, and update it before finishing.** This is mandatory, not optional.

- `docs/frontend.md` — covers components, UI patterns, design system usage, page layouts
- `docs/backend.md` — covers API routes, DB schema, query helpers, auth, migrations
- `docs/cli.md` — covers dev commands, env vars, deployment, tooling

Rules:
- If you add/remove/rename a component, API route, DB table, env var, or command → update the relevant doc.
- If you change behavior (auth flow, data fetching pattern, UX pattern) → update the relevant doc.
- If new functionality has no doc coverage yet → add a section.
- Do NOT add docs for implementation details already obvious from the code; only document intent, contracts, and non-obvious constraints.
