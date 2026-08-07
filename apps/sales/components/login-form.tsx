'use client'

// Sign-in. Deliberately the smallest thing that works.
//
// **There is no sign-up here, and that is D-3 read through to its conclusion.**
// Sales renders no create-workspace flow, so an account created here would land
// on the "you belong to nowhere" screen — a registration form whose successful
// outcome is a dead end. People arrive in this app by invitation.
//
// The Google button only renders when the deployment actually has Google
// configured. `lib/auth.ts` builds its provider list the same way, from the same
// two environment variables, so a button that cannot work is never drawn — but
// the flag has to be passed IN, because `process.env.GOOGLE_CLIENT_ID` is not
// readable from a client component.

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const callbackUrl = params?.get('callbackUrl') ?? '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await signIn('credentials', {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
      callbackUrl,
    })
    setBusy(false)
    if (!res || res.error) {
      // Deliberately one message for "no such user" and "wrong password". Which
      // one it was is exactly the fact an attacker is probing for.
      setError('That email and password do not match an account.')
      return
    }
    router.push(res.url ?? callbackUrl)
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground">
            b/
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">b/sales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            blackcode&rsquo;s business-development pipeline
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25"
              placeholder="you@blackcode.ch"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            Sign in
          </button>
        </form>

        {googleEnabled && (
          <>
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <button
              type="button"
              onClick={() => signIn('google', { callbackUrl })}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Continue with Google
            </button>
          </>
        )}

        <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
          Access is by invitation. Ask a workspace owner to invite you and grant
          you b/sales.
        </p>
      </div>
    </main>
  )
}
