// The frozen render cases behind `lib/charts-parity.test.ts` (D-12, Phase 1f).
//
// Separate from the test file for one reason: `lib/charts-baseline.ts` imports
// `render()` to RECORD a baseline, and a module that pulls in vitest cannot be
// run by plain node. Read the test file's header for what any of this is for.

import { createElement as h, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as charts from '@blackcode/platform-ui/charts'

// Frozen inputs. Deliberately awkward: a single point, an empty set, a zero
// total, values either side of the compact-format threshold, a negative trend
// and a flat one. Every branch that picks a colour or a shape has a case.
const TREND_ROWS = [
  { bucket: '2026-07-01', created: 4, completed: 2 },
  { bucket: '2026-07-02', created: 0, completed: 7 },
  { bucket: '2026-07-03', created: 12, completed: 12 },
  { bucket: '2026-07-04', created: 3, completed: 1 },
]

/**
 * Every case, keyed. Exported so `lib/charts-baseline.ts` can record it against
 * whichever implementation it is pointed at — that script is the only reason
 * this is a function rather than inline in the assertions.
 */
export function render(kit: typeof charts): Record<string, string> {
  const out: Record<string, string> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const add = (k: string, c: ComponentType<any>, props: Record<string, unknown>) => {
    out[k] = renderToStaticMarkup(h(c, props))
  }
  const S = kit.SERIES

  out['formatNumber'] = [0, 1, 999, 9999, 10000, 12345, 1234567, -4200]
    .map((n) => `${n}=${kit.formatNumber(n)}`)
    .join(' ')
  out['SERIES'] = JSON.stringify(S)

  add('TrendBadge.up', kit.TrendBadge, { pct: 12.5 })
  add('TrendBadge.down', kit.TrendBadge, { pct: -3.25 })
  add('TrendBadge.flat', kit.TrendBadge, { pct: 0.01 })
  add('TrendBadge.invert', kit.TrendBadge, { pct: -8, invert: true })
  add('TrendBadge.null', kit.TrendBadge, { pct: null })

  add('KpiCard.plain', kit.KpiCard, { label: 'Created', value: 128, hint: 'last 30 days' })
  add('KpiCard.full', kit.KpiCard, {
    label: 'Cycle time',
    value: '3.2d',
    hint: 'median',
    pct: -14,
    invert: true,
    spark: [3, 8, 2, 9, 4],
    accent: S.completed,
  })

  add('Sparkline.default', kit.Sparkline, { values: [1, 4, 2, 8, 3] })
  add('Sparkline.nofill', kit.Sparkline, { values: [1, 4, 2, 8, 3], fill: false, color: S.activity })
  add('Sparkline.tooShort', kit.Sparkline, { values: [1] })

  add('AreaLineChart.multi', kit.AreaLineChart, {
    data: TREND_ROWS,
    series: [
      { key: 'created', label: 'Created', color: S.created, fill: true },
      { key: 'completed', label: 'Completed', color: S.completed },
    ],
  })
  add('AreaLineChart.empty', kit.AreaLineChart, { data: [], series: [] })
  add('AreaLineChart.single', kit.AreaLineChart, {
    data: [TREND_ROWS[0]],
    series: [{ key: 'created', label: 'Created', color: S.created, fill: true }],
  })

  add('ChartLegend', kit.ChartLegend, { items: [{ label: 'A', color: S.ideal }] })

  add('DonutChart', kit.DonutChart, {
    data: [
      { label: 'Todo', value: 5, color: S.created },
      { label: 'Done', value: 15, color: S.completed },
    ],
    centerLabel: 'Issues',
  })
  add('DonutChart.zero', kit.DonutChart, { data: [{ label: 'None', value: 0, color: S.ideal }] })

  add('HorizontalBars', kit.HorizontalBars, {
    items: [
      { label: 'alice', value: 12, color: S.activity, sub: 'lead' },
      { label: 'bob', value: 3 },
    ],
    showPercent: true,
  })
  add('HorizontalBars.empty', kit.HorizontalBars, { items: [] })

  add('ColumnChart', kit.ColumnChart, {
    data: [
      { label: '< 1d', count: 4 },
      { label: '1–3d', count: 0 },
      { label: '> 4w', count: 11 },
    ],
  })
  add('ColumnChart.zero', kit.ColumnChart, { data: [{ label: 'x', count: 0 }] })

  add('BurndownChart', kit.BurndownChart, {
    data: [
      { date: '2026-07-01', remaining: 20, ideal: 20 },
      { date: '2026-07-02', remaining: 14, ideal: 10 },
    ],
  })

  add('SummaryCard', kit.SummaryCard, { label: 'Total', value: '42', hint: 'all time' })
  add('VelocityChart', kit.VelocityChart, { data: TREND_ROWS })

  return out
}

