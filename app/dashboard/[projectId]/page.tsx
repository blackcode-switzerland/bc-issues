import { EntityResolver } from '@/components/entity-resolver'

export const dynamic = 'force-dynamic'

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <EntityResolver type="project" id={parseInt(projectId)} />
}
