// The browser half of `bk login --server https://sales.blackcode.ch` (D-21).
//
// `bk login` opens THIS page on whichever server it was pointed at, and the page
// posts to that server's `/api/cli/authorize`. Without it the route exists and
// nothing reaches it — the CLI would open a 404 and the terminal would sit there
// waiting for a callback that never comes, which is the invisible failure D-1
// exists to remove.
//
// ── IT IS OUTSIDE `/dashboard`, AND OUTSIDE D-7 ─────────────────────────────
// This page mints a credential, which is a write, and it is deliberately NOT
// behind `ui_mode`. `read_only` hides editing of the sales PIPELINE; a person
// who set it must still be able to sign a terminal in, or the preference would
// have quietly become a permission — the exact misreading D-7 is written to
// prevent. It renders no sales record and touches no `sales.*` table.
//
// ── THE CALLBACK IS VALIDATED BEFORE ANYTHING IS SHOWN ──────────────────────
// `parseCallbackURL` refuses anything that is not a localhost loopback, and this
// app imports it rather than re-deriving it. An app that got that check slightly
// wrong would post a live, platform-wide token to an external host — which is
// why it moved into `@blackcode/platform-auth` when D-21 made this route Tier 1.
//
// The `/cli-callback` SUBPATH, not the package root: this is parsed for a page
// that ships a client component, and the barrel pulls bcryptjs and Drizzle in
// behind it.
import { redirect } from 'next/navigation'
import { Terminal } from 'lucide-react'
import { parseCallbackURL } from '@blackcode/platform-auth/cli-callback'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { CliAuthorizeForm } from '@/components/cli-authorize-form'

export const dynamic = 'force-dynamic'

export default async function CliAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ callback?: string; state?: string; name?: string }>
}) {
  const sp = await searchParams
  const callback = sp.callback ?? ''
  const state = sp.state ?? ''
  const proposedName = sp.name ?? ''

  if (!callback || !state) {
    return (
      <Shell title="Missing parameters">
        This authorization request has no callback URL or no state token. Re-run{' '}
        <code className="rounded bg-muted px-1 py-0.5">bk login</code> from your terminal.
      </Shell>
    )
  }

  const parsed = parseCallbackURL(callback)
  if (!parsed) {
    return (
      <Shell title="Invalid callback">
        The callback is not a localhost loopback. Refusing to send a token to an external host —
        the credential this page mints works against every blackcode app, not only this one.
      </Shell>
    )
  }

  // `getValidatedSessionUser`, not a bare `getServerSession`: a session issued
  // before the account's last password reset must not be walkable through
  // `bk login` into a permanent credential (D-24). The ROUTE checks this too;
  // the page checks it so a stale session is sent to sign in rather than shown
  // an Authorize button that will 401.
  const user = await getValidatedSessionUser()
  if (!user) {
    const params = new URLSearchParams({ callback, state })
    if (proposedName) params.set('name', proposedName)
    redirect(`/login?callbackUrl=${encodeURIComponent(`/cli/authorize?${params.toString()}`)}`)
  }

  const defaultName =
    proposedName && proposedName.length <= 100
      ? proposedName
      : `cli-${new Date().toISOString().slice(0, 10)}`

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Terminal size={20} className="text-primary" />
          </span>
          <span>
            <h1 className="text-lg font-semibold">Authorize the bk CLI</h1>
            <p className="text-xs text-muted-foreground">Signed in as {user.email}</p>
          </span>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          A new API token will be created and sent to your terminal at:
        </p>
        <code className="mb-5 block break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">
          {parsed.url.toString()}
        </code>

        {/*
          Said in the product, not only in the docs. One login and one token
          across every blackcode app is D-16/§6 and it is the thing a reader is
          most likely to assume otherwise — "I authorized in b/sales, so I got a
          sales token" is a reasonable guess and a wrong one.
        */}
        <p className="mb-6 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          This token is not specific to b/sales. It is your blackcode token and it works against
          every app you have access to. Revoke it from Settings → API tokens, in any of them.
        </p>

        <CliAuthorizeForm callback={callback} state={state} defaultName={defaultName} />
      </div>
    </div>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <h1 className="mb-2 text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{children}</p>
        <a href="/dashboard" className="mt-6 inline-block text-sm text-primary hover:underline">
          ← Back to b/sales
        </a>
      </div>
    </div>
  )
}
