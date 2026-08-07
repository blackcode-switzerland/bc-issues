'use client'

// The provider stack, in the order Phase 6 specifies:
//
//   SessionProvider → QueryClientProvider → ThemeProvider → ConfirmProvider
//
// The order is not decorative. `useSession` is read inside query functions and
// inside the shell's account footer, so the session has to be outermost; the
// confirm dialog renders portal content that must sit inside the theme class or
// it paints with the wrong palette.
//
// `ConfirmProvider` is here even though this phase renders no destructive
// action, and that is deliberate: `useConfirm()` is the ONLY confirmation
// mechanism this repo allows (never `window.confirm`), and a provider added
// later is a provider some component will have been written without.

import { SessionProvider } from 'next-auth/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'
import { ConfirmProvider } from '@blackcode/platform-ui/ui/confirm-dialog'

export function Providers({ children }: { children: React.ReactNode }) {
  // Created inside state, not at module scope. A module-scope client is shared
  // across every request in a server process, which leaks one user's cache into
  // another's response.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Everything this app displays is written by an agent working in the
            // background, so a page left open goes stale on its own schedule
            // rather than the reader's. Thirty seconds, and a refetch when the
            // window regains focus — the same settings apps/issues settled on.
            staleTime: 1000 * 30,
            refetchOnWindowFocus: true,
          },
        },
      })
  )

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  )
}
