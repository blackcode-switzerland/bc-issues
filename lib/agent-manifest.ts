// Single source of truth for the machine-readable "how to use this
// programmatically" note embedded on every page by <AgentManifest/>
// (components/agent-manifest.tsx).
//
// Keep it TRUE — it is one of the product surfaces covered by the API
// multi-surface sync contract (see CLAUDE.md / AGENTS.md). If the auth header,
// envelope shape, or discovery endpoints change, update this too.

export const AGENT_MANIFEST = {
  project: 'blackcode issues',
  summary:
    'AI-native issue tracker. The same workspace data is available through a web UI, a Go CLI (bk), and an HTTP API.',
  programmatic_access: {
    api_base: '/api',
    workspace_scoped_routes: '/api/workspaces/{workspace_slug_or_id}/...',
    auth: 'HTTP header — Authorization: Bearer bk_live_<token>',
    get_a_token: 'Mint at /dashboard/settings/tokens, or run: bk login',
    list_envelope: '{ data: [...], next_cursor: number | null }',
    error_envelope: '{ error, code, suggestion?, details? }',
    pagination: 'cursor-based via ?limit= and ?cursor=',
  },
  discovery: {
    context: '/api/meta',
    openapi: '/api/openapi.json',
    docs: '/api/docs',
  },
  cli: {
    package: '@blackcode_sa/bc-issues',
    install: 'npm install -g @blackcode_sa/bc-issues',
    login: 'bk login',
    machine_output: 'add --json or -o yaml; set BK_NO_PROMPT=1 for unattended runs',
  },
  for_developers: '/AGENTS.md',
} as const

// Human-readable prose for agents that scrape the raw HTML rather than parse the
// JSON block. Rendered inside an HTML comment at the top of <body>.
export const AGENT_MANIFEST_NOTE = `
blackcode issues — programmatic access
This is a rendered web page, but everything here is also available over an HTTP API and a CLI.
- API base: /api  (tenant data is workspace-scoped under /api/workspaces/{ws}/...)
- Auth: send  Authorization: Bearer bk_live_<token>  (mint at /dashboard/settings/tokens, or run: bk login)
- Start here: GET /api/meta  (your context + the valid status/priority values)
- Full spec: GET /api/openapi.json  (OpenAPI 3.1; human-browsable at /api/docs)
- CLI: npm install -g @blackcode_sa/bc-issues  then  bk login
- Lists return { data, next_cursor }; errors return { error, code, suggestion?, details? }
- Developer/agent guide: /AGENTS.md
A structured version of this note is in the <script type="application/json" id="agent-manifest"> element on this page.
`.trim()
