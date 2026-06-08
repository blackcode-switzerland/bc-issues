// Lazy Resend client. We construct it only when RESEND_API_KEY is set so the
// app runs fine in local/dev without email configured. `emailEnabled()` lets
// callers branch without importing the SDK.

import { Resend } from 'resend'

let cached: Resend | null = null

export function emailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL
}

export function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!cached) cached = new Resend(process.env.RESEND_API_KEY)
  return cached
}

export function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL ?? 'no-reply@example.com'
}
