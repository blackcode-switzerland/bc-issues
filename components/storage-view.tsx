'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, HardDrive, Loader2, Trash2, FileText } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface StorageReference {
  type: 'issue' | 'task' | 'project' | 'comment' | 'project_update' | 'attachment'
  id: number
  seq: number | null
  label: string | null
  trashed: boolean
}

interface StorageFile {
  id: number
  url: string
  filename: string
  size: number | null
  mime_type: string | null
  uploaded_by: number | null
  uploader_name: string | null
  uploader_avatar: string | null
  created_at: string
  reference_count: number
  references: StorageReference[]
}

interface StorageListing {
  data: StorageFile[]
  total: number
  usage_bytes: number
  limit_bytes: number | null
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

const TYPE_LABEL: Record<StorageReference['type'], string> = {
  issue: 'issue',
  task: 'task',
  project: 'project',
  comment: 'comment',
  project_update: 'update',
  attachment: 'attachment',
}

function summarizeRefs(refs: StorageReference[]): string {
  const counts: Partial<Record<StorageReference['type'], number>> = {}
  for (const r of refs) counts[r.type] = (counts[r.type] ?? 0) + 1
  const parts = Object.entries(counts).map(([t, n]) => {
    const label = TYPE_LABEL[t as StorageReference['type']]
    return `${n} ${label}${n! > 1 ? 's' : ''}`
  })
  const anyTrashed = refs.some((r) => r.trashed)
  return parts.join(', ') + (anyTrashed ? ' · some in Trash' : '')
}

export function StorageView({ slug, backHref }: { slug: string; backHref?: string }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [unusedOnly, setUnusedOnly] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['workspace-storage', slug],
    queryFn: async (): Promise<StorageListing> => {
      const res = await fetch(`/api/workspaces/${slug}/storage`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? (res.status === 403 ? 'Only the workspace owner can manage storage.' : 'Failed to load storage'))
      }
      return res.json()
    },
  })

  const del = useMutation({
    mutationFn: async (file: StorageFile) => {
      const res = await fetch(`/api/workspaces/${slug}/storage/${file.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Delete failed')
      }
    },
    onSuccess: () => {
      toast.success('File deleted')
      queryClient.invalidateQueries({ queryKey: ['workspace-storage', slug] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function onDelete(file: StorageFile) {
    const ok = await confirm({
      title: 'Delete this file?',
      description: `"${file.filename}" will be permanently removed from storage. This cannot be undone. Nothing currently references it.`,
      destructive: true,
      confirmLabel: 'Delete permanently',
    })
    if (ok) del.mutate(file)
  }

  const files = data?.data ?? []
  const shown = unusedOnly ? files.filter((f) => f.reference_count === 0) : files
  const orphanCount = files.filter((f) => f.reference_count === 0).length

  return (
    <div>
      <header className="mb-8">
        {backHref ? (
          <Link
            href={backHref}
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} />
            Back
          </Link>
        ) : null}
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <HardDrive size={18} />
          Storage
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every file uploaded into this workspace. Removing a file from a description or comment
          doesn&apos;t delete the stored bytes — delete unused files here to free space.
        </p>
      </header>

      {/* Usage summary */}
      {data ? (
        <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-secondary/30 px-4 py-3 text-sm">
          <div>
            <span className="font-medium">{humanBytes(data.usage_bytes)}</span>
            <span className="text-muted-foreground"> used{data.limit_bytes != null ? ` of ${humanBytes(data.limit_bytes)}` : ''}</span>
          </div>
          <div className="text-muted-foreground">{data.total} file{data.total === 1 ? '' : 's'}</div>
          {orphanCount > 0 ? (
            <div className="text-muted-foreground">{orphanCount} unused</div>
          ) : null}
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              checked={unusedOnly}
              onChange={(e) => setUnusedOnly(e.target.checked)}
              className="cursor-pointer"
            />
            Unused only
          </label>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : isError ? (
        <p className="py-12 text-sm text-destructive">{(error as Error).message}</p>
      ) : shown.length === 0 ? (
        <p className="py-12 text-sm text-muted-foreground">
          {unusedOnly ? 'No unused files.' : 'No files uploaded yet.'}
        </p>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {shown.map((f) => {
            const unused = f.reference_count === 0
            return (
              <div key={f.id} className="flex items-center gap-3 py-3">
                <FileText size={16} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-medium hover:underline"
                    title={f.filename}
                  >
                    {f.filename}
                  </a>
                  <p className="truncate text-xs text-muted-foreground">
                    {f.size != null ? humanBytes(f.size) : '—'}
                    {f.uploader_name ? ` · ${f.uploader_name}` : ''}
                    {' · '}
                    {unused ? (
                      <span className="text-amber-500">Unused</span>
                    ) : (
                      summarizeRefs(f.references)
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(f)}
                  disabled={!unused || del.isPending}
                  title={unused ? 'Delete permanently' : 'In use — remove all references first'}
                  className="shrink-0 cursor-pointer rounded-md border border-border p-2 text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
