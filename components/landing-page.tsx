import Link from 'next/link'
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Code2,
  Files,
  Hash,
  Keyboard,
  Layers,
  Lock,
  Moon,
  Palette,
  PlayCircle,
  Rocket,
  Sparkles,
  Terminal,
  Undo2,
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

const FEATURES: Feature[] = [
  {
    icon: Hash,
    title: 'Integer IDs',
    description:
      '"Issue 42" is easier to dictate, easier to grep, and easier for a model to keep in working memory than a 36-character UUID.',
    status: 'live',
  },
  {
    icon: Layers,
    title: 'Kanban board',
    description:
      'Drag-and-drop columns per status — backlog, todo, in progress, blocked, in review, done. Moves persist instantly.',
    status: 'live',
  },
  {
    icon: Workflow,
    title: 'Timeline view',
    description:
      'Gantt-style chart placing issues on a date axis using start and due dates. Plan a milestone at a glance.',
    status: 'live',
  },
  {
    icon: Files,
    title: 'Rich-text issues',
    description:
      'TipTap editor with bold, italic, lists, blockquotes, code blocks, links, and inline images. Sanitized before save.',
    status: 'live',
  },
  {
    icon: Boxes,
    title: 'File attachments',
    description:
      'Drag and drop. Stored on Vercel Blob in production, local files in development. 10 MB cap, common formats.',
    status: 'live',
  },
  {
    icon: Lock,
    title: 'Role-based access',
    description:
      'Owner, admin, member, viewer. Roles are enforced end to end — destructive operations are gated, not just hidden.',
    status: 'live',
  },
  {
    icon: Keyboard,
    title: 'API tokens for scripts',
    description:
      'Mint a bk_live_… token. Stored as a SHA-256 hash with an 8-char visible prefix so you know which one is which.',
    status: 'live',
  },
  {
    icon: Moon,
    title: 'Dark mode by default',
    description:
      'Token-driven theming via OKLCH. Flip the entire app’s accent by changing one CSS variable.',
    status: 'live',
  },
  {
    icon: Undo2,
    title: 'Reversible by design',
    description:
      'Issue updates are journaled. `bk undo` reverses your last N operations. Coverage today is issue updates only — broader undo on the roadmap.',
    status: 'preview',
  },
  {
    icon: Sparkles,
    title: 'Workspace analytics',
    description:
      'Issues by status, top projects, top assignees, 30-day creation trend. Data is real and live; visuals still warming up.',
    status: 'preview',
  },
  {
    icon: PlayCircle,
    title: 'Native agent tools (MCP)',
    description:
      'A first-class MCP server so agents can create_issue, add_comment, etc. as native tools with rich JSON schemas.',
    status: 'soon',
  },
  {
    icon: Zap,
    title: 'Ask in plain English',
    description:
      '"Show blocked issues from Q4 assigned to Andrea." A thin parser that returns the same shape /api/issues does.',
    status: 'soon',
  },
  {
    icon: Rocket,
    title: 'Batch operations',
    description:
      'Move 50 issues at once. Create 100 comments. Atomic and undoable. The data model supports it; the routes don’t yet.',
    status: 'soon',
  },
  {
    icon: Palette,
    title: 'Sub-15 ms responses',
    description:
      'Integer keys, indexed Postgres, single round-trip routes. We’ll publish benchmarks before re-asserting the number.',
    status: 'soon',
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
      <HowItWorks />
      <ForAgents />
      <Roadmap />
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
          Integer IDs. A stable HTTP API. A CLI built like Go. A web UI built like Linear.
          One data model behind all three.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/login?tab=signup">
              Get started — it&rsquo;s free
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="#how">
              <Code2 />
              See how it works
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
        'Kanban, timeline, list, issue detail with rich text. The clicky surface, polished with Tailwind v4 and shadcn/ui.',
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
        'A Go binary. Table, JSON, or YAML output. Stable exit codes. bk login opens a browser; you’re authed in seconds.',
      meta: '→ bk issue list --json',
    },
    {
      icon: Zap,
      title: 'HTTP API',
      copy:
        'JSON in, JSON out. Bearer tokens or session cookies. Predictable error shapes. Cursor pagination across the board.',
      meta: '→ POST /api/issues',
    },
  ]
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="Three surfaces"
          title="Web, CLI, or HTTP. Same auth. Same data."
          sub="Most issue trackers privilege the web. We treat all three as equal citizens — anything you do in one, you can do in the others."
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
          sub="Status is labeled on every card so you know what’s shipped today and what’s still on the way."
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

