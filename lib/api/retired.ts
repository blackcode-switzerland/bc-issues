// The response body the retired discovery endpoints (/api/openapi.json,
// /api/docs) return for their deprecation window.
//
// Shape matches the standard error envelope, so a client that already knows how
// to read our errors needs no special case. The `suggestion` is the whole point:
// it turns a dead endpoint into a recoverable one — an agent can read it, run
// the commands, and continue in the same run.

export const RETIRED_SURFACE_BODY = {
  error:
    'The OpenAPI spec has been retired. blackcode issues is now operated through the bk CLI.',
  code: 'surface_retired',
  suggestion:
    'npm install -g @blackcode_sa/bc-issues && bk login && bk skill install && bk guide',
  details: {
    migration: '/agent-updator',
    replaces: {
      '/api/openapi.json': 'bk guide',
      '/api/docs': 'bk guide',
      'page manifest': 'bk guide',
      '/api/meta': 'bk meta (unchanged, still live)',
    },
  },
} as const
