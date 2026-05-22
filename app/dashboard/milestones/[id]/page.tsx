import { MilestoneDetailView } from '@/components/milestone-detail-view'

export const dynamic = 'force-dynamic'

export default async function MilestoneDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <MilestoneDetailView milestoneId={parseInt(id)} />
}
