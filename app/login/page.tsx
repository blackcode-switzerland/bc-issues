'use client'

import { signIn, getSession } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import Image from 'next/image'

type Mode = 'signin' | 'signup'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const oauthError = searchParams.get('error')

  useEffect(() => {
    getSession().then((session) => {
      if (session) router.push('/dashboard')
    })
  }, [router])

  const handleGoogleSignIn = async () => {
    setOauthLoading(true)
    await signIn('google', { callbackUrl: '/dashboard' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      if (mode === 'signup') {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name: name || undefined }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setFormError(body.error ?? 'Failed to create account')
          return
        }
      }

      const result = await signIn('credentials', {
        redirect: false,
        email,
        password,
      })
      if (!result || result.error) {
        setFormError(
          mode === 'signup'
            ? 'Account created, but auto sign-in failed. Try signing in manually.'
            : 'Invalid email or password'
        )
        return
      }
      router.push('/dashboard')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="bg-card rounded-2xl shadow-2xl border border-border p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 overflow-hidden">
              <Image
                src="/logo.png"
                alt="blackcode issues"
                width={64}
                height={64}
                className="rounded-2xl"
              />
            </div>
            <h1 className="text-2xl font-bold text-foreground">blackcode issues</h1>
            <p className="text-muted-foreground mt-2">
              {mode === 'signin' ? 'Sign in to your account' : 'Create a new account'}
            </p>
          </div>

          {(oauthError || formError) && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm"
            >
              {formError ??
                (oauthError === 'OAuthAccountNotLinked'
                  ? 'This email is already associated with another account.'
                  : 'An error occurred during sign in. Please try again.')}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium mb-1.5">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="optional"
                  className="w-full px-4 py-2.5 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1.5">Email</label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Password</label>
              <input
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'signup' ? 8 : undefined}
                className="w-full px-4 py-2.5 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-sm"
              />
              {mode === 'signup' && (
                <p className="text-xs text-muted-foreground mt-1">At least 8 characters.</p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              ) : mode === 'signin' ? (
                'Sign in'
              ) : (
                'Create account'
              )}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setFormError(null)
            }}
            className="w-full mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {mode === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
          </button>

          <div className="my-6 flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={oauthLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-card border border-border rounded-xl hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {oauthLoading ? (
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span className="font-medium">Continue with Google</span>
              </>
            )}
          </button>

          <div className="mt-8 pt-6 border-t border-border text-center">
            <p className="text-xs text-muted-foreground">🔺 Trinity Architecture</p>
            <p className="text-xs text-muted-foreground mt-1">Prompt → Tools → Software</p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
