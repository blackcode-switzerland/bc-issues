// Settings sits under `/dashboard` and OUTSIDE `/dashboard/{ws}`.
//
// Three of the four pages are about the ACCOUNT, which belongs to the platform
// and is the same row in every app — a name changed here is the name issues
// shows. Nesting them under a workspace would say otherwise.
//
// Preferences is the exception and it says so on its own page: `ui_mode` is
// keyed on (user, workspace), so that page resolves the workspaces this person
// can reach and renders one block per workspace rather than pretending there is
// a single global setting. In practice there is one (D-3), which is exactly why
// the plural branch must not be "pick the first and hope".
//
// The parent `app/dashboard/layout.tsx` has already established a signed-in user
// with access to this app, and shows the two empties otherwise.

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { SettingsNav } from '@/components/settings/settings-nav'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={15} />
        b/sales
      </Link>
      <h1 className="mb-5 text-xl font-semibold text-foreground">Settings</h1>
      <SettingsNav />
      <div className="mt-6">{children}</div>
    </div>
  )
}
