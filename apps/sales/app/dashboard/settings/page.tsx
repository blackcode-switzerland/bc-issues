import { redirect } from 'next/navigation'

// `/dashboard/settings` has no content of its own. Redirecting beats rendering
// a fifth page whose only job is to point at the four real ones.
export default function SettingsIndex() {
  redirect('/dashboard/settings/profile')
}
