// The machine-readable "how to use this programmatically" note embedded on every
// page by <AgentManifest/> (components/agent-manifest.tsx), and the source for
// /llms.txt.
//
// This used to be 77 dense lines restating the auth header, every envelope
// shape, the pagination rules, the upload flow, the encoding warning… all of it
// a hand-maintained copy of facts that lived elsewhere, and all of it a drift
// risk. Two of those copies were already wrong when we measured.
//
// It is now a POINTER, not a copy. Everything specific lives in exactly one of
// two places, neither of which can go stale:
//
//   `bk guide` — static behaviour, embedded in the binary being run
//   `bk meta`  — dynamic data (vocabularies, limits, workspaces), fetched live
//
// The rule: nothing may be added here that could ever become false. If you are
// tempted to document a route, an envelope or a limit, it belongs in a guide
// topic or in /api/meta instead.

export const AGENT_MANIFEST = {
  project: 'blackcode issues',
  summary: 'AI-native issue tracker. Agents operate it through the bk CLI.',
  interface: 'CLI only. There is no supported HTTP API.',
  install: 'npm install -g @blackcode_sa/bc-issues',
  start: ['bk login', 'bk skill install', 'bk guide', 'bk meta'],
  package: '@blackcode_sa/bc-issues',
  // Where a stuck agent goes. Kept because lib/api/handler.ts advertises these
  // on every response as X-BK-Help / X-BK-Changelog.
  //
  // `changelog` points at the JSON route, not a page: the human /changelog page
  // was removed on 2026-08-03 (nobody read it) and these headers are consumed by
  // agents anyway. `bk changelog` is the CLI-side equivalent.
  help: '/agent-updator',
  changelog: '/api/changelog',
} as const

// Human-readable prose for agents that scrape the raw HTML rather than parse the
// JSON block. Rendered inside an HTML comment at the top of <body>.
export const AGENT_MANIFEST_NOTE = `
blackcode issues — programmatic access
This product is operated through a CLI. There is no supported HTTP API.
  npm install -g @blackcode_sa/bc-issues
  bk login
  bk skill install
  bk guide
\`bk guide\` is the complete usage guide for the binary you just installed, and works offline.
\`bk meta\` returns your workspaces and the live status/priority vocabularies and limits.
Out of date? /agent-updator · What changed: \`bk changelog\` (or /api/changelog)
A structured version of this note is in the <script type="application/json" id="agent-manifest"> element on this page.
`.trim()
