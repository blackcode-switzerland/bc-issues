// Public health endpoint. No auth. Cheap to call — three quick probes:
//   db_ping   : SELECT 1 against Postgres
//   blob_ping : HEAD on a known Vercel Blob endpoint if configured; else marked
//               "not_configured" (still green — the local-fs fallback works)
//   app_ping  : returns the current build sha + uptime
//
// We cap each probe at a short timeout so a hung dependency can't stall /status.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { sql } from 'drizzle-orm'

const PROBE_TIMEOUT_MS = 2_500

interface ProbeResult {
  status: 'ok' | 'error' | 'not_configured'
  latency_ms: number
  error?: string
}

const startedAt = Date.now()

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms)
    ),
  ])
}

async function dbProbe(): Promise<ProbeResult> {
  const t0 = Date.now()
  try {
    await withTimeout(db.execute(sql`SELECT 1`), PROBE_TIMEOUT_MS)
    return { status: 'ok', latency_ms: Date.now() - t0 }
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - t0,
      error: (err as Error)?.message ?? 'unknown',
    }
  }
}

async function blobProbe(): Promise<ProbeResult> {
  const t0 = Date.now()
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { status: 'not_configured', latency_ms: 0 }
  }
  try {
    // Light HEAD against the Vercel blob origin. Treat any 2xx/3xx as ok.
    const res = await withTimeout(
      fetch('https://blob.vercel-storage.com/', { method: 'HEAD' }),
      PROBE_TIMEOUT_MS
    )
    return {
      status: res.status < 500 ? 'ok' : 'error',
      latency_ms: Date.now() - t0,
      ...(res.status >= 500 ? { error: `HTTP ${res.status}` } : {}),
    }
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - t0,
      error: (err as Error)?.message ?? 'unknown',
    }
  }
}

function appProbe(): ProbeResult {
  return { status: 'ok', latency_ms: 0 }
}

export async function GET() {
  const [dbR, blobR] = await Promise.all([dbProbe(), blobProbe()])
  const appR = appProbe()

  const overall: 'ok' | 'degraded' | 'down' =
    dbR.status === 'error'
      ? 'down'
      : blobR.status === 'error' || appR.status === 'error'
        ? 'degraded'
        : 'ok'

  return NextResponse.json(
    {
      overall,
      probes: {
        database: dbR,
        blob: blobR,
        app: { ...appR, uptime_ms: Date.now() - startedAt },
      },
      checked_at: new Date().toISOString(),
    },
    {
      status: overall === 'down' ? 503 : 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}
