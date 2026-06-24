// /llms.txt — the convention (llmstxt.org) agents check to learn how to use a
// site. Generated from lib/agent-manifest.ts so it stays in sync with the
// per-page manifest and the rest of the API surface automatically.

import { AGENT_MANIFEST as m } from '@/lib/agent-manifest'

function buildLlmsTxt(): string {
  return [
    `# ${m.project}`,
    '',
    `> ${m.summary}`,
    '',
    'This site is fully usable programmatically — drive the bk CLI, or authenticate with a bearer token and call the HTTP API directly. Humans use the web UI at /dashboard.',
    '',
    '## Recommended interface',
    `- ${m.recommended_interface}`,
    `- Install the CLI: ${m.cli.install} — then ${m.cli.login}`,
    '',
    '## Programmatic access',
    `- Auth: ${m.programmatic_access.auth} (${m.programmatic_access.get_a_token})`,
    `- API base: ${m.programmatic_access.api_base} — tenant data is workspace-scoped under ${m.programmatic_access.workspace_scoped_routes}`,
    `- Lists return ${m.programmatic_access.list_envelope}; pagination is ${m.programmatic_access.pagination}`,
    `- Errors return ${m.programmatic_access.error_envelope}`,
    `- Rich text: ${m.programmatic_access.rich_text}`,
    '',
    '## Discovery',
    `- [Context](${m.discovery.context}): current user, active workspace, and the valid status/priority vocabulary — call this first`,
    `- [OpenAPI spec](${m.discovery.openapi}): full OpenAPI 3.1 description of every route`,
    `- [API reference](${m.discovery.docs}): human-browsable docs`,
    '',
    '## CLI (recommended)',
    `- ${m.cli.recommended}`,
    `- Install: ${m.cli.install}`,
    `- Login: ${m.cli.login}`,
    `- Machine output: ${m.cli.machine_output}`,
    '',
    '## Developers',
    `- [Contributor & agent guide](${m.for_developers})`,
    '',
  ].join('\n')
}

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
