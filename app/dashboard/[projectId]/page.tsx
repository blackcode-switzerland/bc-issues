import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ProjectDetailView } from '@/components/project-detail-view'

export const dynamic = 'force-dynamic'

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const { projectId } = await params
  return <ProjectDetailView projectId={parseInt(projectId)} />
}
