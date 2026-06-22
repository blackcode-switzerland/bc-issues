import { EntityResolver } from '@/components/entity-resolver'

export const dynamic = 'force-dynamic'

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <EntityResolver type="task" id={parseInt(id)} />
}
