import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'b/sales',
  description: "blackcode's business-development pipeline",
}

// The theme provider, the query client and the app shell arrive with Phase 6.
// What this file carries today is the one thing the scaffold cannot: the CSS
// import, without which none of the tokens in globals.css exist at runtime.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
