import { MetricsPage } from '@/components/metrics/metrics-page'

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  return <MetricsPage ws={ws} />
}
