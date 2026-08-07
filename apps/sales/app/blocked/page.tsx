// Where `lib/auth.ts`'s Google `signIn` callback sends an email the whitelist
// refuses. It exists because that callback returns a PATH, and a path that 404s
// turns "you are not allowed in" into "the app is broken" — the visitor cannot
// tell which, and neither can whoever they complain to.
export default function BlockedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-lg font-semibold text-foreground">Access not available</h1>
        <p className="text-sm text-muted-foreground">
          That account is not on the blackcode platform. b/sales is internal and
          access is granted by invitation.
        </p>
        <a href="/login" className="inline-block text-sm text-primary underline">
          Back to sign in
        </a>
      </div>
    </main>
  )
}
