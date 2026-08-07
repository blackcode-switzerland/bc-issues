// POST /api/workspaces/{ws}/templates/{n}/render — fill a template in
//
// ---------------------------------------------------------------------------
// A MISSING VARIABLE IS A 400, NOT A GAP LEFT IN THE OUTPUT
// ---------------------------------------------------------------------------
// A rendered message still containing a literal `{{first_name}}` is one an agent
// will paste into an email, and the failure is visible only to the recipient. So
// an unsupplied variable refuses the render and the error NAMES EACH MISSING ONE
// AND THE FULL DECLARED SET — §6.3 lists this as one of the four errors worth
// hand-writing, and it is the only one where the fix cannot be guessed from the
// failure alone.
//
// Rendering does not SEND anything and does not record anything. It is a pure
// function over a stored template, which is why it writes no event: nothing
// happened to the prospect.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getTemplateBySeq, renderTemplate } from '@/lib/db/queries/catalog'
import { requireNumberParam } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'template')
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const tpl = await getTemplateBySeq(ctx.workspace.id, seq)
  if (!tpl || tpl.deleted_at) {
    throw Errors.notFound(
      'template_not_found',
      `no template #${seq} in this workspace`,
      'run `bk sales template list` for the numbers'
    )
  }

  const raw = body?.vars
  const vars: Record<string, string> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v != null) vars[k] = String(v)
    }
  }

  const out = renderTemplate(tpl, vars)
  if (out.missing.length > 0) {
    throw Errors.badRequest(
      'missing_variables',
      `template #${seq} needs ${out.missing.map((m) => `{{${m}}}`).join(', ')}`,
      `this template declares ${(tpl.variables ?? []).map((v) => `{{${v}}}`).join(', ') || '(none)'} — ` +
        `pass ${out.missing.map((m) => `--var ${m}=…`).join(' ')}`
    )
  }

  return NextResponse.json({
    number: tpl.seq,
    name: tpl.name,
    channel: tpl.channel,
    subject: out.subject,
    body: out.body,
    // Supplied but not declared: usually a typo in a --var key, and silence
    // about it is how somebody spends ten minutes wondering why the name did
    // not appear.
    unused: out.unused,
  })
})
