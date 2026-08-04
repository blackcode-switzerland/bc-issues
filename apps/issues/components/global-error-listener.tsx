'use client'

// Catches client-side errors that the React error boundary (app/error.tsx)
// does NOT see: uncaught exceptions outside render (event handlers, timers,
// async callbacks) and unhandled promise rejections. Reports them to the same
// authenticated sink the boundary uses, so they show up in the super-admin
// Errors tab.
//
// Guards against flooding error_events: identical reports are de-duplicated and
// the total per page session is capped.

import { useEffect } from 'react'

const MAX_REPORTS_PER_SESSION = 25

export function GlobalErrorListener() {
  useEffect(() => {
    const seen = new Set<string>()
    let sent = 0

    function report(input: {
      message: string
      stack: string | null
      code: string
      context: Record<string, unknown>
    }) {
      if (sent >= MAX_REPORTS_PER_SESSION) return
      const sig = `${input.code}:${input.message}`
      if (seen.has(sig)) return
      seen.add(sig)
      sent++

      // Fire-and-forget; never surface a second failure to the user. A 401 on
      // unauthenticated pages is expected and silently ignored.
      try {
        fetch('/api/errors/client', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: input.message || 'Unknown client error',
            stack: input.stack,
            code: input.code,
            route: window.location.pathname,
            context: {
              ...input.context,
              user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
            },
          }),
        }).catch(() => {})
      } catch {
        // swallow
      }
    }

    function onError(event: ErrorEvent) {
      report({
        message: event.message || event.error?.message || 'Uncaught error',
        stack: event.error?.stack ?? null,
        code: 'window_error',
        context: {
          source: 'window.onerror',
          filename: event.filename || null,
          lineno: event.lineno ?? null,
          colno: event.colno ?? null,
        },
      })
    }

    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'Unhandled promise rejection'
      report({
        message,
        stack: reason instanceof Error ? (reason.stack ?? null) : null,
        code: 'unhandled_rejection',
        context: { source: 'unhandledrejection' },
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
