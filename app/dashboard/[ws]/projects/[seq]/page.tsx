import { SeqDetail } from '@/components/seq-detail'

export const dynamic = 'force-dynamic'

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ ws: string; seq: string }>
}) {
  const { ws, seq } = await params
  return <SeqDetail ws={ws} type="project" seq={parseInt(seq)} />
}
