import { AGENT_MANIFEST, AGENT_MANIFEST_NOTE } from '@/lib/agent-manifest'

// Machine-readable metadata embedded on every page (rendered once in the root
// layout) so an agent that fetches ANY route — not just the API — immediately
// learns there is a token-authenticated HTTP API + CLI, and where to discover it.
//
// Renders nothing visible:
//   1. an HTML comment with the prose note (for agents that grep raw HTML), and
//   2. a <script type="application/json"> with the structured manifest.
// No user- or page-specific data, so it is safe on authenticated pages too.
//
// `<` is escaped to < so the JSON can never prematurely close the <script>.
export function AgentManifest() {
  const json = JSON.stringify(AGENT_MANIFEST).replace(/</g, '\\u003c')
  return (
    <>
      <div
        hidden
        aria-hidden="true"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: `<!--\n${AGENT_MANIFEST_NOTE}\n-->` }}
      />
      <script
        type="application/json"
        id="agent-manifest"
        dangerouslySetInnerHTML={{ __html: json }}
      />
    </>
  )
}
