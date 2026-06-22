'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { PRESET_COLORS } from './label-colors'

// Full-page "create label" form. Save → create → back to the labels listing.
export function LabelCreateView() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[5])
  const [description, setDescription] = useState('')

  const backHref = `/dashboard/${ws?.slug}/labels`

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color, description: description.trim() || null }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
    },
    onSuccess: () => {
      toast.success('Label created')
      queryClient.invalidateQueries({ queryKey: ['ws-labels-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-labels'] })
      queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
      router.push(backHref)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <Link
          href={backHref}
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={13} />
          Labels
        </Link>
        <h1 className="text-2xl font-semibold">New label</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Labels categorize and filter your issues.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) {
            toast.error('Enter a label name')
            return
          }
          create.mutate()
        }}
        className="space-y-5 rounded-lg border border-border p-5"
      >
        <div>
          <label className="mb-1.5 block text-xs font-medium">Name</label>
          <div className="flex items-center gap-2">
            <span className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              placeholder="Label name"
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium">Color</label>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`size-7 rounded-full transition-transform hover:scale-110 ${color === c ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Link
            href={backHref}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={create.isPending || !ws}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
