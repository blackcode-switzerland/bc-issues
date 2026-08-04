// Public status page. Server-rendered, no auth required. Re-runs on every
// hit (dynamic) — we don't cache the health probe data.

import Link from 'next/link'
import { headers } from 'next/headers'
import { listPublicErrorEvents } from '@/lib/db/queries/error-events'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface ProbeResult {
  status: 'ok' | 'error' | 'not_configured'
  latency_ms: number
  error?: string
  uptime_ms?: number
}

interface StatusPayload {
  overall: 'ok' | 'degraded' | 'down'
  probes: {
    database: ProbeResult
    blob: ProbeResult
    app: ProbeResult
  }
  checked_at: string
}

async function fetchStatus(): Promise<StatusPayload | null> {
  // We could call the route handler, but importing the probe directly is
  // simpler. Re-implement the probes inline to avoid a self-HTTP round-trip.
  const { db } = await import('@/lib/db/client')
  const { sql } = await import('drizzle-orm')

  const t0 = Date.now()
  let db_status: ProbeResult
  try {
    await db.execute(sql`SELECT 1`)
    db_status = { status: 'ok', latency_ms: Date.now() - t0 }
  } catch (err) {
    db_status = { status: 'error', latency_ms: Date.now() - t0, error: (err as Error).message }
  }

  let blob: ProbeResult
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    blob = { status: 'not_configured', latency_ms: 0 }
  } else {
    const t1 = Date.now()
    try {
      const res = await fetch('https://blob.vercel-storage.com/', { method: 'HEAD' })
      blob = {
        status: res.status < 500 ? 'ok' : 'error',
        latency_ms: Date.now() - t1,
        ...(res.status >= 500 ? { error: `HTTP ${res.status}` } : {}),
      }
    } catch (err) {
      blob = { status: 'error', latency_ms: Date.now() - t1, error: (err as Error).message }
    }
  }

  const app: ProbeResult = { status: 'ok', latency_ms: 0 }

  const overall: StatusPayload['overall'] =
    db_status.status === 'error' ? 'down' : blob.status === 'error' ? 'degraded' : 'ok'

  return {
    overall,
    probes: { database: db_status, blob, app },
    checked_at: new Date().toISOString(),
  }
}

function StatusBadge({ s }: { s: ProbeResult }) {
  const color =
    s.status === 'ok'
      ? 'bg-green-500/15 text-green-400 border-green-500/30'
      : s.status === 'not_configured'
        ? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
        : 'bg-red-500/15 text-red-400 border-red-500/30'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs ${color}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {s.status === 'not_configured' ? 'not configured' : s.status}
    </span>
  )
}

export default async function StatusPage() {
  // Touch headers() to opt into request scope (force-dynamic helps too).
  await headers()
  const status = await fetchStatus()
  const errors = await listPublicErrorEvents({ limit: 50 })

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">System status</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Real-time health of bk-cli services. Checked at{' '}
          {status?.checked_at ? new Date(status.checked_at).toLocaleString() : '—'}.
        </p>
      </header>

      {status && (
        <section className="mb-10 rounded-lg border border-zinc-800/60 bg-zinc-950/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-300">Services</h2>
            <span
              className={`text-xs font-medium ${
                status.overall === 'ok'
                  ? 'text-green-400'
                  : status.overall === 'degraded'
                    ? 'text-amber-400'
                    : 'text-red-400'
              }`}
            >
              {status.overall === 'ok'
                ? 'All systems operational'
                : status.overall === 'degraded'
                  ? 'Degraded performance'
                  : 'Major outage'}
            </span>
          </div>
          <ul className="space-y-2.5 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-zinc-300">Database (Postgres)</span>
              <span className="flex items-center gap-3 text-xs text-zinc-500">
                {status.probes.database.latency_ms}ms
                <StatusBadge s={status.probes.database} />
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-zinc-300">File uploads (Blob)</span>
              <span className="flex items-center gap-3 text-xs text-zinc-500">
                {status.probes.blob.status === 'not_configured' ? '—' : `${status.probes.blob.latency_ms}ms`}
                <StatusBadge s={status.probes.blob} />
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-zinc-300">App</span>
              <StatusBadge s={status.probes.app} />
            </li>
          </ul>
        </section>
      )}

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300">Recent errors</h2>
          <span className="text-xs text-zinc-500">{errors.data.length} most recent</span>
        </div>
        {errors.data.length === 0 ? (
          <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/50 p-8 text-center text-sm text-zinc-500">
            No errors recorded.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/60 rounded-lg border border-zinc-800/60 bg-zinc-950/50">
            {errors.data.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <Link
                  href={`/status/errors/${e.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 hover:text-zinc-100"
                  prefetch={false}
                >
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                      e.level === 'fatal'
                        ? 'bg-red-500/15 text-red-400'
                        : e.level === 'warn'
                          ? 'bg-amber-500/15 text-amber-400'
                          : 'bg-zinc-500/15 text-zinc-400'
                    }`}
                  >
                    {e.level}
                  </span>
                  <span className="font-mono text-xs text-zinc-400">{e.code ?? '—'}</span>
                  <span className="truncate font-mono text-xs text-zinc-500">{e.route ?? '—'}</span>
                </Link>
                <span className="shrink-0 text-xs text-zinc-500">
                  {e.status_code ?? '—'}
                </span>
                <span className="shrink-0 text-xs text-zinc-500" suppressHydrationWarning>
                  {new Date(e.occurred_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-zinc-500">
          Stack traces, request context, and user info are visible only to workspace owners.
        </p>
      </section>
    </main>
  )
}
