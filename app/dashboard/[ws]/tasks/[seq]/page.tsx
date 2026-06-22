import { SeqDetail } from '@/components/seq-detail'

export const dynamic = 'force-dynamic'

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ ws: string; seq: string }>
}) {
  const { ws, seq } = await params
  return <SeqDetail ws={ws} type="task" seq={parseInt(seq)} />
}
