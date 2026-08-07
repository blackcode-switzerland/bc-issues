import { TrashPage } from '@/components/trash/trash-page'

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  return <TrashPage ws={ws} />
}
