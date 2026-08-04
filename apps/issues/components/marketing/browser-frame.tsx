'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

interface BrowserFrameProps {
  /** Image source for dark mode. */
  srcDark: string
  /** Image source for light mode. */
  srcLight: string
  alt: string
  /** Fake URL shown in the address bar. */
  url?: string
  /** Pixel width hint for next/image — must match the image's intrinsic width. */
  width: number
  /** Pixel height hint for next/image — must match the image's intrinsic height. */
  height: number
  className?: string
}

/**
 * Wraps a hero/product screenshot in a faux browser chrome.
 * Picks the dark/light source based on the resolved theme; falls back to dark
 * on the server so SSR output looks intentional (we then swap on hydration).
 */
export function BrowserFrame({
  srcDark,
  srcLight,
  alt,
  url = 'app.issues.dev/dashboard',
  width,
  height,
  className,
}: BrowserFrameProps) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const src = mounted && resolvedTheme === 'light' ? srcLight : srcDark

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10 ring-1 ring-border/50',
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-border bg-muted/60 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-rose-400/70" aria-hidden />
          <span className="size-2.5 rounded-full bg-amber-400/70" aria-hidden />
          <span className="size-2.5 rounded-full bg-emerald-400/70" aria-hidden />
        </div>
        <div className="flex-1 rounded-md bg-background/70 px-3 py-1 text-center text-xs text-muted-foreground">
          {url}
        </div>
        <div className="w-12" aria-hidden />
      </div>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className="block h-auto w-full"
        priority
      />
    </div>
  )
}
