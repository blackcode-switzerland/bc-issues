// Full error detail. Gated to workspace owners. If the viewer is not an owner,
// we render a friendly "ask an owner" message instead of throwing.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUserByEmail } from '@/lib/db/queries/users'
import { getErrorEvent } from '@/lib/db/queries/error-events'
import { isWorkspaceOwnerSomewhere } from '@/lib/db/queries/workspaces'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ErrorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) return notFound()

  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  const user = email ? await getUserByEmail(email) : null

  if (!user) {
    return (
      <Gate
        title="Sign in to see error details"
        body="Full error stacks and request context are visible only to workspace owners."
      />
    )
  }

  const isOwner = await isWorkspaceOwnerSomewhere(user.id)
  if (!isOwner) {
    return (
      <Gate
        title="Owners only"
        body="Only workspace owners can view full error details. Ask one of your owners to investigate."
      />
    )
  }

  const event = await getErrorEvent(id)
  if (!event) return notFound()

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/status" className="text-xs text-zinc-500 hover:text-zinc-300" prefetch={false}>
        ← back to status
      </Link>
      <header className="mt-3 mb-6">
        <h1 className="text-xl font-semibold">{event.code ?? 'internal_error'}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {event.method ?? ''} {event.route ?? '—'} {event.status_code ? `· HTTP ${event.status_code}` : ''}
        </p>
        <p className="mt-1 text-xs text-zinc-500" suppressHydrationWarning>
          {new Date(event.occurred_at).toLocaleString()}
        </p>
      </header>

      <section className="mb-6 rounded-lg border border-zinc-800/60 bg-zinc-950/50 p-4">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Message</h2>
        <pre className="whitespace-pre-wrap break-words font-mono text-sm text-zinc-200">
          {event.message}
        </pre>
      </section>

      {event.stack && (
        <section className="mb-6 rounded-lg border border-zinc-800/60 bg-zinc-950/50 p-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Stack</h2>
          <pre className="overflow-auto whitespace-pre font-mono text-xs leading-relaxed text-zinc-300">
            {event.stack}
          </pre>
        </section>
      )}

      {event.context ? (
        <section className="mb-6 rounded-lg border border-zinc-800/60 bg-zinc-950/50 p-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Context</h2>
          <pre className="overflow-auto whitespace-pre font-mono text-xs leading-relaxed text-zinc-300">
            {String(JSON.stringify(event.context, null, 2))}
          </pre>
        </section>
      ) : null}
    </main>
  )
}

function Gate({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-zinc-500">{body}</p>
      <Link
        href="/status"
        className="mt-6 inline-block rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
        prefetch={false}
      >
        Back to status
      </Link>
    </main>
  )
}
