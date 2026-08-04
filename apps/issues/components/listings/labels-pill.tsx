'use client'

interface Label {
  id: number
  name: string
  color: string | null
}

export function LabelChip({ label }: { label: Label }) {
  const color = label.color ?? '#6b7280'
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium"
      style={{
        borderColor: color + '40',
        backgroundColor: color + '15',
        color,
      }}
    >
      {label.name}
    </span>
  )
}

export function LabelList({ labels }: { labels: Label[] }) {
  if (!labels.length) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {labels.map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
    </span>
  )
}
