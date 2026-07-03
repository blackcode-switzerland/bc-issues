// Public "get up to date" guide, aimed at AI agents (and the humans wiring them
// up). Hand this URL to an agent whose skill/integration has drifted: it explains
// which interface to use, how to install/update the CLI, how to authenticate, the
// rules that trip integrations up, OS-specific gotchas, and — most importantly —
// to read the changelog and re-check it periodically.
//
// The connection facts (install command, auth header, discovery endpoints) are
// pulled from lib/agent-manifest.ts so this page can never drift from /llms.txt
// and the per-page manifest.

import type { Metadata } from 'next'
import { MarketingLayout } from '@/components/marketing/layout'
import { AGENT_MANIFEST as m } from '@/lib/agent-manifest'
import { CLI_LATEST_VERSION, CLI_MIN_VERSION } from '@/lib/cli-version'

export const metadata: Metadata = {
  title: 'Get up to date · Blackcode Issues',
  description:
    'How an AI agent (or an outdated agent skill) connects to Blackcode Issues and stays current: recommended interface, install/update, auth, rules, OS gotchas, and the changelog.',
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-xs font-semibold text-foreground">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <div className="mt-1.5 space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}

export default function AgentUpdatorPage() {
  return (
    <MarketingLayout>
      <article className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <header className="mb-12">
          <div className="text-xs font-medium uppercase tracking-wider text-primary">For agents</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Get up to date</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            You&apos;re here because an agent&apos;s way of using <strong>blackcode issues</strong> may be
            out of date. This page brings it current in a few minutes. The single most important
            action: <strong>read the <a href="/changelog" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">changelog</a></strong>{' '}
            — its pinned <em>Platform Reference</em> is a complete, current snapshot of the whole API and
            CLI surface, and the dated entries below it list everything that has changed.
          </p>
        </header>

        {/* TL;DR */}
        <section className="mb-14 rounded-lg border border-primary/30 bg-primary/5 p-5">
          <h2 className="text-sm font-semibold text-foreground">TL;DR — fastest path to current</h2>
          <ol className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground">
            <li>
              1. Update the CLI: <code>npm install -g {m.cli.package}@latest</code>
            </li>
            <li>
              2. Read <a href="/changelog" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">/changelog</a>{' '}
              (or <code>bk changelog --full</code>) and adjust your skill to match.
            </li>
            <li>
              3. Bootstrap with <code>bk meta</code> (or <code>GET /api/meta</code>) — it returns your
              workspaces and the live status/priority vocabulary.
            </li>
            <li>4. Re-check the changelog periodically; new entries are timestamped.</li>
          </ol>
        </section>

        {/* How to connect */}
        <section className="mb-14">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">1 · How to connect</h2>
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
            The same workspace data is reachable three ways. For an agent, use the CLI.
          </p>
          <div className="space-y-3">
            <Card title="bk CLI — recommended">
              <p>{m.recommended_interface}</p>
              <p>
                It wraps the same API but handles auth, JSON encoding, pagination, file upload+embed,
                and returns <strong>stable exit codes</strong>, so automated runs are more reliable.
              </p>
            </Card>
            <Card title="HTTP API — supported">
              <p>
                Base <code>{m.programmatic_access.api_base}</code>; tenant data is workspace-scoped
                under <code>{m.programmatic_access.workspace_scoped_routes}</code>. Reach for it when the
                CLI can&apos;t cover a case. Full spec at{' '}
                <a href="/api/openapi.json" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">/api/openapi.json</a>{' '}
                (browsable at <a href="/api/docs" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">/api/docs</a>).
              </p>
            </Card>
            <Card title="Web UI — for humans">
              <p>The dashboard at <code>/dashboard</code>. Not for automation.</p>
            </Card>
          </div>
        </section>

        {/* Steps */}
        <section className="mb-14">
          <h2 className="mb-6 text-lg font-semibold tracking-tight">2 · Install, authenticate, bootstrap</h2>
          <div className="space-y-7">
            <Step n={1} title="Install or update the CLI">
              <p>A small npm launcher downloads the right prebuilt binary for your platform.</p>
              <Code>{`${m.cli.install}\n# update later:\nnpm install -g ${m.cli.package}@latest`}</Code>
            </Step>
            <Step n={2} title="Authenticate">
              <p>
                <code>bk login</code> opens a browser to capture a token. For the HTTP API, send{' '}
                <code>{m.programmatic_access.auth}</code>. Mint a token at{' '}
                <a href="/dashboard/settings/tokens" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">Settings → API Tokens</a>.
                Set <code>BK_NO_PROMPT=1</code> for unattended runs.
              </p>
              <Code>{`bk login\n# headless: paste a token from stdin\nbk login --token`}</Code>
            </Step>
            <Step n={3} title="Bootstrap and pick a workspace">
              <p>
                <code>bk meta</code> (mirror of <code>GET /api/meta</code>) tells you who you are, every
                workspace you belong to, and the valid status/priority values. Pick your target by{' '}
                <strong>name/slug</strong>, never the numeric id.
              </p>
              <Code>{`bk meta\nbk workspace use <slug>     # or per-command: bk --ws <slug> …`}</Code>
            </Step>
          </div>
        </section>

        {/* Rules */}
        <section className="mb-14">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">3 · Rules that trip integrations up</h2>
          <ul className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <li>
              <strong className="text-foreground">Pick the workspace by name/slug, not id.</strong>{' '}
              Writing to the wrong workspace is the #1 mistake. <code>active_workspace</code> is only a
              default.
            </li>
            <li>
              <strong className="text-foreground">Address items by <code>#number</code>.</strong> A
              project/task/issue id is its per-workspace <code>#N</code>; there is no separate global id.
            </li>
            <li>
              <strong className="text-foreground">Envelopes.</strong> Lists return{' '}
              <code>{m.programmatic_access.list_envelope}</code>; errors return{' '}
              <code>{m.programmatic_access.error_envelope}</code>. Creates → 201; deletes →{' '}
              <code>{`{ deleted: true }`}</code>.
            </li>
            <li>
              <strong className="text-foreground">Build JSON with a real encoder.</strong> Embedded urls
              and Markdown like <code>![](url)</code> contain <code>()</code> and specials that break
              hand-built JSON/shell strings. Send real newlines, not literal <code>\n</code>.
            </li>
            <li>
              <strong className="text-foreground">Uploaded media only.</strong> Embed files by uploading
              to <code>/api/upload</code> then referencing the url; external media and raw{' '}
              <code>&lt;iframe&gt;</code> are stripped.
            </li>
          </ul>
        </section>

        {/* OS notes */}
        <section className="mb-14">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">4 · Watch out for your OS</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card title="Windows">
              <p>
                All API text is UTF-8. A non-UTF-8 console (<code>cmd</code>/PowerShell without{' '}
                <code>chcp 65001</code>) silently corrupts accents/dashes into mojibake
                (<code>é→Ã©</code>) that gets stored. Run <code>chcp 65001</code>, or prefer a JSON
                body over piping text through the terminal. The CLI ships as{' '}
                <code>bk.exe</code> (x64 &amp; arm64).
              </p>
            </Card>
            <Card title="macOS">
              <p>
                Install per-arch binaries (Intel &amp; Apple Silicon) automatically via npm. If Gatekeeper
                flags a manually-downloaded binary, prefer the npm install. Terminal is UTF-8 by default.
              </p>
            </Card>
            <Card title="Linux">
              <p>
                amd64 &amp; arm64 supported. Ensure your locale is UTF-8 (<code>LANG=…UTF-8</code>). Node
                ≥ 18 is required for the npm launcher.
              </p>
            </Card>
          </div>
        </section>

        {/* Why the old skill breaks */}
        <section className="mb-14">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">5 · Why an old skill suddenly breaks</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Every API response carries <code>X-BK-CLI-Latest</code> (newest published CLI) and{' '}
            <code>X-BK-CLI-Min</code> (oldest still supported). When a server change is incompatible with
            older clients, the minimum is raised — so a stale <code>bk</code> stops with a clear{' '}
            <em>&quot;no longer supported, please upgrade&quot;</em> (exit code <code>8</code>) instead of
            cryptic 404s. If that happens, update the CLI and read the changelog.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Current: CLI latest v{CLI_LATEST_VERSION} · minimum supported v{CLI_MIN_VERSION}.
          </p>
        </section>

        {/* Reference links */}
        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">6 · Bookmark these</h2>
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
            {[
              ['/changelog', 'Platform reference + dated changelog (read this to get current)'],
              ['/api/changelog', 'The same, as JSON or ?format=markdown'],
              ['/api/meta', 'Live bootstrap context + the authoritative enum vocabulary'],
              ['/api/openapi.json', 'Full OpenAPI 3.1 spec'],
              ['/api/docs', 'Human-browsable API reference'],
              ['/llms.txt', 'Machine-readable "how to use this site"'],
              [m.for_developers, 'Contributor & agent guide'],
            ].map(([href, label]) => (
              <li key={href} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <a
                  href={href}
                  className="font-mono text-sm text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  {href}
                </a>
                <span className="text-xs text-muted-foreground">{label}</span>
              </li>
            ))}
          </ul>
        </section>
      </article>
    </MarketingLayout>
  )
}
