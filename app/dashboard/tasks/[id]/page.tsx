import { TaskDetailView } from '@/components/task-detail-view'

export const dynamic = 'force-dynamic'

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <TaskDetailView taskId={parseInt(id)} />
}
