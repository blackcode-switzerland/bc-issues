import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  Download,
  Files,
  Hash,
  Inbox,
  KeyRound,
  Layers,
  Moon,
  Sparkles,
  Tag,
  Terminal,
  Trash2,
  Undo2,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'

import { MarketingLayout } from '@/components/marketing/layout'
import { BrowserFrame } from '@/components/marketing/browser-frame'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { cn } from '@/lib/utils'

type FeatureStatus = 'live' | 'preview' | 'soon'

interface Feature {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  status: FeatureStatus
}

// Every card here describes something that ships today (or is tagged "in
// preview"). Speculative / not-yet-built work is intentionally left off.
const FEATURES: Feature[] = [
  {
    icon: Hash,
    title: 'Integer IDs',
    description:
      '"Issue 42" is easier to dictate, easier to grep, and easier for a model to keep in working memory than a 36-character UUID. Each workspace numbers its issues from #1.',
    status: 'live',
  },
  {
    icon: Layers,
    title: 'Kanban board',
    description:
      'Drag-and-drop columns per status — backlog, todo, in progress, done, cancelled. Moves persist instantly with optimistic updates.',
    status: 'live',
  },
  {
    icon: Workflow,
    title: 'Timeline & list views',
    description:
      'A Gantt-style timeline places issues and projects on a date axis from their start and due dates. Switch to a dense list when you just want rows.',
    status: 'live',
  },
  {
    icon: Files,
    title: 'Rich-text issues & comments',
    description:
      'A TipTap editor with a slash menu, bubble toolbar, headings, lists, checklists, code blocks, links, @mentions and inline media. Sanitized before save.',
    status: 'live',
  },
  {
    icon: Boxes,
    title: 'File attachments',
    description:
      'Paste, drag, or attach any file type (SVG excluded for safety) up to 50 MB. Stored on Vercel Blob in production, on the local disk in development.',
    status: 'live',
  },
  {
    icon: Tag,
    title: 'Labels & milestones',
    description:
      'Workspace-wide labels with colors, and milestones that stand alone or belong to a project — each with its own issues, comments and progress.',
    status: 'live',
  },
  {
    icon: Users,
    title: 'Teams & roles',
    description:
      'Invite by email. Workspaces have owners and members, with owner-only gates on destructive actions; projects add their own roles (owner, admin, member, viewer).',
    status: 'live',
  },
  {
    icon: Inbox,
    title: 'Activity feed & inbox',
    description:
      'Every mutation is recorded on an append-only event spine that powers a workspace activity feed and a per-user inbox of mentions, assignments and changes.',
    status: 'live',
  },
  {
    icon: Sparkles,
    title: 'Workspace analytics',
    description:
      'Snapshot counts, completion rate, cycle time, velocity and aging — sliced by status, priority, assignee, label and project, plus per-milestone burndown.',
    status: 'live',
  },
  {
    icon: KeyRound,
    title: 'API tokens for scripts',
    description:
      'Mint a bk_live_… token in settings. Stored as a SHA-256 hash with a short visible prefix so you know which one is which; optional expiry and one-click revoke.',
    status: 'live',
  },
  {
    icon: BookOpen,
    title: 'Self-describing API',
    description:
      'Every route is published as an OpenAPI 3.1 document at /api/openapi.json (browsable at /api/docs). GET /api/meta returns your context and the valid vocabulary in one call.',
    status: 'live',
  },
  {
    icon: Trash2,
    title: 'Trash & restore',
    description:
      'Deleting an issue, project or milestone moves it to a recoverable Trash. Restore brings items back as a group; owners can purge or empty the bin.',
    status: 'live',
  },
  {
    icon: Moon,
    title: 'Dark mode by default',
    description:
      'Token-driven theming with next-themes. Dark out of the box; flip the entire app’s accent by changing one CSS variable.',
    status: 'live',
  },
  {
    icon: Undo2,
    title: 'Reversible edits',
    description:
      'Issue updates are journaled with full before/after snapshots. `bk undo` (or POST /api/undo) reverses your last few changes. Coverage today is issue updates — broader undo is planned.',
    status: 'preview',
  },
]

function StatusPill({ status, className }: { status: FeatureStatus; className?: string }) {
  const map: Record<FeatureStatus, { label: string; className: string }> = {
    live: {
      label: 'Live',
      className:
        'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400',
    },
    preview: {
      label: 'In preview',
      className:
        'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300',
    },
    soon: {
      label: 'Coming soon',
      className:
        'bg-primary/10 text-primary ring-primary/20',
    },
  }
  const { label, className: c } = map[status]
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-full border-0 px-2.5 py-0.5 text-[11px] font-medium ring-1',
        c,
        className,
      )}
    >
      {label}
    </Badge>
  )
}

