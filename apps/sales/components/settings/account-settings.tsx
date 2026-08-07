'use client'

// The account page, and what it deliberately does NOT do.
//
// ===========================================================================
// TWO THINGS ARE ABSENT AND BOTH ARE DECISIONS, NOT GAPS
// ===========================================================================
//
// **Changing your password.** The shared factories exist
// (`passwordRequestOtpRoute` / `passwordConfirmRoute`) and this app does not
// mount them, because `passwordRequestOtpRoute` takes a SENDER as a required
// second argument and sales has no email infrastructure: no Resend key, no
// from-address, no templates. Mounting it anyway would produce the worst
// available outcome — "we sent a code to b•••@…" with a 200, and nothing
// arriving. That is the invisible failure this whole project keeps finding, and
// building it deliberately would be worse than not building it.
//
// Wiring email into sales is real work with its own decisions (whose brand is on
// the message, which from-address, what a sales-branded security email even
// looks like) and it belongs with Phase 12's provisioning, not here.
//
// **Deleting your account.** Irreversible, and it reaches across every app:
// soft-deletes the user, hard-deletes solely-owned workspaces, revokes every
// token. None of that is a sales operation. `app/api/me/route.ts` does not
// export DELETE, and this page says where it is done rather than growing a
// second copy of the most destructive flow on the platform.
//
// In both cases the page NAMES the place. A control that is simply missing
// teaches nothing — the reader concludes the feature does not exist, which for
// these two is false and worth being wrong about.

import { useQuery } from '@tanstack/react-query'
import { signOut } from 'next-auth/react'
import { KeyRound, LogOut, ShieldAlert } from 'lucide-react'
import { apiGet } from '@/lib/client'
import { BlockSkeleton, ErrorState } from '@/components/states'
import { Section } from './profile-settings'

interface Me {
  email: string
  connected_google: boolean
  is_super_admin: boolean
}

export function AccountSettings() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiGet<Me>('/api/me') })

  if (me.isPending) return <BlockSkeleton rows={3} />
  if (me.error) return <ErrorState error={me.error} />

  return (
    <div className="space-y-6">
      <Section
        title="Signed in"
        note="One account, one sign-in, every blackcode app (D-16). Signing out here signs you out everywhere."
      >
        <p className="text-sm text-foreground">{me.data.email}</p>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </Section>

      <Section title="Password">
        <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
          <KeyRound size={15} className="mt-0.5 shrink-0" />
          <span>
            Your password is your blackcode password — the same one for every app. b/sales does
            not send email, so it cannot deliver the one-time code the change needs. Change it from{' '}
            <strong className="font-medium text-foreground">b/issues → Settings → Account</strong>,
            or from the &ldquo;Forgot password&rdquo; link on its sign-in page.
          </span>
        </p>
      </Section>

      <Section title="Deleting your account">
        <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
          <ShieldAlert size={15} className="mt-0.5 shrink-0" />
          <span>
            Closing a blackcode account is irreversible and reaches every app: it revokes all your
            API tokens and permanently deletes workspaces you solely own. It is deliberately done in
            one place, with a typed confirmation —{' '}
            <strong className="font-medium text-foreground">b/issues → Settings → Account</strong> —
            rather than from each app that happens to be open.
          </span>
        </p>
      </Section>
    </div>
  )
}
