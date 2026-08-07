// GET /api/workspaces/{ws}/trash — this app's recycle bin
//
// `bk sales trash` and `bk issues trash` are the same command spelled with
// different app names and answered by different deployments over their own
// tables — which is exactly what D-11's app-owned tier means. There is no shared
// factory for it and there should not be: a bin lists ONE app's entities.
//
// The wire shape is the one `bk <app> trash list` already parses. Sales fills
// what it has and OMITS what it does not: there are no delete batches here, so
// `batch_id` is absent rather than invented, and the CLI prints "—".
import { NextRequest } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { isTrashType, listTrash, TRASH_TYPES, type TrashType } from '@/lib/db/queries/trash'
import { str } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  const type = str(req.nextUrl.searchParams.get('type'))
  if (type && !isTrashType(type)) {
    throw Errors.badRequest(
      'unknown_type',
      `unknown type ${JSON.stringify(type)} for this app`,
      `this app bins ${TRASH_TYPES.join(', ')} — run \`bk meta\` for its entity types`
    )
  }

  const items = await listTrash(ctx.workspace.id, {
    types: type ? [type as TrashType] : undefined,
  })
  return jsonList(
    items.map((i) => ({
      type: i.type,
      // `seq` is the REF column the CLI prints and the value a caller pastes
      // back into restore/purge. It is the #number, never a row id.
      seq: i.number,
      title: i.title,
      deleted_at: i.deleted_at,
      expires_in_days: i.expires_in_days,
    })),
    null
  )
})
