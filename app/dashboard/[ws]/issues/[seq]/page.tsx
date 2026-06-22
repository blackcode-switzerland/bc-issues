import { SeqDetail } from '@/components/seq-detail'

export const dynamic = 'force-dynamic'

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ ws: string; seq: string }>
}) {
  const { ws, seq } = await params
  return <SeqDetail ws={ws} type="issue" seq={parseInt(seq)} />
}
