import Link from 'next/link'

export const metadata = { title: 'Access Restricted' }

export default function BlockedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-1">
          <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-full border border-border bg-secondary/50">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-muted-foreground"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">You&apos;re not on the list</h1>
          <p className="text-sm text-muted-foreground">
            Blackcode is invite-only right now. Your email isn&apos;t in our approved members list — but hey, you have great taste.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-secondary/30 px-4 py-3 text-left text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Think this is a mistake?</p>
          <p className="mt-1">
            Ask a team admin to add your email or domain to the whitelist. Once added, you&apos;re in.
          </p>
        </div>

        <Link
          href="/login"
          className="inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  )
}
