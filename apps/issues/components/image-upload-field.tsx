'use client'

import { useRef, useState } from 'react'
import { Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

interface ImageUploadFieldProps {
  value: string | null
  onChange: (url: string | null) => void
  /** Letter shown in the square when there's no image. */
  fallbackText?: string
  /** Tint for the fallback square. */
  tint?: string
  size?: number
}

// Square image uploader with a rounded tile preview and first-letter fallback.
// Used for workspace logos (and reusable elsewhere).
export function ImageUploadField({
  value,
  onChange,
  fallbackText = '?',
  tint = '#3B82F6',
  size = 56,
}: ImageUploadFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      toast.error('Please choose a JPG, PNG, GIF, or WebP image')
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error('Image must be 5MB or smaller')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.url) throw new Error(j.error ?? 'Upload failed')
      onChange(j.url)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div
        className="relative shrink-0 overflow-hidden rounded-xl border border-border"
        style={{ width: size, height: size, backgroundColor: tint + '1f', color: tint }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="size-full object-cover" />
        ) : (
          <span
            className="flex size-full items-center justify-center font-semibold"
            style={{ fontSize: Math.round(size * 0.42) }}
          >
            {(fallbackText.trim()[0] ?? '?').toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept={ACCEPTED.join(',')} onChange={onPick} className="hidden" />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
        >
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {value ? 'Change' : 'Upload'}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={uploading}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50"
          >
            <X size={13} />
            Remove
          </button>
        ) : null}
      </div>
    </div>
  )
}
