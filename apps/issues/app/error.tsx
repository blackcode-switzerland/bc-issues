'use client'

// Top-level error boundary. Fires for any unhandled error in the app router.
// We log to the server via /api/errors/client and render a minimal recovery UI.

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Fire-and-forget; never block render or surface a second failure to the user.
    try {
      fetch('/api/errors/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          code: error.digest ? `client_error_${error.digest}` : 'client_error',
          route: typeof window !== 'undefined' ? window.location.pathname : null,
          context: {
            user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          },
        }),
      }).catch(() => {})
    } catch {
      // swallow
    }
  }, [error])

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-zinc-500">
            An unexpected error occurred. The team has been notified.
          </p>
          {error.digest ? (
            <p className="mt-3 font-mono text-[11px] text-zinc-600">ref: {error.digest}</p>
          ) : null}
          <button
            onClick={reset}
            className="mt-6 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
          >
            Try again
          </button>
          <a
            href="/status"
            className="mt-3 text-xs text-zinc-500 hover:text-zinc-300"
          >
            See system status →
          </a>
        </main>
      </body>
    </html>
  )
}
