import { ProjectDetailView } from '@/components/project-detail-view'

export const dynamic = 'force-dynamic'

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ ws: string; seq: string }>
}) {
  const { ws, seq } = await params
  return <ProjectDetailView projectId={parseInt(seq)} workspaceSlug={ws} />
}
