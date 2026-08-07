// The browser's side of this app's own API.
//
// ── EVERY FETCH IS SAME-ORIGIN, AND THAT IS D-10 ────────────────────────────
// Paths only — never an absolute URL, never a base-URL constant, never an env
// var pointing at another deployment. `sales.blackcode.ch` talks to
// `sales.blackcode.ch` and nothing else, which is what makes the shared route
// factories (D-2) mandatory rather than nice: this app serves its own
// `/api/upload` and `/api/meta` because a fetch is not allowed to go and find
// somebody else's.
//
// Cross-app links (D-18) are the deliberate exception and they are not fetches:
// they are anchors carrying an absolute `url` the SERVER built from the other
// app's registered `base_url`.
//
// ── THE ERROR SHAPE IS THE ONE THE CLI PRINTS ───────────────────────────────
// `{ error, code, suggestion? }` — the same body `bk` turns into a `hint:` line
// (`packages/platform-api/src/errors.ts`). Carrying `suggestion` through to the
// browser means a 400 an agent could act on is also a 400 a human can act on,
// rather than "something went wrong".

export class ApiClientError extends Error {
  readonly status: number
  readonly code: string
  readonly suggestion?: string

  constructor(status: number, code: string, message: string, suggestion?: string) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.suggestion = suggestion
  }
}

/** A list route's envelope. Single resources come back bare — see `jsonList()`. */
export interface ListPage<T> {
  data: T[]
  next_cursor: number | null
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    // A 500 from a proxy is HTML, and `res.json()` on HTML throws something that
    // reads like a parser bug rather than a server error. Fall back to the
    // status line: wrong-ish and honest beats "Unexpected token < in JSON".
    const body = (await res.json().catch(() => null)) as
      | { error?: string; code?: string; suggestion?: string }
      | null
    throw new ApiClientError(
      res.status,
      body?.code ?? String(res.status),
      body?.error ?? `Request failed (${res.status})`,
      body?.suggestion
    )
  }
  return (await res.json()) as T
}

/** `?a=1&b=2`, with null/undefined/empty dropped. Returns '' when nothing is set. */
export function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue
    q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** `/api/workspaces/{ws}` + the rest. One place so no page hand-builds it. */
export function wsPath(ws: string, rest: string): string {
  return `/api/workspaces/${encodeURIComponent(ws)}${rest}`
}
