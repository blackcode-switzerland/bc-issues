'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, X, Globe, Mail, ShieldCheck } from 'lucide-react'
import { format } from 'date-fns'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface WhitelistEntry {
  id: number
  type: 'email' | 'domain'
  value: string
  added_by: number | null
  created_at: string
}

type AddType = 'email' | 'domain'

export function SuperAdminWhitelistView() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [addType, setAddType] = useState<AddType>('domain')
  const [value, setValue] = useState('')

  const { data: entries, isLoading } = useQuery({
    queryKey: ['super-admin-whitelist'],
    queryFn: async () => {
      const res = await fetch('/api/super-admin/whitelist')
      if (!res.ok) throw new Error('failed')
      const j = await res.json()
      return j.data as WhitelistEntry[]
    },
  })

  const add = useMutation({
    mutationFn: async ({ type, val }: { type: AddType; val: string }) => {
      const res = await fetch('/api/super-admin/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value: val }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error?.message ?? j.message ?? 'Failed to add')
      return j
    },
    onSuccess: (r) => {
      toast.success(r.message ?? 'Added to whitelist')
      setValue('')
      queryClient.invalidateQueries({ queryKey: ['super-admin-whitelist'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/super-admin/whitelist/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Removed from whitelist')
      queryClient.invalidateQueries({ queryKey: ['super-admin-whitelist'] })
    },
    onError: () => toast.error('Could not remove entry'),
  })

  const domains = entries?.filter((e) => e.type === 'domain') ?? []
  const emails = entries?.filter((e) => e.type === 'email') ?? []

  return (
    <div>
      {/* Platform-wide note */}
      <div className="flex items-center gap-2.5 border-b border-border bg-primary/5 px-6 py-2.5 text-sm text-primary/80">
        <ShieldCheck size={14} className="shrink-0" />
        Changes here affect the entire platform, across all workspaces.
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 border-b border-border bg-secondary/30 px-6 py-4">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Only emails matching an entry here can create accounts or be invited.
          Adding a <strong className="text-foreground">domain</strong> allows everyone on that domain.
          Adding an <strong className="text-foreground">email</strong> allows only that specific address.
          Super admins in the <code className="text-[12px]">SUPER_ADMINS</code> env var are always allowed and do not appear here.
        </p>
      </div>

      {/* Add form */}
      <div className="flex items-end gap-3 border-b border-border px-6 py-4">
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-muted-foreground">Type</label>
          <div className="flex rounded-md border border-border overflow-hidden">
            {(['domain', 'email'] as AddType[]).map((t) => (
              <button
                key={t}
                onClick={() => setAddType(t)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                  addType === t
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60'
                }`}
              >
                {t === 'domain' ? <Globe size={13} /> : <Mail size={13} />}
                {t === 'domain' ? 'Domain' : 'Email'}
              </button>
            ))}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            const v = value.trim()
            if (v) add.mutate({ type: addType, val: v })
          }}
          className="flex flex-1 items-end gap-2"
        >
          <div className="flex-1 space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">
              {addType === 'domain' ? 'Domain (e.g. blackcode.ch)' : 'Email address'}
            </label>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={addType === 'domain' ? 'blackcode.ch' : 'user@blackcode.ch'}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            disabled={add.isPending || !value.trim()}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus size={15} />
            Add
          </button>
        </form>
      </div>

      {isLoading ? (
        <p className="px-6 py-4 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="divide-y divide-border">
          {/* Domains section */}
          {domains.length > 0 && (
            <section>
              <h2 className="border-b border-border bg-secondary/30 px-6 py-1.5 text-[13px] font-medium text-muted-foreground">
                Allowed domains · {domains.length}
              </h2>
              <ul>
                {domains.map((e) => (
                  <WhitelistRow
                    key={e.id}
                    entry={e}
                    onRemove={async () => {
                      if (
                        await confirm({
                          title: `Remove ${e.value}?`,
                          description: 'Anyone on this domain will no longer be able to create new accounts.',
                          destructive: true,
                          confirmLabel: 'Remove',
                        })
                      ) {
                        remove.mutate(e.id)
                      }
                    }}
                  />
                ))}
              </ul>
            </section>
          )}

          {/* Emails section */}
          {emails.length > 0 && (
            <section>
              <h2 className="border-b border-border bg-secondary/30 px-6 py-1.5 text-[13px] font-medium text-muted-foreground">
                Allowed emails · {emails.length}
              </h2>
              <ul>
                {emails.map((e) => (
                  <WhitelistRow
                    key={e.id}
                    entry={e}
                    onRemove={async () => {
                      if (
                        await confirm({
                          title: `Remove ${e.value}?`,
                          description: 'This email will no longer be able to create a new account.',
                          destructive: true,
                          confirmLabel: 'Remove',
                        })
                      ) {
                        remove.mutate(e.id)
                      }
                    }}
                  />
                ))}
              </ul>
            </section>
          )}

          {entries?.length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium">Whitelist is empty</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a domain like <code className="text-[12px]">blackcode.ch</code> to allow everyone on that domain to sign up.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WhitelistRow({
  entry,
  onRemove,
}: {
  entry: WhitelistEntry
  onRemove: () => void
}) {
  return (
    <li className="flex items-center gap-3 border-b border-border/50 px-6 py-2.5 transition-colors hover:bg-secondary/40">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/50 text-muted-foreground">
        {entry.type === 'domain' ? <Globe size={14} /> : <Mail size={14} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{entry.value}</p>
        <p className="text-xs text-muted-foreground capitalize">{entry.type}</p>
      </div>
      <span
        className="hidden w-28 shrink-0 text-sm text-muted-foreground lg:block"
        suppressHydrationWarning
      >
        {format(new Date(entry.created_at), 'MMM d, yyyy')}
      </span>
      <button
        onClick={onRemove}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
        title="Remove"
      >
        <X size={14} />
      </button>
    </li>
  )
}
