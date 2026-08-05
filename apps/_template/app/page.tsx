// The one page, so the app is a real Next app and `npm run build` proves it.
//
// A new app's UI starts here. `@blackcode/platform-ui` carries the shared
// primitives and the theme tokens — import them rather than restyling, or the
// suite stops looking like one product.
export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 48, maxWidth: 640 }}>
      <h1>Template app</h1>
      <p>
        This is the scaffold from <code>apps/_template</code>. Copy the directory,
        rename the slug in the five places listed in <code>lib/app.ts</code>, and
        follow <code>docs/adding-an-app.md</code>.
      </p>
      <p>
        It defines one entity (<code>note</code>), one route
        (<code>/api/workspaces/{'{ws}'}/notes</code>), one CLI command group
        (<code>bk template note</code>) and one guide topic — enough for every
        guardrail in the repo to have something real to check.
      </p>
    </main>
  )
}
