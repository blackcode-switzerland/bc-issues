import Link from 'next/link'
import { Brand } from './brand'
import { ThemeToggle } from './theme-toggle'
import { Button } from '@/components/ui/button'

/**
 * Shared header for every marketing surface (landing, /login, /privacy, /terms).
 * Same shape everywhere — no per-page variants.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Brand />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/login?tab=signup">Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
