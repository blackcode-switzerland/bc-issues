import { ActivityPage } from '@/components/activity/activity-page'

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  return <ActivityPage ws={ws} />
}
