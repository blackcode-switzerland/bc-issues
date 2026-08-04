import { TaskDetailView } from '@/components/task-detail-view'

export const dynamic = 'force-dynamic'

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ ws: string; seq: string }>
}) {
  const { ws, seq } = await params
  return <TaskDetailView taskId={parseInt(seq)} workspaceSlug={ws} />
}
