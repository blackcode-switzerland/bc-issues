// The account page resolves the OTHER apps this person can reach, and their
// registered `base_url`s.
//
// Three things on that page live somewhere else — changing a password, closing
// an account, and platform administration — and a page that says so without
// saying WHERE is only marginally better than saying nothing. So it links, and
// the link is built the way D-18 builds every cross-app link: from
// `platform.apps.base_url`, on the server, per app.
//
// **The other app's slug is never named in this app's code.** Hardcoding
// `issues` here would be a second declaration of a fact that lives in
// `platform.apps` — the thing D-18 exists to avoid — and it would be wrong on
// the day a third app arrives. The list is "every app I can reach that is not
// this one", which is a question the platform can answer and this app cannot.
//
// A person who can reach only b/sales gets the same sentence with no link. That
// is the honest answer: those controls exist, and they are not here.

import { redirect } from 'next/navigation'
import { appsReachableByUser } from '@blackcode/platform-db'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { APP_SLUG } from '@/lib/app'
import { AccountSettings } from '@/components/settings/account-settings'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const reachable = await appsReachableByUser(getDb(), user.id)
  const otherApps = reachable
    .filter((a) => a.slug !== APP_SLUG && a.base_url)
    .map((a) => ({ name: a.name, url: a.base_url as string }))

  return <AccountSettings otherApps={otherApps} />
}
