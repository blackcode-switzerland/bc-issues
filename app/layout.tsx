import type { Metadata } from 'next'
import { Providers } from './providers'
import { Toaster } from 'sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'Blackcode Issues — AI-Native Issue Tracking',
  description: 'Issue tracking for humans and the agents working alongside them. Three surfaces (web, CLI, HTTP), one data model.',
  icons: {
    icon: '/logo.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Google Sans is served by Google's CSS API but is not listed in the
          public Google Fonts directory, so next/font/google can't fetch it.
          Linking the CSS API directly is the practical option; preconnect
          hints keep the latency cost minimal.
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
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: 'var(--toast-bg)',
                color: 'var(--toast-text)',
                border: '1px solid var(--toast-border)',
              },
              classNames: {
                success: '!border-green-600/40 !bg-green-950/60 !text-green-300',
                error: '!border-red-600/40 !bg-red-950/60 !text-red-300',
              },
            }}
          />
        </Providers>
      </body>
    </html>
  )
}
