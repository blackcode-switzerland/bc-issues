// Public landing page for invitation links. If the invitee is signed out, we
// redirect to login with a callback URL pointing back here. If signed in, we
// show accept/decline UI.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getInvitationByToken } from '@/lib/db/queries/invitations'
import { AcceptInvitationButton } from '@/components/accept-invitation-button'

export const dynamic = 'force-dynamic'

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invitations/${token}`)}`)
  }

  const inv = await getInvitationByToken(token)
  if (!inv) {
    return (
      <main className="mx-auto max-w-md px-6 py-20 text-center">
        <h1 className="text-lg font-semibold">Invitation not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This invitation link is invalid or has been removed.
        </p>
        <Link href="/dashboard" className="mt-6 inline-block text-xs text-primary hover:underline">
          Back to dashboard →
        </Link>
      </main>
    )
  }

  const expired = new Date(inv.expires_at).getTime() < Date.now()
  const sessionEmail = session.user?.email?.toLowerCase()
  const matchesEmail = sessionEmail === inv.email.toLowerCase()

  let message: string | null = null
  if (inv.status === 'accepted') message = 'This invitation has already been accepted.'
  else if (inv.status === 'revoked') message = 'This invitation was revoked.'
  else if (inv.status === 'declined') message = 'This invitation was declined.'
  else if (expired) message = 'This invitation has expired.'
  else if (!matchesEmail) {
    message = `This invitation is for ${inv.email}. You're signed in as ${session.user?.email}.`
  }

  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <h1 className="text-xl font-semibold">You&apos;re invited</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        to join <strong>{inv.workspace_name}</strong>
      </p>

      {message ? (
        <div className="mt-6 rounded-lg border border-border bg-card/30 p-4 text-sm text-muted-foreground">
          {message}
        </div>
      ) : (
        <AcceptInvitationButton token={token} />
      )}

      <Link href="/dashboard" className="mt-6 inline-block text-xs text-muted-foreground hover:text-foreground">
        ← Back to dashboard
      </Link>
    </main>
  )
}
