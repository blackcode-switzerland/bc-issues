import { IssueDetailView } from '@/components/issue-detail-view'

export const dynamic = 'force-dynamic'

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ ws: string; seq: string }>
}) {
  const { ws, seq } = await params
  // `seq` is the workspace #number — the public id the API resolves directly.
  return <IssueDetailView issueId={parseInt(seq)} workspaceSlug={ws} />
}
