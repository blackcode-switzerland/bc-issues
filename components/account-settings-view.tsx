'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { signOut } from 'next-auth/react'
import { toast } from 'sonner'
import { AlertTriangle, Trash2 } from 'lucide-react'

interface DeleteReport {
  blocked_by: Array<{ workspace_id: number; name: string; member_count: number }>
  will_hard_delete: Array<{ workspace_id: number; name: string }>
}

export function AccountSettingsView() {
  const [confirming, setConfirming] = useState(false)
  const [phrase, setPhrase] = useState('')

  const report = useQuery({
    queryKey: ['delete-account-report'],
    enabled: confirming,
    queryFn: async (): Promise<DeleteReport> => {
      const res = await fetch('/api/me?dry_run=true', { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/me', { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Account deleted')
      signOut({ callbackUrl: '/' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-5">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertTriangle size={14} />
        Delete account
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        This soft-deletes your account, hard-deletes workspaces you solely own with no other
        members, and revokes all your API tokens. Your email becomes reusable for a fresh signup.
        Workspaces you&apos;re a member of will still show your past activity, marked as deleted.
      </p>

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
        >
          <Trash2 size={14} />
          Start account deletion
        </button>
      ) : (
        <div className="space-y-4">
          {report.isLoading ? (
            <p className="text-xs text-muted-foreground">Checking what will be affected…</p>
          ) : null}
          {report.data ? (
            <>
              {report.data.blocked_by.length > 0 ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                  <p className="mb-2 font-medium text-amber-400">
                    You must transfer ownership of these workspaces first:
                  </p>
                  <ul className="space-y-1">
                    {report.data.blocked_by.map((w) => (
                      <li key={w.workspace_id} className="flex items-center justify-between">
                        <span>{w.name}</span>
                        <span className="text-muted-foreground">
                          {w.member_count} {w.member_count === 1 ? 'member' : 'members'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {report.data.will_hard_delete.length > 0 ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                  <p className="mb-2 font-medium text-destructive">
                    These workspaces and all their content will be permanently deleted:
                  </p>
                  <ul className="space-y-1">
                    {report.data.will_hard_delete.map((w) => (
                      <li key={w.workspace_id}>{w.name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {report.data.blocked_by.length === 0 ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium">
                      Type <code>DELETE</code> to confirm
                    </label>
                    <input
                      value={phrase}
                      onChange={(e) => setPhrase(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={phrase !== 'DELETE' || remove.isPending}
                      onClick={() => remove.mutate()}
                      className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
                    >
                      Permanently delete my account
                    </button>
                    <button
                      onClick={() => {
                        setConfirming(false)
                        setPhrase('')
                      }}
                      className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
                >
                  Back
                </button>
              )}
            </>
          ) : null}
        </div>
      )}
    </section>
  )
}
