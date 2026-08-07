'use client'

// The account page, and the three things it deliberately does NOT do.
//
// ===========================================================================
// EACH ABSENCE IS A DECISION, AND EACH ONE NAMES WHERE THE CONTROL IS
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
// the message, which from-address) and it belongs with Phase 12's provisioning.
//
// **Deleting your account.** Irreversible, and it reaches across every app:
// soft-deletes the user, hard-deletes solely-owned workspaces, revokes every
// token. None of that is a sales operation. `app/api/me/route.ts` does not
// export DELETE.
//
// **Platform administration.** Settled 2026-08-07: it lives in ONE app, and not
// this one. D-28's test decides it — *would two deployments answer differently?*
// `platform.users` and `platform.error_events` are the same rows from any host,
// which is also why `docs/backend.md` §7.1 records `bk super-admin errors` as
// permanently unmounted here. Building a second copy of an admin surface is the
// tier mistake D-28 exists to prevent. `docs/frontend.md` §11 carries the
// ruling and the two options it beat.
//
// In all three cases the page NAMES the place, and the name is DERIVED — the
// server resolved which apps this person can reach and where they live
// (`platform.apps.base_url`, the D-18 mechanism). This app's code never spells
// another app's slug.

import { useQuery } from '@tanstack/react-query'
import { signOut } from 'next-auth/react'
import { KeyRound, LogOut, ShieldAlert, ShieldCheck } from 'lucide-react'
import { apiGet } from '@/lib/client'
import { BlockSkeleton, ErrorState } from '@/components/states'
import { Section } from './profile-settings'

interface Me {
  email: string
  connected_google: boolean
  is_super_admin: boolean
}

export interface OtherApp {
  name: string
  url: string
}

export function AccountSettings({ otherApps }: { otherApps: OtherApp[] }) {
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
        <Elsewhere icon={<KeyRound size={15} />} apps={otherApps} where="Settings → Account">
          Your password is your blackcode password — the same one for every app. b/sales does not
          send email, so it cannot deliver the one-time code the change needs.
        </Elsewhere>
      </Section>

      <Section title="Deleting your account">
        <Elsewhere icon={<ShieldAlert size={15} />} apps={otherApps} where="Settings → Account">
          Closing a blackcode account is irreversible and reaches every app: it revokes all your API
          tokens and permanently deletes workspaces you solely own. It is deliberately done in one
          place, with a typed confirmation, rather than from each app that happens to be open.
        </Elsewhere>
      </Section>

      {/*
        Shown to everybody, not only to super admins. `is_super_admin` says
        whether this person HAS the surface; it does not say where the surface
        is, and hiding the sentence from somebody who does not have it would mean
        the one person who goes looking is the one person not told. It costs a
        line and it answers a question that otherwise ends in a support message.
      */}
      <Section title="Platform administration">
        <Elsewhere
          icon={<ShieldCheck size={15} />}
          apps={otherApps}
          where="Settings → Super admin"
        >
          Users, error events and the drift reconcilers are <strong>platform-wide</strong> — the
          same rows whichever app you ask, which is why they are served from one place rather than
          copied into each. b/sales has no administration screens of its own and will not grow any.
        </Elsewhere>
      </Section>
    </div>
  )
}

/**
 * "This control exists, and it is over there."
 *
 * The link list is whatever the server resolved, so a person who can reach only
 * b/sales gets the sentence with no link — which is still the right answer, and
 * a great deal better than a control that is simply absent.
 */
function Elsewhere({
  icon,
  apps,
  where,
  children,
}: {
  icon: React.ReactNode
  apps: OtherApp[]
  where: string
  children: React.ReactNode
}) {
  return (
    <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>
        {children}{' '}
        {apps.length === 0 ? (
          <>
            It is done from another blackcode app, under{' '}
            <strong className="font-medium text-foreground">{where}</strong> — you do not currently
            have access to one.
          </>
        ) : (
          <>
            Go to{' '}
            {apps.map((a, i) => (
              <span key={a.url}>
                {i > 0 && (i === apps.length - 1 ? ' or ' : ', ')}
                {/* An <a>, not a <Link>: it leaves this deployment. Same reason
                    the Related block on a prospect uses one (D-18). */}
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {a.name}
                </a>
              </span>
            ))}{' '}
            → <strong className="font-medium text-foreground">{where}</strong>.
          </>
        )}
      </span>
    </p>
  )
}
