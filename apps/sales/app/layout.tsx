import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'b/sales',
  description: "blackcode's business-development pipeline",
  // Internal tooling holding third parties' contact details (D-19). Nothing here
  // should ever be indexed.
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Google Sans is served by Google's CSS API but is not listed in the
          public Google Fonts directory, so `next/font/google` cannot fetch it.
          Linking the CSS API directly is the practical option; the preconnects
          keep the latency cost small. Same arrangement as apps/issues — the font
          is the platform's, the palette around it is this app's (D-4).
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap"
        />
      </head>
      <body className="font-sans antialiased">
        <Providers>
          {children}
          {/* Toasts are token-driven through the `--toast-*` bridge in
              globals.css, so sales' warm palette reaches them without a single
              colour being named here. */}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: 'var(--toast-bg)',
                color: 'var(--toast-text)',
                border: '1px solid var(--toast-border)',
              },
            }}
          />
        </Providers>
      </body>
    </html>
  )
}
