import { TodayPage } from '@/components/today/today-page'

// A thin server page rendering one `'use client'` feature component, which is
// the shape §8 specifies for every page in this app: the server does routing and
// the params, the client does the fetching through TanStack Query.
//
// Nothing is fetched here. A server-rendered first paint would need its own copy
// of the data access, and the two would then have to agree about caching,
// errors and empty states — which is the drift the shape exists to avoid.
export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  return <TodayPage ws={ws} />
}
