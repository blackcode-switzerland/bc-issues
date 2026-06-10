'use client'

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
  const initial = label[0]?.toUpperCase() ?? '?'
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
  // Stable hue from the label so each member keeps a consistent color.
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return (
    <span
      title={label}
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.round(size * 0.48)),
        backgroundColor: `oklch(0.55 0.09 ${hue})`,
      }}
    >
      {initial}
    </span>
  )
}
