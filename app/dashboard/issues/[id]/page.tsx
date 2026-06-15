import { IssueDetailView } from '@/components/issue-detail-view'

export const dynamic = 'force-dynamic'

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <IssueDetailView issueId={parseInt(id)} />
}
