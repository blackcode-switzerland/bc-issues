'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  User,
  Bell,
  Palette,
  Moon,
  Sun,
  Monitor,
  Mail,
  MessageSquare,
  Calendar,
  Check,
  ChevronRight,
  Key,
} from 'lucide-react'
import { ApiTokensSettings } from '@/components/api-tokens-settings'

type SettingsTab = 'profile' | 'notifications' | 'appearance' | 'api-tokens'

const TABS: { id: SettingsTab; label: string; icon: typeof User }[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'api-tokens', label: 'API Tokens', icon: Key },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'appearance', label: 'Appearance', icon: Palette },
]

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const { data: session } = useSession()
  const user = session?.user

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account preferences
        </p>
      </div>

      <div className="flex gap-8">
        {/* Sidebar Navigation */}
        <nav className="w-56 shrink-0">
          <ul className="space-y-1">
            {TABS.map((tab) => {
              const Icon = tab.icon
              return (
                <li key={tab.id}>
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    <Icon size={18} />
                    {tab.label}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Content */}
        <div className="flex-1">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'profile' && <ProfileSettings user={user} />}
            {activeTab === 'api-tokens' && <ApiTokensSettings />}
            {activeTab === 'notifications' && <NotificationSettings />}
            {activeTab === 'appearance' && <AppearanceSettings />}
          </motion.div>
        </div>
      </div>
    </div>
  )
}

function ProfileSettings({ user }: { user?: { name?: string | null; email?: string | null; image?: string | null } }) {
  const [name, setName] = useState(user?.name || '')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    setIsSaving(true)
    // Simulate save
    await new Promise((resolve) => setTimeout(resolve, 500))
    setIsSaving(false)
    toast.success('Profile updated')
  }

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Profile Information</h2>

        {/* Avatar */}
        <div className="flex items-center gap-4 mb-6">
          {user?.image ? (
            <Image
              src={user.image}
              alt={user.name || 'User'}
              width={64}
              height={64}
              className="rounded-full"
            />
          ) : (
            <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center">
              <User size={32} className="text-primary" />
            </div>
          )}
          <div>
            <p className="font-medium">{user?.name || 'User'}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        {/* Name */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1.5">Display Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Email (read-only) */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-1.5">Email</label>
          <input
            type="email"
            value={user?.email || ''}
            disabled
            className="w-full px-4 py-2 bg-secondary border border-input rounded-lg text-muted-foreground cursor-not-allowed"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Email is managed by your authentication provider
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

function NotificationSettings() {
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [issueAssigned, setIssueAssigned] = useState(true)
  const [commentMentions, setCommentMentions] = useState(true)
  const [milestoneUpdates, setMilestoneUpdates] = useState(false)

  const handleToggle = (setter: (val: boolean) => void, currentVal: boolean, label: string) => {
    setter(!currentVal)
    toast.success(`${label} ${!currentVal ? 'enabled' : 'disabled'}`)
  }

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Email Notifications</h2>

        <div className="space-y-4">
          <ToggleItem
            icon={Mail}
            label="Email notifications"
            description="Receive email notifications for important updates"
            enabled={emailNotifications}
            onChange={() => handleToggle(setEmailNotifications, emailNotifications, 'Email notifications')}
          />
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Notification Types</h2>

        <div className="space-y-4">
          <ToggleItem
            icon={User}
            label="Issue assigned"
            description="When an issue is assigned to you"
            enabled={issueAssigned}
            onChange={() => handleToggle(setIssueAssigned, issueAssigned, 'Issue assigned notifications')}
          />

          <ToggleItem
            icon={MessageSquare}
            label="Comment mentions"
            description="When someone mentions you in a comment"
            enabled={commentMentions}
            onChange={() => handleToggle(setCommentMentions, commentMentions, 'Comment mention notifications')}
          />

          <ToggleItem
            icon={Calendar}
            label="Milestone updates"
            description="When a milestone you're involved in is updated"
            enabled={milestoneUpdates}
            onChange={() => handleToggle(setMilestoneUpdates, milestoneUpdates, 'Milestone update notifications')}
          />
        </div>
      </div>
    </div>
  )
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme()

  const themes = [
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'system', label: 'System', icon: Monitor },
  ]

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme)
    toast.success(`Theme changed to ${newTheme}`)
  }

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Theme</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Choose how Blackcode Issues looks to you
        </p>

        <div className="grid grid-cols-3 gap-3">
          {themes.map((t) => {
            const Icon = t.icon
            const isActive = theme === t.id
            return (
              <button
                key={t.id}
                onClick={() => handleThemeChange(t.id)}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-all ${
                  isActive
                    ? 'border-primary bg-primary/10'
                    : 'border-input hover:border-primary/50 hover:bg-secondary'
                }`}
              >
                <Icon size={24} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
                <span className={`text-sm font-medium ${isActive ? 'text-primary' : ''}`}>
                  {t.label}
                </span>
                {isActive && (
                  <Check size={16} className="text-primary" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Density</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Adjust the visual density of the interface
        </p>

        <div className="space-y-2">
          {['Comfortable', 'Compact'].map((density) => (
            <button
              key={density}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${
                density === 'Comfortable'
                  ? 'border-primary bg-primary/10'
                  : 'border-input hover:border-primary/50'
              }`}
            >
              <span className="font-medium">{density}</span>
              {density === 'Comfortable' && <Check size={16} className="text-primary" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ToggleItem({
  icon: Icon,
  label,
  description,
  enabled,
  onChange,
}: {
  icon: typeof User
  label: string
  description: string
  enabled: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-secondary rounded-lg">
          <Icon size={18} className="text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">{label}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <button
        onClick={onChange}
        className={`relative w-11 h-6 rounded-full transition-colors ${
          enabled ? 'bg-primary' : 'bg-secondary'
        }`}
      >
        <motion.div
          className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm"
          animate={{ x: enabled ? 20 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
    </div>
  )
}
