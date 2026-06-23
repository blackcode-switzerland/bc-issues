import { StorageView } from '@/components/storage-view'

export const dynamic = 'force-dynamic'

export default async function WorkspaceStoragePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <StorageView slug={slug} backHref={`/dashboard/workspaces/${slug}`} />
    </div>
  )
}
