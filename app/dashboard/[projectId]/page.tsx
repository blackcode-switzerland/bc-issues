import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ProjectView } from '@/components/project-view'
import { getProject, getKanbanView } from '@/lib/db'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
  }

  const { projectId: projectIdStr } = await params
  const projectId = parseInt(projectIdStr)
  
  // Validate projectId
  if (isNaN(projectId)) {
    redirect('/dashboard')
  }

  let project
  let kanban
  
  try {
    [project, kanban] = await Promise.all([
      getProject(projectId),
      getKanbanView(projectId),
    ])
  } catch (error) {
    console.error('Failed to load project:', error)
    redirect('/dashboard')
  }

  if (!project) {
    redirect('/dashboard')
  }

  return (
    <ProjectView
      project={project}
      initialKanban={kanban}
      user={session.user}
    />
  )
}

