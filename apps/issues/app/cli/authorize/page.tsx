import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { Terminal } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { parseCallbackURL } from '@/lib/auth/cli-callback'
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
      <ErrorShell
        title="Missing parameters"
        body="The CLI authorization request is missing a callback URL or state token. Re-run `bk login` from your terminal."
      />
    )
  }

  const parsedCallback = parseCallbackURL(callback)
  if (!parsedCallback) {
    return (
      <ErrorShell
        title="Invalid callback"
        body="The callback URL is not a localhost loopback (http://localhost or http://127.0.0.1). Refusing to send a token to an external host."
      />
    )
  }

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    const params = new URLSearchParams({ callback, state })
    if (proposedName) params.set('name', proposedName)
    const callbackUrl = `/cli/authorize?${params.toString()}`
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }

  const defaultName =
    proposedName && proposedName.length <= 100
      ? proposedName
      : `cli-${new Date().toISOString().slice(0, 10)}`

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Terminal size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Authorize bk CLI</h1>
            <p className="text-xs text-muted-foreground">
              Signed in as {session.user.email}
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          A new API token will be created and sent to your local CLI at:
        </p>
        <code className="block text-xs font-mono px-3 py-2 mb-6 bg-secondary rounded-lg break-all">
          {parsedCallback.url.toString()}
        </code>

        <CliAuthorizeForm callback={callback} state={state} defaultName={defaultName} />
      </div>
    </div>
  )
}

function ErrorShell({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="max-w-md bg-card border border-border rounded-2xl p-8 shadow-2xl">
        <h1 className="text-lg font-semibold mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        <a
          href="/dashboard"
          className="inline-block mt-6 text-sm text-primary hover:underline"
        >
          ← Back to dashboard
        </a>
      </div>
    </div>
  )
}