function HowItWorks() {
  const bullets = [
    {
      title: 'Same auth everywhere',
      copy:
        'Bearer token or session cookie — pick one per request. resolveUser() on the backend doesn’t care which surface you came from.',
    },
    {
      title: 'One data model',
      copy:
        'Postgres 16 with Drizzle ORM. Integer primary keys, indexed where they matter, single round-trip per route.',
    },
    {
      title: 'Reversible by design',
      copy:
        'Issue updates are journaled with full old and new snapshots. Undo is a real API endpoint, not a UI trick.',
    },
    {
      title: 'Predictable failures',
      copy:
        'Every error is { error, suggestion?, details? }. The CLI maps HTTP statuses to stable exit codes for scripts.',
    },
  ]
  return (
    <section id="how" className="border-t border-border/60">
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
                { label: 'Agent / MCP', tag: 'bearer' },
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
                route handlers · resolveUser() · validation
              </div>
            </div>
            <div className="my-3 flex justify-center text-muted-foreground/70">↓</div>
            <div className="rounded-lg border border-border bg-muted/60 px-4 py-3 text-center text-sm">
              <span className="font-medium">Postgres 16 + Drizzle</span>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                integer PKs · transaction log · cursor pagination
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
    <section className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="For agents"
          title="Built so an agent can do the work."
          sub="Mint a token. Drop it in the config. Read, write, comment — using the same data you see in the web UI."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <CodeBlock
            label="Create an issue with the CLI"
            lang="bash"
            code={`# bk picks up your token from ~/.config/bk/config.json
$ bk issue create \\
    --project 1 \\
    --title "Add cursor pagination to /api/issues" \\
    --priority 2 \\
    --json

{
  "id": 152,
  "title": "Add cursor pagination to /api/issues",
  "status": "backlog",
  "priority": 2,
  "project_id": 1
}`}
          />
          <CodeBlock
            label="Or hit the HTTP endpoint directly"
            lang="http"
            code={`POST /api/issues HTTP/1.1
Host: app.issues.dev
Authorization: Bearer bk_live_a3f9…
Content-Type: application/json

{
  "project_id": 1,
  "title": "Add cursor pagination to /api/issues",
  "priority": 2
}

// 201 Created → { id: 152, ... }`}
          />
        </div>

        <div className="mt-6 flex flex-col items-start justify-between gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center">
          <div>
            <div className="text-sm font-semibold">
              What MCP integration will look like
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              A first-class mcp/ server exposes these endpoints as native tools —
              create_issue, update_issue, add_comment — with full JSON schemas.
            </p>
          </div>
          <StatusPill status="soon" />
        </div>
      </div>
    </section>
  )
}

function Roadmap() {
  const groups = [
    {
      title: 'Reliability',
      items: [
        'Broader undo (creates, deletes, non-issue resources)',
        'Batch operations + batched undo',
        'CI with contract tests',
        'Performance benchmarks',
      ],
    },
    {
      title: 'Agent ergonomics',
      items: [
        'MCP server with native tool definitions',
        'Natural-language query endpoint',
        'Per-scope API tokens (read-only, per-project)',
      ],
    },
    {
      title: 'Product polish',
      items: [
        'Labels (UI to a backend that’s already there)',
        'Saved filters and views',
        'Notifications and search',
        'Mobile-friendly layouts',
      ],
    },
  ]
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="Roadmap"
          title="What we’re shipping next."
          sub="Groupings, not dates. We label honestly on the page when each piece lands."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {groups.map((g) => (
            <Card key={g.title}>
              <CardContent className="p-6">
                <h3 className="mb-4 text-base font-semibold">{g.title}</h3>
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  {g.items.map((it) => (
                    <li key={it} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary/70" />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function FAQ() {
  const items: { q: string; a: string }[] = [
    {
      q: 'What is the Trinity Architecture?',
      a: 'A three-part design: a prompt (the agent’s instructions), the tools (an MCP server exposing this API), and the software (this app, which is the memory). The MCP layer is on the roadmap; the software half ships today.',
    },
    {
      q: 'Can I self-host?',
      a: 'Yes. The app runs against a Postgres database — Docker Compose provides one locally; managed Postgres (Vercel, Neon, Supabase, RDS) works in production.',
    },
    {
      q: 'How do I sign up?',
      a: 'By email and password on the sign-in page, or with Google if your deployment has OAuth configured.',
    },
    {
      q: 'Is there a free tier?',
      a: 'For self-hosting, the whole thing is free. There’s no hosted SaaS today.',
    },
    {
      q: 'How do agents authenticate?',
      a: 'Mint an API token at /dashboard/settings. Pass it in Authorization: Bearer bk_live_…. Tokens carry optional expiry and can be revoked from the same page.',
    },
    {
      q: 'How does undo work?',
      a: 'Issue updates are journaled with previous and new field values. POST /api/undo (or bk undo) reverses your most recent changes, up to 10 at a time. Broader coverage is on the roadmap.',
    },
    {
      q: 'What stack does the project use?',
      a: 'Next.js + TypeScript + Tailwind v4 + shadcn/ui + Postgres + drizzle on the server. Go for the CLI.',
    },
  ]
  return (
    <section className="border-t border-border/60 bg-muted/30">
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
