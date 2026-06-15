'use client'

/** Deterministic background color from any string (name, email, workspace name). */
export function avatarColor(label: string): string {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `oklch(0.52 0.18 ${hue})`
}

function getInitials(label: string): string {
  const parts = label.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  // Single word or email handle — first 2 chars
  const handle = label.includes('@') ? label.split('@')[0] : label
  return handle.slice(0, 2).toUpperCase()
}

/** Small round member avatar with deterministic-color initial fallback. */
export function MemberAvatar({
  name,
  email,
  avatarUrl,
  size = 18,
  className,
}: {
  name?: string | null
  email?: string | null
  avatarUrl?: string | null
  size?: number
  className?: string
}) {
  const label = (name?.trim() || email || '?') as string
  const initials = getInitials(label)
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={label}
        title={label}
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${className ?? ''}`}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      title={label}
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(7, Math.round(size * 0.38)),
        backgroundColor: avatarColor(label),
      }}
    >
      {initials}
    </span>
  )
}
