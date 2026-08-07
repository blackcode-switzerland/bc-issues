import { SearchPage } from '@/components/search/search-page'

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  return <SearchPage ws={ws} />
}
