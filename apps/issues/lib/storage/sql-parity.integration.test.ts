// Does the SQL recognizer agree with the TypeScript one, byte for byte?
//
//   TEST_DATABASE_URL=postgres://… npm test
//
// ---------------------------------------------------------------------------
// WHY THIS TEST IS THE PRICE OF THE WHOLE DESIGN
// ---------------------------------------------------------------------------
// `platform.blob_references` is maintained by Postgres triggers so that no
// application write path can forget it (see `packages/platform-db/src/schema.ts`
// at `blobReferences`). Buying that guarantee cost one duplication: migration
// 0037 reimplements `assets.ts` — the URL regex, the host test, the
// trailing-punctuation trim — in SQL.
//
// A duplicated recognizer that drifts is worse than no index at all, and it
// drifts in the direction that loses files: if SQL misses a URL that TS matches,
// the index has no row for a reference that really exists, and a deployment that
// can only read the index will consider that file an orphan and delete it.
//
// So this is not a nice-to-have. It is the test that makes "the two agree" a
// checked fact instead of a claim in a comment. Change one implementation,
// change the other, and let this decide whether you got it right.
//
// The corpus below is deliberately adversarial: hosts that merely CONTAIN the
// blob domain, punctuation clinging to a URL, delimiters that must terminate a
// match, case, ports, userinfo, query strings. Every case that has ever been a
// bug belongs in it.

import { beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = TEST_DB ? describe : describe.skip

const BLOB = 'https://abc123.public.blob.vercel-storage.com'

const CORPUS: string[] = [
  '',
  'no urls here at all',
  `plain ${BLOB}/issues/acme/report.pdf`,
  `<img src="${BLOB}/issues/acme/a_b%20c.png"> tail`,
  `markdown ![x](/uploads/foo.png) and (${BLOB}/y.pdf)`,
  `data-file-url="/uploads/deep/dir/file.name.ext"`,
  // Trailing prose punctuation must be trimmed off the URL, not kept.
  `sentence ends ${BLOB}/z.png.`,
  `list: ${BLOB}/a.png, ${BLOB}/b.png; and ${BLOB}/c.png!`,
  `question ${BLOB}/d.png?`,
  // External hosts stay out.
  'external https://example.com/a.png stays out',
  'bare blob.vercel-storage.com/nope',
  // The host must MATCH, not merely contain — this one is an attack.
  'evil https://blob.vercel-storage.com.attacker.test/x.png',
  'evil2 https://notblob.vercel-storage.com.example.org/x.png',
  // The separating dot is load-bearing. This host ENDS WITH the blob domain but
  // is not a subdomain of it, so `endsWith('.blob.…')` rejects it while a
  // careless `LIKE '%blob.…'` accepts it. Found by deliberately breaking the SQL
  // function and watching this test still pass — the corpus had no case for it.
  'evil3 https://notblob.vercel-storage.com/x.png',
  // The apex host is ours too, not only subdomains.
  'exact https://blob.vercel-storage.com/root.png',
  // Case, port, userinfo, query.
  'upper HTTPS://ABC.BLOB.VERCEL-STORAGE.COM/U.PNG',
  `port ${BLOB}:443/p.png`,
  'userinfo https://u:p@abc.blob.vercel-storage.com/q.png',
  `query ${BLOB}/a.png?x=1&y=2`,
  // Duplicates collapse.
  'dupe /uploads/a.png /uploads/a.png',
  `dupe2 ${BLOB}/same.png and again ${BLOB}/same.png`,
  // Delimiters that must terminate a match.
  `<a href='${BLOB}/quoted.png'>t</a>`,
  `[link](${BLOB}/paren.png)`,
  `array[${BLOB}/bracket.png]`,
  `angle <${BLOB}/angle.png>`,
  // Newlines and tabs are whitespace.
  `line1 ${BLOB}/nl.png\nline2 /uploads/tab.png\tafter`,
  // A local path that is not an upload.
  'not ours /public/img.png or /uploadsX/y.png',
  // Realistic TipTap HTML, which is what actually gets stored.
  `<p>see</p><img src="${BLOB}/issues/acme/screenshot.png" alt="s"><p>and <a href="/uploads/spec.pdf">spec</a></p>`,
]

run('SQL and TypeScript recognizers agree (integration)', () => {
  let extractUploadedUrls: (t: string | null | undefined) => string[]
  let isUploadedAsset: (u: string) => boolean
  let db: { execute: (q: never) => Promise<{ rows: Record<string, unknown>[] }> }
  let sql: typeof import('drizzle-orm')['sql']

  beforeAll(async () => {
    ;({ extractUploadedUrls, isUploadedAsset } = await import('./index'))
    ;({ db } = (await import('../db/client')) as never)
    ;({ sql } = await import('drizzle-orm'))
  })

  it('extract_uploaded_urls matches extractUploadedUrls on every corpus entry', async () => {
    // One round trip for the whole corpus: `unnest` keeps the ordinality so a
    // failure names the exact input rather than "something in there".
    const res = await db.execute(sql`
      SELECT i AS idx, platform.extract_uploaded_urls(s) AS urls
      FROM unnest(${sql.param(CORPUS)}::text[]) WITH ORDINALITY AS t(s, i)
      ORDER BY i
    ` as never)

    const mismatches: string[] = []
    for (const row of res.rows) {
      const idx = Number(row.idx) - 1
      const fromSql = ((row.urls as string[]) ?? []).slice().sort()
      const fromTs = extractUploadedUrls(CORPUS[idx]).slice().sort()
      if (JSON.stringify(fromSql) !== JSON.stringify(fromTs)) {
        mismatches.push(
          `input ${idx} ${JSON.stringify(CORPUS[idx])}\n    sql: ${JSON.stringify(fromSql)}\n    ts:  ${JSON.stringify(fromTs)}`
        )
      }
    }
    expect(mismatches.join('\n\n')).toBe('')
  })

  it('is_uploaded_asset matches isUploadedAsset on every URL either side finds', async () => {
    // The union of both sides' output, so a URL only ONE of them produces is
    // still classified by both — that is where a disagreement hides.
    const urls = [
      ...new Set([
        ...CORPUS.flatMap((s) => extractUploadedUrls(s)),
        `${BLOB}/only-ts.png`,
        'https://example.com/x.png',
        '/uploads/y.png',
        'https://blob.vercel-storage.com.attacker.test/x.png',
        'not a url at all',
        '',
      ]),
    ]
    const res = await db.execute(sql`
      SELECT u, platform.is_uploaded_asset(u) AS ours
      FROM unnest(${sql.param(urls)}::text[]) AS u
    ` as never)

    const mismatches = res.rows
      .map((r) => ({ url: String(r.u), sql: Boolean(r.ours), ts: isUploadedAsset(String(r.u)) }))
      .filter((r) => r.sql !== r.ts)
      .map((r) => `${JSON.stringify(r.url)} — sql:${r.sql} ts:${r.ts}`)

    expect(mismatches.join('\n')).toBe('')
  })
})
