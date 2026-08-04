// Print-only analytics view. Bypasses the dashboard shell (sidebar, switcher).
// Triggers window.print() automatically once the data has loaded.
//
// All query params (view, id, from, to, interval, and the faceted status /
// priority / label / assignee filters) are forwarded verbatim to the analytics
// API so the printed report matches exactly what's on screen. `theme` is pulled
// out separately to drive next-themes.

import { PrintAnalyticsView } from '@/components/print-analytics-view'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const usp = new URLSearchParams()
  let theme: string | null = null
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'theme') {
      theme = typeof v === 'string' ? v : null
      continue
    }
    if (Array.isArray(v)) v.forEach((x) => usp.append(k, x))
    else if (v != null) usp.append(k, v)
  }
  return <PrintAnalyticsView query={usp.toString()} theme={theme} />
}
