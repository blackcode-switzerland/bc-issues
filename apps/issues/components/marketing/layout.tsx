import { SiteHeader } from './site-header'
import { SiteFooter } from './site-footer'

/**
 * Standard marketing-page chrome: sticky header + main + footer.
 * Wrap every public page (landing, login, privacy, terms) with this.
 */
export function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  )
}
