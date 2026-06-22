import { LabelDetailView } from '@/components/label-detail-view'

export const dynamic = 'force-dynamic'

export default async function LabelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LabelDetailView labelId={parseInt(id)} />
}
