import { DocumentsPage } from '@/components/catalog/catalog-pages'

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  return <DocumentsPage ws={ws} />
}