export function LandingPage() {
  return (
    <MarketingLayout>
      <Hero />
      <ThreeSurfaces />
      <Features />
      <CommandLine />
      <HowItWorks />
      <ForAgents />
      <FAQ />
      <FinalCTA />
    </MarketingLayout>
  )
}

/* ---------- Sections ---------- */

function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Two decorative layers: the brand-tinted radial glow, then a faded grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'var(--hero-glow)' }}
      />
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 -z-10"
      />

      <div className="mx-auto max-w-7xl px-6 pt-20 pb-16 text-center sm:pt-28">
        <div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 pl-1 text-xs text-muted-foreground shadow-sm">
          <span className="rounded-full bg-primary px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-primary-foreground">
            New
          </span>
          Working alpha — three surfaces, one data model
        </div>
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
          Issue tracking for humans
          <br className="hidden sm:block" /> and the{' '}
          <span className="text-gradient-brand">AI working</span> alongside them.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
          Integer IDs. A stable, self-describing HTTP API. A CLI written in Go.
          A web UI built like Linear. One data model behind all three.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/login?tab=signup">
              Get started — it&rsquo;s free
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="#cli">
              <Terminal />
              Try the CLI
            </Link>
          </Button>
        </div>

        <div className="relative mx-auto mt-16 max-w-6xl">
          <BrowserFrame
            srcDark="/hero-dark.png"
            srcLight="/hero-light.png"
            alt="Screenshot of the Blackcode Issues dashboard"
            url="app.blackcode.issues/dashboard"
            width={2880}
            height={1800}
          />
        </div>
      </div>
    </section>
  )
}

