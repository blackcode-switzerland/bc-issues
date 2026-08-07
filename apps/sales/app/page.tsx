// The one page, so the app is a real Next app and `npm run build` proves it.
//
// The real UI — shell, theme switcher, providers, pages — is Phase 6/7. This
// placeholder uses token utilities rather than inline styles on purpose: it is
// the first thing that would go wrong if `globals.css` were not imported, and a
// page that renders identically with and without the stylesheet proves nothing.
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-12">
      <h1 className="text-2xl font-semibold text-foreground">b/sales</h1>
      <p className="mt-3 text-muted-foreground">
        blackcode&rsquo;s business-development pipeline. Agents operate it through
        the <code className="rounded-md bg-muted px-1.5 py-0.5 text-foreground">bk sales</code>{' '}
        command group; this web surface is read-mostly.
      </p>
      <p className="mt-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Phase 2 scaffold. The dashboard, prospect pages and search arrive with
        Phases 6&ndash;8.
      </p>
    </main>
  )
}
