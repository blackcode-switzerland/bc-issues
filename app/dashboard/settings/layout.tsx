import { SettingsNav } from '@/components/settings-nav'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Settings</h1>
      </header>
      <SettingsNav />
      <div className="mt-6">{children}</div>
    </div>
  )
}
