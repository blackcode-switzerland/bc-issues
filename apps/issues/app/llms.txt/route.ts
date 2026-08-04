// /llms.txt — the convention (llmstxt.org) agents check to learn how to use a
// site. Together with the landing page it is now the ONLY discovery surface:
// everything else is reached through `bk`.
//
// It is deliberately an install funnel, not a reference. An agent arriving here
// with no prior knowledge should be able to go from nothing to a working setup
// in four commands, and get every specific from `bk guide` (embedded, offline)
// and `bk meta` (live). Generated from lib/agent-manifest.ts so the commands
// can't drift from the per-page manifest.

import { AGENT_MANIFEST as m } from '@/lib/agent-manifest'

function buildLlmsTxt(): string {
  return [
    `# ${m.project}`,
    '',
    `> ${m.summary}`,
    '',
    `${m.interface} Humans use the web UI at /dashboard; agents use the CLI.`,
    '',
    '## Start here',
    '',
    '```',
    `${m.install}`,
    ...m.start.map((s) => s),
    '```',
    '',
    '- `bk guide` — the complete usage guide for the binary you just installed.',
    '  It ships inside the executable, so it always describes the version in your',
    '  hand. Works offline and unauthenticated. `bk guide --list` for topics,',
    '  `bk guide <topic>` for one, `bk guide --json` for structured output.',
    '- `bk meta` — who you are, every workspace you can write to, the current',
    '  status/priority/health vocabularies, and every server-enforced limit.',
    '  Pick your workspace by NAME or SLUG, never by numeric id.',
    '- `bk <group> <command> --help` — discover flags before calling.',
    '',
    '## Rules',
    '',
    '- Add `--json` to every read command.',
    '- Set `BK_NO_PROMPT=1` for unattended runs.',
    '- Address projects/tasks/issues by their workspace #number.',
    '',
    '## Keeping current',
    '',
    '- If a command that used to work now fails, run `bk skill sync`, then retry.',
    `- [What changed](${m.changelog}) — the dated record (also \`bk changelog\`).`,
    `- [Migrating from the HTTP API](${m.help}).`,
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