function ThreeSurfaces() {
  const surfaces = [
    {
      icon: Boxes,
      title: 'Web UI',
      copy:
        'Kanban, timeline, list, and issue detail with rich text. The clicky surface, polished with Tailwind v4 and shadcn/ui.',
      meta: '→ /dashboard',
    },
    {
      icon: Terminal,
      title: (
        <>
          CLI <span className="text-muted-foreground">(bk)</span>
        </>
      ),
      copy:
        'A single Go binary on npm. Table, JSON, or YAML output. Stable exit codes. bk login opens a browser; you’re authed in seconds.',
      meta: '→ bk issue list --json',
    },
    {
      icon: Zap,
      title: 'HTTP API',
      copy:
        'JSON in, JSON out. Bearer tokens or session cookies. Predictable error shapes, cursor pagination, and a published OpenAPI spec.',
      meta: '→ POST /api/workspaces/{ws}/issues',
    },
  ]
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="Three surfaces"
          title="Web, CLI, or HTTP. Same auth. Same data."
          sub="Most issue trackers privilege the web. We treat all three as equal citizens — anything you do in one, you can do in the others, and an automated parity test keeps them honest."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {surfaces.map((s, i) => (
            <Card key={i} className="group transition-colors hover:border-primary/50">
              <CardContent className="flex flex-col gap-3 p-6">
                <div className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="size-5" />
                </div>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.copy}</p>
                <div className="mt-1 font-mono text-xs text-muted-foreground/80">
                  {s.meta}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function Features() {
  return (
    <section className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="Feature catalog"
          title="The boring stuff, done well."
          sub="Status is labeled on every card so you know what’s shipped today and what’s still warming up."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card
              key={f.title}
              className="group h-full transition-colors hover:border-primary/40"
            >
              <CardContent className="flex h-full flex-col gap-3 p-6">
                <div className="flex items-center justify-between">
                  <div className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <f.icon className="size-5" />
                  </div>
                  <StatusPill status={f.status} />
                </div>
                <h3 className="text-base font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function CommandLine() {
  const points = [
    {
      title: 'One binary, every platform',
      copy:
        'The npm package ships a tiny installer that downloads the right prebuilt Go binary for your OS and architecture (macOS, Linux, Windows · amd64/arm64).',
    },
    {
      title: 'Browser login, token storage',
      copy:
        'bk login runs a loopback OAuth handshake — approve in the browser and a bk_live_… token is saved to ~/.config/bk/config.json (mode 0600).',
    },
    {
      title: 'Built for scripts and agents',
      copy:
        '--json / -o yaml for machine-readable output, cursor pagination, and stable exit codes (0 ok … 7 aborted). Set BK_NO_PROMPT=1 to skip confirmations.',
    },
    {
      title: 'Everything the UI can do',
      copy:
        'issues, projects, milestones, comments, labels, members, invites, inbox, trash, analytics, and undo — all from the terminal.',
    },
  ]
  return (
    <section id="cli" className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="Command line"
          title="Install the CLI in one line."
          sub="bk is a single Go binary distributed on npm. Same features as the web app — scriptable, pipeable, and ready for agents."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-2 lg:items-start">
          <CodeBlock
            label="Quickstart"
            lang="bash"
            code={`# 1. install (npm fetches the prebuilt binary for your platform)
$ npm install -g @blackcode_sa/bc-issues

# 2. authenticate — opens your browser, done in seconds
$ bk login --server https://your-deployment.app

# 3. pick a workspace
$ bk workspace use my-team

# 4. work
$ bk issue list --status todo
$ bk issue create --project 1 --title "Fix signup bug" --priority 1
$ bk issue list --json | jq '.data[].title'`}
          />
          <div className="flex flex-col gap-4">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-xs text-muted-foreground">
              <Download className="size-3.5" />
              npm i -g @blackcode_sa/bc-issues
            </div>
            <ul className="space-y-4">
              {points.map((p) => (
                <li key={p.title} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary/70" />
                  <div>
                    <h4 className="text-sm font-semibold">{p.title}</h4>
                    <p className="mt-0.5 text-sm text-muted-foreground">{p.copy}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground/80">
              Tip: run <span className="font-mono">bk --help</span> for the full
              command tree, or <span className="font-mono">bk whoami</span> to
              confirm you’re signed in.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  const bullets = [
    {
      title: 'Same auth everywhere',
      copy:
        'Bearer token or session cookie — pick one per request. The backend resolves the user the same way regardless of which surface you came from.',
    },
    {
      title: 'One data model',
      copy:
        'Postgres with Drizzle ORM. Integer primary keys, indexed where they matter, single round-trip per route. Every tenant lives under a workspace.',
    },
    {
      title: 'Reversible by design',
      copy:
        'Issue updates are journaled with full old and new snapshots, and deletes soft-delete to a recoverable Trash. Undo is a real API endpoint, not a UI trick.',
    },
    {
      title: 'Predictable failures',
      copy:
        'Every error is { error, code, suggestion?, details? }. The CLI maps HTTP statuses to stable exit codes for scripts.',
    },
  ]
  return (
    <section id="how" className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="How it works"
          title="One backend. Three doors in."
          sub="Not a black box. Every interface reads and writes the same Postgres tables, through the same auth, with the same validation."
        />
        <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:items-center">
          <ol className="space-y-6">
            {bullets.map((b, i) => (
              <li key={b.title} className="flex gap-4">
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {i + 1}
                </span>
                <div>
                  <h4 className="font-semibold">{b.title}</h4>
                  <p className="mt-1 text-sm text-muted-foreground">{b.copy}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              {[
                { label: 'Web', tag: 'cookie' },
                { label: 'CLI / bk', tag: 'bearer' },
                { label: 'Agent / API', tag: 'bearer' },
              ].map((n) => (
                <div
                  key={n.label}
                  className="rounded-lg border border-border bg-background px-3 py-3"
                >
                  <div className="text-sm font-medium">{n.label}</div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {n.tag}
                  </div>
                </div>
              ))}
            </div>
            <div className="my-3 flex justify-center text-muted-foreground/70">
              ↓ ↓ ↓
            </div>
            <div
              className="rounded-lg px-4 py-3 text-center text-sm text-white shadow-md shadow-primary/30"
              style={{ background: 'var(--brand-gradient)' }}
            >
              <span className="font-medium">Next.js — /api/*</span>
              <div className="mt-0.5 font-mono text-[11px] text-white/75">
                route handlers · resolveAuth() · validation
              </div>
            </div>
            <div className="my-3 flex justify-center text-muted-foreground/70">↓</div>
            <div className="rounded-lg border border-border bg-muted/60 px-4 py-3 text-center text-sm">
              <span className="font-medium">Postgres + Drizzle</span>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                integer PKs · event spine · cursor pagination
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function ForAgents() {
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="For agents"
          title="Built so an agent can do the work."
          sub="Mint a token, then read, write and comment using the same data you see in the web UI. Start with GET /api/meta to learn the workspace and the valid vocabulary."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <CodeBlock
            label="Create an issue with the CLI"
            lang="bash"
            code={`# bk reads your token from ~/.config/bk/config.json
$ bk issue create \\
    --project 1 \\
    --title "Triage onboarding bug" \\
    --priority 1 \\
    --json

{
  "id": 152,
  "seq": 87,
  "title": "Triage onboarding bug",
  "status": "backlog",
  "priority": 1,
  "project_id": 1
}`}
          />
          <CodeBlock
            label="Or hit the HTTP endpoint directly"
            lang="http"
            code={`POST /api/workspaces/my-team/issues HTTP/1.1
Host: your-deployment.app
Authorization: Bearer bk_live_a3f9…
Content-Type: application/json

{
  "project_id": 1,
  "title": "Triage onboarding bug",
  "priority": 1
}

// 201 Created → { "id": 152, "seq": 87, ... }`}
          />
        </div>

        <div className="mt-6 flex flex-col items-start justify-between gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center">
          <div>
            <div className="text-sm font-semibold">A self-describing API</div>
            <p className="mt-1 text-sm text-muted-foreground">
              The full surface is published as OpenAPI 3.1 at{' '}
              <span className="font-mono">/api/openapi.json</span>, browsable at{' '}
              <span className="font-mono">/api/docs</span>. One call to{' '}
              <span className="font-mono">/api/meta</span> returns the active
              workspace plus the exact status and priority values to use — so an
              agent never has to guess.
            </p>
          </div>
          <StatusPill status="live" />
        </div>
      </div>
    </section>
  )
}

function FAQ() {
  const items: { q: string; a: string }[] = [
    {
      q: 'How do agents discover and call the API?',
      a: 'Every route is published as an OpenAPI 3.1 document at /api/openapi.json (rendered at /api/docs), and a parity test keeps it in lock-step with the code. GET /api/meta returns your context — the active workspace and the valid status/priority vocabulary — so an agent never guesses an enum value. Or just drive the bk CLI.',
    },
    {
      q: 'How do I install and use the CLI?',
      a: 'npm install -g @blackcode_sa/bc-issues, then bk login (it opens a browser and stores a token in ~/.config/bk/config.json), bk workspace use <slug>, and you’re working: bk issue list, bk issue create --project 1 --title "…". Run bk --help for the full command tree.',
    },
    {
      q: 'How do agents and scripts authenticate?',
      a: 'Mint an API token at /dashboard/settings/tokens (or via bk login), then send it as Authorization: Bearer bk_live_…. The same token works across the CLI and raw HTTP. Tokens carry optional expiry and can be revoked from the same page.',
    },
    {
      q: 'Is the CLI scriptable for automation and CI?',
      a: 'Yes. Add --json or -o yaml for machine-readable output, pipe it through jq, and branch on stable exit codes (0 ok, 3 unauthenticated, 4 forbidden, 5 not found, 6 validation, 7 aborted). Set BK_NO_PROMPT=1 to skip confirmations in unattended runs.',
    },
    {
      q: 'How does pagination work?',
      a: 'Every list endpoint returns { data, next_cursor }. When next_cursor is non-null, pass it back as ?cursor= to fetch the next page; null means you’ve reached the end. The CLI exposes this as --limit / --cursor.',
    },
    {
      q: 'What happens when I delete something?',
      a: 'Issues, projects and milestones soft-delete into a recoverable Trash rather than vanishing. Items deleted together restore as a group; workspace owners can purge selected items or empty the bin. Issue edits are separately reversible with bk undo (POST /api/undo), up to 10 at a time.',
    },
    {
      q: 'Can a team and its agents share a workspace?',
      a: 'Yes. Everything is workspace-scoped with members and roles; every change lands on a shared activity feed and a per-user inbox of mentions and assignments — so humans and agents working the same board stay in sync.',
    },
    {
      q: 'What stack does the project use?',
      a: 'Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui, NextAuth, TanStack Query and Framer Motion on the front; Postgres + Drizzle ORM on the server; Go for the CLI.',
    },
  ]
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="FAQ"
          title="Frequently asked."
          sub=""
          align="left"
        />
        <Accordion type="single" collapsible className="mt-10 w-full">
          {items.map((it, i) => (
            <AccordionItem key={i} value={`item-${i}`}>
              <AccordionTrigger className="text-left">{it.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {it.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}

function FinalCTA() {
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <div
          className="relative isolate overflow-hidden rounded-3xl p-10 text-center sm:p-14"
          style={{ background: 'var(--brand-gradient)' }}
        >
          {/* White grid overlay, faded toward the edges */}
          <div
            aria-hidden
            className="bg-grid-on-brand pointer-events-none absolute inset-0"
          />
          <div className="relative">
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Ready to give your agents an inbox?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-white/85">
              Create an account, mint a token, and start moving work through the same
              system you do.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="bg-white text-slate-900 shadow-lg hover:bg-white/95"
              >
                <Link href="/login?tab=signup">
                  Get started — it&rsquo;s free
                  <ArrowRight />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------- Small helpers ---------- */

function SectionHead({
  eyebrow,
  title,
  sub,
  align = 'center',
}: {
  eyebrow: string
  title: string
  sub?: string
  align?: 'center' | 'left'
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
      )}
    >
      <span className="text-xs font-medium uppercase tracking-wider text-primary">
        {eyebrow}
      </span>
      <h2 className="max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {sub ? (
        <p className="max-w-2xl text-balance text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  )
}

function CodeBlock({
  label,
  lang,
  code,
}: {
  label: string
  lang: string
  code: string
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5 text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-mono text-muted-foreground/70">{lang}</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed text-foreground">
        {code}
      </pre>
    </div>
  )
}
