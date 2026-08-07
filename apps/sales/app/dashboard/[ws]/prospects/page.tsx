import { ProspectsPage } from '@/components/prospects/prospects-page'

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  return <ProspectsPage ws={ws} />
}
