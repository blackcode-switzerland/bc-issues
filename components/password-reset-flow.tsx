'use client'

// Shared OTP password-reset flow. Two modes:
//   - authenticated=false : logged-out "forgot password" (by email)
//   - authenticated=true  : in-app settings (uses the session email)
//
// Two steps: request a code, then verify the code + set a new password.

import { useState } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, Mail, ShieldCheck } from 'lucide-react'

interface Props {
  authenticated: boolean
  presetEmail?: string
  onDone?: () => void
  onCancel?: () => void
}

type Step = 'request' | 'verify'

const REQUEST_URL = (authed: boolean) =>
  authed ? '/api/me/password/request-otp' : '/api/auth/password-reset/request'
const CONFIRM_URL = (authed: boolean) =>
  authed ? '/api/me/password/confirm' : '/api/auth/password-reset/confirm'

export function PasswordResetFlow({ authenticated, presetEmail, onDone, onCancel }: Props) {
  const [step, setStep] = useState<Step>('request')
  const [email, setEmail] = useState(presetEmail ?? '')
  const [sentTo, setSentTo] = useState<string>('') // masked, for display
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!authenticated && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(REQUEST_URL(authenticated), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: authenticated ? undefined : JSON.stringify({ email: email.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(j.error ?? 'Could not send a code')
      }
      setSentTo(j.email ?? email.trim())
      setStep('verify')
      toast.success('Verification code sent')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function confirmReset(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(CONFIRM_URL(authenticated), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(authenticated ? {} : { email: email.trim() }),
          otp: otp.trim(),
          new_password: password,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(j.error ?? 'Could not reset password')
      }
      toast.success('Password updated')
      onDone?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {step === 'request' ? (
        <form onSubmit={requestCode} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {authenticated
              ? "We'll email a 6-digit code to confirm it's you, then you can set a new password."
              : "Enter your account email and we'll send you a 6-digit code to reset your password."}
          </p>
          {!authenticated ? (
            <div>
              <label className="mb-1 block text-xs font-medium">Email</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          ) : presetEmail ? (
            <p className="rounded-md border border-border bg-card/30 px-3 py-2 text-xs text-muted-foreground">
              Code will be sent to <strong className="text-foreground">{presetEmail}</strong>
            </p>
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              Send code
            </button>
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <form onSubmit={confirmReset} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            We sent a 6-digit code to{' '}
            <strong className="text-foreground">{sentTo || email}</strong>. Enter it below with your
            new password.
          </p>

          <div>
            <label className="mb-1 block text-xs font-medium">Verification code</label>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="w-40 rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.3em] outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">New password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                className="w-full rounded-md border border-border bg-background px-3 py-2 pr-9 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-secondary"
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Confirm new password</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              placeholder="Re-enter password"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              Reset password
            </button>
            <button
              type="button"
              onClick={() => requestCode()}
              disabled={loading}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-50"
            >
              Resend code
            </button>
          </div>
          {!authenticated ? (
            <button
              type="button"
              onClick={() => {
                setStep('request')
                setOtp('')
                setError(null)
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ← Use a different email
            </button>
          ) : null}
        </form>
      )}
    </div>
  )
}
