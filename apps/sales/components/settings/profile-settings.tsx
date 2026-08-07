'use client'

// Your name and tagline — `platform.users`, the same row every blackcode app
// reads. The page says so, because a Settings screen inside one app reads as
// that app's settings and this one is not.
//
// It writes through `apiSend`, not through `lib/mutations.ts`, and **it is not
// behind `ui_mode`**. `read_only` hides editing of the sales PIPELINE; a display
// preference that also stopped somebody changing their own name would have
// become a permission over the account, which is the misreading D-7 exists to
// prevent. `lib/read-only.test.ts` allows this call site by name and asserts the
// path it uses is not an `/api/workspaces/…` one.

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiGet, apiSend } from '@/lib/client'
import { BlockSkeleton, ErrorState } from '@/components/states'

interface Me {
  id: number
  email: string
  name: string | null
  tagline: string | null
  avatar_url: string | null
  connected_google: boolean
  avatar_editable: boolean
  is_super_admin: boolean
}

export function ProfileSettings() {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiGet<Me>('/api/me') })

  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Seeded ONCE. Re-seeding on every render of fresh data would overwrite what
  // somebody is typing the moment a background refetch lands.
  useEffect(() => {
    if (me.data && !loaded) {
      setName(me.data.name ?? '')
      setTagline(me.data.tagline ?? '')
      setLoaded(true)
    }
  }, [me.data, loaded])

  const save = useMutation({
    mutationFn: () =>
      apiSend<Me>('PATCH', '/api/me', {
        name: name.trim() || null,
        tagline: tagline.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      toast.success('Profile updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (me.isPending) return <BlockSkeleton rows={3} />
  if (me.error) return <ErrorState error={me.error} />

  return (
    <div className="space-y-6">
      <Section
        title="Your blackcode profile"
        note="This is your account, not a b/sales one. The name here is the name every blackcode app shows."
      >
        <Field label="Email">
          <p className="text-sm text-foreground">{me.data.email}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {me.data.connected_google
              ? 'Signed in with Google. Your photo is synced from there.'
              : 'Signed in with a password.'}
          </p>
        </Field>

        <Field label="Name" htmlFor="name">
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
        </Field>

        <Field label="Tagline" htmlFor="tagline">
          <input
            id="tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="What you do here"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
        </Field>

        <div className="flex justify-end">
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Section>
    </div>
  )
}

export function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card/40 p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}
