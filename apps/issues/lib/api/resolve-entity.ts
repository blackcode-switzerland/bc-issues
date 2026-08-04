import { Errors } from './errors'
import { resolveSeqToId, type LocatableType } from '@/lib/db/queries/locate'

// Maps a workspace-scoped #number (the public `id` in URLs) to the internal
// global primary key the query layer uses. Throws 404 if no such number exists
// in the workspace. This is the single place the public seq → internal id
// translation happens for route handlers.
export async function resolveEntityId(
  workspaceId: number,
  type: LocatableType,
  idParam: string
): Promise<number> {
  const seq = parseInt(idParam)
  if (Number.isNaN(seq)) {
    throw Errors.badRequest('invalid_id', 'id must be an integer')
  }
  const internalId = await resolveSeqToId(workspaceId, type, seq)
  if (internalId == null) throw Errors.notFound(type)
  return internalId
}
