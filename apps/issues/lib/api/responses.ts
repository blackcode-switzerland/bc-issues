// Canonical list-response envelope for API routes.
//
// Every collection endpoint returns the same shape so clients (web, the bk CLI,
// and AI agents) can write one generic pagination/parsing path:
//
//   { data: T[], next_cursor: number | null, total?: number }
//
// - `data`        — the page of rows.
// - `next_cursor` — pass back as ?cursor= to fetch the next page; `null` when
//                   there are no more rows (and for inherently unpaginated lists).
// - `total`       — optional total count, included only where the query computes
//                   it cheaply (e.g. issues).
//
// Single resources are returned as the bare entity object (no envelope).

import { NextResponse } from 'next/server'

export interface ListPage<T> {
  data: T[]
  next_cursor: number | null
  total?: number
}

export function jsonList<T>(
  data: T[],
  next_cursor: number | null = null,
  extra?: { total?: number }
): NextResponse {
  const body: ListPage<T> = { data, next_cursor }
  if (extra?.total !== undefined) body.total = extra.total
  return NextResponse.json(body)
}
