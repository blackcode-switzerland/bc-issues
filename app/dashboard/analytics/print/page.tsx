// Print-only analytics view. Bypasses the dashboard shell (sidebar, switcher).
// Triggers window.print() automatically once the data has loaded.

import { PrintAnalyticsView } from '@/components/print-analytics-view'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const view = ((typeof sp.view === 'string' ? sp.view : undefined) ?? 'workspace') as
    | 'workspace'
    | 'project'
    | 'milestone'
    | 'member'
  const id = typeof sp.id === 'string' ? parseInt(sp.id) : null
  const from = typeof sp.from === 'string' ? sp.from : null
  const to = typeof sp.to === 'string' ? sp.to : null
  return <PrintAnalyticsView view={view} id={id} from={from} to={to} />
}
