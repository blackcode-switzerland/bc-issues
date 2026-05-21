# Frontend

End-to-end reference for the blackcode-issues web app: stack, configuration, the theme system, how to add UI components, and where to put new things.

---

## Table of contents

1. [Stack](#stack)
2. [Project layout](#project-layout)
3. [Configuration files](#configuration-files)
4. [Theme & styling system](#theme--styling-system)
5. [Typography](#typography)
6. [shadcn workflow](#shadcn-workflow)
7. [Routes](#routes)
8. [Components](#components)
9. [State & data fetching](#state--data-fetching)
10. [Auth on the client](#auth-on-the-client)
11. [Conventions for future development](#conventions-for-future-development)
12. [Recipes](#recipes)

---

## Stack

| Layer | Library | Version | Purpose |
|---|---|---|---|
| Framework | Next.js | 16.1.4 | App Router, route handlers, server/client components |
| UI runtime | React | 18.3.1 | |
| Language | TypeScript | 5.6.2 | strict mode |
| CSS | Tailwind | 4.3.0 | CSS-first config (no `tailwind.config.ts`) |
| Component scaffolding | shadcn/ui (`new-york`, base `slate`) | latest | Copy-paste primitives under `components/ui/` |
| Headless primitives | `radix-ui` umbrella | 1.4.3 | Accessibility for Button/Dialog/etc. |
| Class composition | `clsx`, `tailwind-merge`, `class-variance-authority` | | `cn()` helper + variant systems |
| Animations | `tw-animate-css` | 1.4.0 | CSS animation utilities used by shadcn |
| Higher-level animations | `framer-motion` | 11.5.4 | Page/component motion |
| Theme switching | `next-themes` | 0.4.6 | Class-based dark mode |
| Icons | `lucide-react` | 0.447.0 | |
| Server state | `@tanstack/react-query` | 5.56.2 | Fetching + caching |
| Client state | `zustand` | 4.5.5 | Installed; not currently used |
| Auth | `next-auth` | 4.24.7 | Sessions + OAuth |
| Toasts | `sonner` | 1.5.0 | |
| DnD | `@hello-pangea/dnd` | 16.6.0 | Kanban |
| Rich text | `@tiptap/*` | 2.27.x | Issue descriptions + comments |
| HTML sanitization | `dompurify` | 3.3.1 | TipTap output sanitization |
| Date math | `date-fns` | 3.6.0 | |

Fonts: **Google Sans** loaded via `<link>` in `app/layout.tsx` (it's not in the `next/font/google` directory).

---

## Project layout

```
/
├── app/                      # Next.js App Router
│   ├── api/                  # Route handlers — see docs/backend.md
│   ├── cli/                  # CLI OAuth flow page(s)
│   ├── dashboard/            # Authenticated app
│   ├── login/                # /login page
│   ├── globals.css           # Theme tokens + base layer + legacy styles
│   ├── layout.tsx            # Root layout (head, Providers, Toaster)
│   ├── page.tsx              # Landing page (server component)
│   └── providers.tsx         # QueryClient + SessionProvider + ThemeProvider
├── components/
│   ├── ui/                   # shadcn primitives (you own these files)
│   └── …                     # Feature components
├── lib/
│   ├── auth/                 # Server-side auth helpers
│   ├── db/                   # Drizzle schema + query helpers
│   └── utils.ts              # `cn()` helper
├── types/                    # Shared TS types + NextAuth declaration merging
├── public/                   # Static assets, /uploads/ (dev only)
├── components.json           # shadcn config
├── postcss.config.js         # Tailwind v4 PostCSS plugin
├── tsconfig.json
├── next.config.js
├── middleware.ts             # Route protection for /dashboard/*
└── drizzle.config.ts
```

---

## Configuration files

### `tsconfig.json`

| Setting | Why |
|---|---|
| `"paths": { "@/*": ["./*"] }` | Lets us write `@/components/ui/button` instead of `../../../components/...` |
| `"strict": true` | All strictness flags on |
| `"jsx": "react-jsx"` | React 18 transform |
| `"moduleResolution": "bundler"` | Modern module resolution; needed for shadcn CLI and Next 16 |
| `"plugins": [{ "name": "next" }]` | Next's TS plugin for `params`/`searchParams` typing |

If you add a new top-level directory you want to import as `@/foo/...`, no changes needed — the wildcard covers it.

### `next.config.js`

- `images.remotePatterns` — whitelists `lh3.googleusercontent.com` so Google avatars load through `next/image`.
- `experimental.serverActions.allowedOrigins` — limits Server Actions to localhost and the deployed origin.

Add a new image source: append to `remotePatterns`.
Add a new origin (e.g. a preview URL): append to `allowedOrigins`.

### `postcss.config.js`

```js
module.exports = {
  plugins: { '@tailwindcss/postcss': {} },
}
```

That's the whole story in v4. No `tailwindcss` plugin, no `autoprefixer` (Tailwind v4 has it built in).

### `components.json` (shadcn)

```json
{
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "utils": "@/lib/utils",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- `tailwind.config: ""` — empty because we're on Tailwind v4 (no JS/TS config file).
- `style: "new-york"` — slightly tighter spacing and refined defaults vs `default`.
- `baseColor: "slate"` — the neutral hue family. Pairs with the sky-500 primary.

Changing the base color later (e.g. to `zinc` or `neutral`) requires regenerating the tokens; see [Re-theming](#re-theming).

### `middleware.ts`

NextAuth's `withAuth` guards `/dashboard/*`. Unauthenticated requests redirect to `/login`. The matcher is in `config.matcher`.

### Environment

Required in `.env.local`:

```env
DATABASE_URL=postgres://blackcode:blackcode_dev@localhost:5434/blackcode_issues
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=$(openssl rand -base64 32)
```

Optional:

```env
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
BLOB_READ_WRITE_TOKEN=…       # for production uploads to Vercel Blob
```

Without Google credentials, the OAuth button just doesn't render — the email/password flow still works.

---

## Theme & styling system

Everything lives in **`app/globals.css`**. There is no Tailwind config file in v4; theme tokens are CSS variables, and `@theme inline` maps them to Tailwind utility names.

### Three blocks, one source of truth

```css
@import "tailwindcss";          /* the framework */
@import "tw-animate-css";       /* shadcn animations */

@custom-variant dark (&:is(.dark *));   /* class-based dark mode */

:root  { --primary: #0ea5e9; … }        /* VALUES — light */
.dark  { --primary: #0ea5e9; … }        /* VALUES — dark */

@theme inline {                          /* MAPPING (don't normally touch) */
  --color-primary: var(--primary);
  --color-background: var(--background);
  --radius-lg: var(--radius);
  --font-sans: "Google Sans", sans-serif;
  …
}
```

The mental model:

```
You edit  →  :root / .dark
                  │
                  ▼
            @theme inline
                  │
                  ▼
            bg-primary, text-primary, border-primary, …
```

`@theme inline` is shadcn v4's convention. The `inline` keyword means "substitute the var references at build time" — without it you'd get nested `var(var(--primary))` which doesn't work in shadow CSS contexts.

### Token reference

Every value below is OKLCH (perceptually uniform) except the brand pins (`--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring`) which are pinned to the exact hex `#0ea5e9`.

#### Light (`:root`)

| Variable | What it controls |
|---|---|
| `--background` | page background |
| `--foreground` | body text |
| `--card` / `--card-foreground` | elevated surfaces |
| `--popover` / `--popover-foreground` | dropdowns, menus, tooltips |
| `--primary` / `--primary-foreground` | brand accents, primary buttons, focus rings, gradients |
| `--secondary` / `--secondary-foreground` | neutral surfaces and buttons |
| `--muted` / `--muted-foreground` | subdued backgrounds; secondary text color |
| `--accent` / `--accent-foreground` | hover states |
| `--destructive` / `--destructive-foreground` | errors, destructive buttons |
| `--border` | dividers, card outlines |
| `--input` | input field borders |
| `--ring` | focus ring |
| `--chart-1` … `--chart-5` | data-viz series colors |
| `--sidebar-*` | sidebar primitive (when you add it) |
| `--radius` | base border-radius (10 px = `0.625rem`). The `@theme` block derives `--radius-sm/-md/-lg/-xl` from this. |

#### Dark (`.dark`)

Same variable names, dark-mode values. `--primary` stays `#0ea5e9` so brand color doesn't shift. `--border` and `--input` use `oklch(1 0 0 / 10%)` and `15%` — white at low alpha, which produces subtle dividers on the dark background.

### Re-theming

**Quick brand swap** (one-color rebrand):
1. Edit `--primary` and `--ring` in `:root` and `.dark` of `app/globals.css`.
2. Save. Done.

Every `bg-primary`, `text-primary`, focus ring, gradient, hover state and shadcn primitive updates automatically.

**Wholesale palette change**:
1. Either use the [shadcn theme picker](https://ui.shadcn.com/themes) and copy its `:root` / `.dark` blocks over ours, or hand-tune the neutrals.
2. Keep the variable names — only edit values.
3. If you change `baseColor` in `components.json`, future `shadcn add` commands will emit a different palette; reconcile your existing primitives or run `--overwrite`.

### Opacity utilities

Tailwind v4 supports opacity modifiers on any variable color:

```tsx
<div className="bg-primary/20 border-primary/50 hover:bg-primary/30" />
```

That works because the tokens are bare colors (not `hsl(...)` strings). You don't need to do anything special; this is the v4 default.

### Legacy classes

These are still in `globals.css` because existing components depend on them. They will be removed as the revamp replaces them with shadcn primitives.

| Class | Where it's used today | Replacement target |
|---|---|---|
| `.kanban-column`, `.kanban-card` | `components/kanban-board.tsx`, `app/dashboard/milestones/[id]/page.tsx` | `<Card>` |
| `.status-badge`, `.status-{state}` | issue lists, kanban, milestone pages | `<Badge variant="…">` |
| `.prose *` | TipTap rich-text output | `@tailwindcss/typography` plugin (deferred) |
| `.ProseMirror` | TipTap editor (placeholder, focus) | **permanent** — required by TipTap |

When you replace a component, delete its legacy class too.

### Toast bridge

```css
:root {
  --toast-bg: var(--popover);
  --toast-text: var(--popover-foreground);
  --toast-border: var(--border);
}
```

`<Toaster>` in `app/layout.tsx` reads these as inline styles, so toasts pick up the theme automatically.

### Scrollbars

WebKit-only styling at the end of `globals.css`. Uses `color-mix(in oklch, …)` to derive transparent variants from `--muted-foreground` — automatically themed.

---

## Typography

Google Sans is loaded by these tags in `app/layout.tsx`:

```tsx
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap"
/>
```

In `globals.css`, the `@theme inline` block declares:

```css
--font-sans: "Google Sans", sans-serif;
--font-mono: "Google Sans", monospace;
```

`<body>` carries `font-sans antialiased`, plus `font-feature-settings: "rlig" 1, "calt" 1;` for ligatures.

> **Heads-up**: Google Sans is not in the public Google Fonts directory — Google serves it for embedded use even though you can't search for it on fonts.google.com. For commercial deployments where licensing matters, swap to Inter or DM Sans (both are open-licensed) — change the `<link>` URL and the `--font-sans` value.

---

## shadcn workflow

shadcn isn't a runtime library you import from `node_modules`. Instead, its CLI copies primitives into `components/ui/` where you own the source. Edits are permanent (no version drift). The CLI installs any Radix peer deps it needs.

### Currently installed

```
components/ui/
├── button.tsx     # 6 variants × 5 sizes
├── card.tsx       # Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
├── input.tsx
├── label.tsx
└── badge.tsx      # variants for status/tag chips
```

### Adding more

```bash
npx shadcn@latest add dialog dropdown-menu select avatar tabs separator tooltip skeleton
```

The CLI:
- Reads `components.json`, writes new file(s) to `@/components/ui/`.
- Installs the Radix peer deps it needs (e.g. `radix-ui` is the umbrella package; new primitives just use existing exports from it).
- Doesn't touch `globals.css` or shared config.

After a successful add, import and use:

```tsx
import { Dialog, DialogTrigger, DialogContent } from '@/components/ui/dialog'
```

### Customizing a primitive

Open `components/ui/<name>.tsx` and edit. The Button file, for example, defines `buttonVariants` via `cva()` — changing the `default` variant class string changes every default button in the app.

To re-emit a primitive (e.g. after a shadcn upstream update):

```bash
npx shadcn@latest add button --overwrite
```

### The `cn()` helper

`lib/utils.ts`:

```ts
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Use it any time you need to merge conditional classes. `clsx` handles the conditional logic; `tailwind-merge` collapses conflicts (`p-2 p-4` → `p-4`).

```tsx
<button className={cn(
  'rounded-md px-4 py-2',
  active && 'bg-primary text-primary-foreground',
  className,
)} />
```

---

## Routes

### Public

| Path | File | Type | Description |
|---|---|---|---|
| `/` | `app/page.tsx` | Server | Landing — redirects to `/dashboard` if logged in. |
| `/login` | `app/login/page.tsx` | Client | Sign-in / sign-up: email-password + optional Google OAuth. |
| `/cli/authorize` | `app/cli/authorize/page.tsx` | Client | OAuth-style consent screen for `bk login` (see [CLI doc](./cli.md)). |

### Authenticated (guarded by middleware)

| Path | File | Type | Description |
|---|---|---|---|
| `/dashboard` | `app/dashboard/page.tsx` | Server | Projects grid. |
| `/dashboard/[projectId]` | `app/dashboard/[projectId]/page.tsx` | Client | Project view — Kanban / Gantt / list, members panel, settings. |
| `/dashboard/issues` | `app/dashboard/issues/page.tsx` | Client | All issues across projects, with filters and sort. |
| `/dashboard/issues/[id]` | `app/dashboard/issues/[id]/page.tsx` | Client | Issue detail — TipTap description, comments, attachments, activity. |
| `/dashboard/milestones` | `app/dashboard/milestones/page.tsx` | Client | Milestone list / timeline with zoom. |
| `/dashboard/milestones/[id]` | `app/dashboard/milestones/[id]/page.tsx` | Client | Milestone detail with its issues. |
| `/dashboard/activity` | `app/dashboard/activity/page.tsx` | Client | Global activity feed. |
| `/dashboard/analytics` | `app/dashboard/analytics/page.tsx` | Client | Admin-only charts. |
| `/dashboard/settings` | `app/dashboard/settings/page.tsx` | Client | Profile, API tokens, theme. |

Server vs client: pages that need session-aware redirects use `getServerSession(authOptions)` server-side (`app/page.tsx`, `/dashboard/page.tsx`). Everything else marked `'use client'` fetches with TanStack Query.

---

## Components

### `components/ui/` — shadcn primitives

See [shadcn workflow](#shadcn-workflow).

### `components/` — feature components

| File | Purpose |
|---|---|
| `dashboard.tsx` | Projects grid; "new project" button. |
| `dashboard-layout.tsx` | Sidebar nav wrapper used by `/dashboard/*` pages. |
| `landing-page.tsx` | Marketing hero on `/`. |
| `project-view.tsx` | Container for a project: Kanban / Gantt / list tabs. |
| `kanban-board.tsx` | `@hello-pangea/dnd` Kanban; drag to update issue status. |
| `gantt-view.tsx` | Timeline view of issues by start/due date. |
| `timeline-view.tsx` | Vertical activity-style timeline. |
| `issue-list-view.tsx` | Tabular issue list with filters. |
| `create-issue-modal.tsx` | Modal form for new issues. |
| `project-settings-modal.tsx` | Project name/description/icon/banner. |
| `project-members-panel.tsx` | Add/remove members; role pickers. |
| `api-tokens-settings.tsx` | List / mint / revoke API tokens. |
| `cli-authorize-form.tsx` | The `/cli/authorize` page's form (state validation, token mint button). |
| `rich-text-editor.tsx` | TipTap wrapper with toolbar and image upload. |
| `image-lightbox.tsx` | Modal image viewer for attachments. |

Feature components are mostly client components. They use TanStack Query for data, `next-themes` for theme reads, NextAuth's `useSession` for the user, and `framer-motion` for transitions.

---

## State & data fetching

### TanStack Query

Configured once in `app/providers.tsx`:

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,        // 1 minute
      refetchOnWindowFocus: false,
    },
  },
})
```

Use `useQuery` for reads, `useMutation` + `queryClient.invalidateQueries(...)` for writes. Common query keys: `['projects']`, `['all-issues']`, `['issue', id]`, `['users']`, `['milestones']`.

### Zustand

Installed but currently unused. Reach for it when you need cross-component client state that doesn't belong to TanStack Query (e.g. multi-step form drafts, UI filter preferences). One store per concern, file under `lib/store/<name>.ts`.

### `next-themes`

Wrapped in `Providers`:

```tsx
<ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
```

`attribute="class"` flips the `dark` class on `<html>`, which our `@custom-variant dark` reads. `disableTransitionOnChange` prevents the whole page from animating during a theme swap.

Read or change the theme:

```tsx
import { useTheme } from 'next-themes'

const { theme, setTheme } = useTheme()
```

### Sonner toasts

Mounted in `app/layout.tsx` with inline styles bound to the `--toast-*` variables. From anywhere:

```tsx
import { toast } from 'sonner'

toast.success('Saved!')
toast.error('Something failed', { description: '...' })
```

---

## Auth on the client

### Sign-in (`/login`)

1. The form posts email/password through NextAuth's credentials provider:
   ```ts
   await signIn('credentials', { email, password, redirect: false })
   ```
2. On success, `router.push('/dashboard')`.
3. Google button (if enabled) calls `signIn('google', { callbackUrl: '/dashboard' })`.

### Sign-up

`POST /api/auth/register` then auto-sign-in via credentials.

### Reading the session

```tsx
'use client'
import { useSession } from 'next-auth/react'

const { data: session, status } = useSession()
```

`session.user` carries `id`, `email`, `name`, `image`, plus our augmented `role`. The `next-auth` module is declaration-merged in `types/next-auth.d.ts` to type these.

### Protected routes

`middleware.ts` redirects unauthenticated visitors to `/login` for any `/dashboard/*` path, so client components below that path can assume a session exists. For server components in the same area, `getServerSession(authOptions)` returns the typed session.

---

## Conventions for future development

### Where things live

| You need… | Put it here |
|---|---|
| A new page | `app/<path>/page.tsx` (`'use client'` if interactive) |
| A new API route | `app/api/<path>/route.ts` — see [backend doc](./backend.md) |
| A new shadcn primitive | `npx shadcn@latest add <name>` → `components/ui/<name>.tsx` |
| A feature-specific component | `components/<kebab-case>.tsx` |
| A shared hook | `lib/hooks/<use-thing>.ts` (create the dir if it doesn't exist) |
| A utility | `lib/<domain>/<name>.ts` |
| A type used in multiple places | `types/<name>.ts` |
| A theme token | `app/globals.css` — `:root` *and* `.dark` |
| A Zustand store | `lib/store/<name>.ts` |

### Import style

Always `@/`-rooted, never relative across directories:

```tsx
// Good
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Avoid
import { Button } from '../../components/ui/button'
```

Same-directory siblings can use relative imports (`./helpers`) if it stays readable.

### Naming

- Files: `kebab-case.tsx` for components, `camelCase.ts` for utilities.
- Components: `PascalCase` exports.
- Hooks: `useThing`.
- Types: `PascalCase`, no `I` prefix.

### When to add a shadcn primitive vs. custom Tailwind

- **shadcn**: reusable interactive widgets (button, input, dialog, tabs, dropdown, select).
- **Custom Tailwind**: layout, spacing, page-specific composition.
- **Hybrid**: shadcn primitive + extra Tailwind classes via `className`.

If a layout is going to repeat ≥3 times across pages, factor it into a component (in `components/`, not `components/ui/`).

### When to add a token vs. hard-code a class

- **Add a token** if the color/spacing/radius is part of the brand or needs to flip between light/dark.
- **Hard-code** Tailwind utilities for one-off page-specific styling.
- Never hard-code raw hex/rgb for surfaces, borders, or text colors — use a token name.

### Client vs server components

Mark a component `'use client'` if it:

- uses `useState`, `useEffect`, or any other hook;
- uses an event handler (`onClick`, etc.);
- uses `useQuery`, `useSession`, `useTheme`;
- imports a client-only lib (framer-motion, react-query, tiptap).

Otherwise prefer server components — they ship less JS and can use `getServerSession` directly.

### Forms and mutations

The current convention (visible in existing components):

```tsx
const { mutate, isPending } = useMutation({
  mutationFn: (body) => fetch('/api/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) throw new Error('Failed')
    return r.json()
  }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['all-issues'] })
    toast.success('Issue created')
  },
  onError: (err) => toast.error(err.message),
})
```

Use `useFormState`/`useFormStatus` for progressive-enhancement Server Actions only if you opt into that pattern for a specific feature.

---

## Recipes

### Add a shadcn Dialog

```bash
npx shadcn@latest add dialog
```

Then:

```tsx
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

<Dialog>
  <DialogTrigger asChild>
    <Button>Open</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader><DialogTitle>Hello</DialogTitle></DialogHeader>
    …
  </DialogContent>
</Dialog>
```

### Re-theme to a different brand color

1. Pick a hex (let's say `#7c3aed`, violet).
2. Edit `app/globals.css`:
   ```css
   :root  { --primary: #7c3aed; --ring: #7c3aed; --sidebar-primary: #7c3aed; --sidebar-ring: #7c3aed; }
   .dark  { --primary: #7c3aed; --ring: #7c3aed; --sidebar-primary: #7c3aed; --sidebar-ring: #7c3aed; }
   ```
3. Done. Every button, gradient, focus ring is now violet.

### Add a new color token

If you need (say) a "warning" color:

```css
:root  { --warning: oklch(0.83 0.16 84); --warning-foreground: oklch(0.2 0.04 84); }
.dark  { --warning: oklch(0.83 0.16 84); --warning-foreground: oklch(0.984 0.003 247.858); }

@theme inline {
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
}
```

Then use `bg-warning text-warning-foreground` anywhere.

### Add a protected client page

```bash
mkdir -p app/dashboard/teams
```

Create `app/dashboard/teams/page.tsx`:

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'

export default function TeamsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: () => fetch('/api/teams').then((r) => r.json()),
  })

  if (isLoading) return <p>Loading…</p>
  return <pre>{JSON.stringify(data, null, 2)}</pre>
}
```

Middleware already protects everything under `/dashboard/*`, so no extra auth wiring is needed.

### Run a manual dark/light check

```tsx
'use client'
import { useTheme } from 'next-themes'

const { setTheme } = useTheme()
<button onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>Toggle</button>
```

A proper theme toggle isn't in the app yet; one belongs in the dashboard sidebar / settings page.

### Migrate a legacy class to a shadcn primitive

Take `.status-badge` as the model:

1. `npx shadcn@latest add badge` (already installed — skip).
2. Pick a variant strategy. Either add a custom variant in `components/ui/badge.tsx`:
   ```ts
   variants: { variant: { ..., done: 'bg-green-500/20 text-green-400', ... } }
   ```
   Or use Tailwind classes inline: `<Badge className="bg-green-500/20 text-green-400">Done</Badge>`.
3. Replace every `<span className={`status-badge status-${status}`}>` with `<Badge variant={status}>`.
4. Delete the corresponding rules from `app/globals.css`.

The same pattern applies to `.kanban-card` (→ `<Card>`).
