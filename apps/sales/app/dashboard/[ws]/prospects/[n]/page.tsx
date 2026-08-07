import { notFound } from 'next/navigation'
import { ProspectDetail } from '@/components/prospects/prospect-detail'

// `{n}` is the workspace #number, never the row id — `lib/views.ts` states the
// rule and the URL is the most public place it has to hold. A non-numeric
// segment is a 404 here rather than a 400 from the API: the page does not exist.
export default async function Page({ params }: { params: Promise<{ ws: string; n: string }> }) {
  const { ws, n } = await params
  const num = Number(n)
  if (!Number.isInteger(num) || num < 1) notFound()
  return <ProspectDetail ws={ws} n={num} />
}
