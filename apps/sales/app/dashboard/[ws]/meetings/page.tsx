import { MeetingsPage } from '@/components/ledgers/ledger-pages'

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  return <MeetingsPage ws={ws} />
}
