// Re-record `lib/charts.baseline.json` from the CURRENT chart kit.
//
//   cd apps/issues
//   npx tsx --tsconfig ../../packages/platform-ui/tsconfig.json \
//       lib/charts-baseline.ts --i-mean-it
//
// The `--tsconfig` flag is not optional: the kit lives in `packages/platform-ui`
// and tsx picks the tsconfig nearest the ENTRY file, which is this one. Without
// it the JSX compiles against the classic runtime and every render dies with
// "React is not defined".
//
// ---------------------------------------------------------------------------
// THIS SCRIPT DESTROYS EVIDENCE. THAT IS WHY IT ASKS.
// ---------------------------------------------------------------------------
// `charts.baseline.json` is a RECORDING of how the analytics page rendered
// before the chart kit moved packages (D-12, Phase 1f). It was taken from
// `apps/issues/components/analytics/charts.tsx` as that file stood before a line
// of it changed, and it is the only artefact in the repo that remembers.
//
// Running this replaces it with whatever the code does today, which makes
// `charts-parity.test.ts` assert that the code equals itself — the exact shape
// of half the inert guards in CLAUDE.md's table. Doing that by accident is easy:
// the author of this script did it, in the same hour as writing it, by running
// it to check that it ran.
//
// So it refuses without `--i-mean-it`, and the rule for using it is:
//
//   1. You changed a chart ON PURPOSE and the parity test went red.
//   2. You read the diff, all of it, and each hunk is the change you intended.
//   3. You say in the commit message what moved and why.
//
// A red parity test is not a reason to run this. It is a reason to look.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as charts from '@blackcode/platform-ui/charts'
import { render } from './charts-cases'

if (!process.argv.includes('--i-mean-it')) {
  console.error(
    'refusing: this overwrites the pre-move recording of the analytics page.\n' +
      'Read the header of lib/charts-baseline.ts, then pass --i-mean-it.'
  )
  process.exit(1)
}

const data = render(charts)
const out = join(__dirname, 'charts.baseline.json')
writeFileSync(out, JSON.stringify(data, null, 2) + '\n')
console.log(`wrote ${out} (${Object.keys(data).length} cases) — now read the diff`)
