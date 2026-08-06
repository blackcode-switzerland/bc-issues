// Moved to @blackcode/platform-db on 2026-08-06, with GET
// /api/workspaces/{ws}/invite-candidates becoming a shared route factory
// (docs/sales-app-plan.md Phase 1b, D-2). It reads only platform.users,
// platform.workspace_members, platform.workspaces and
// platform.workspace_invitations — nothing an issue tracker owns.
//
// Bound to this app's `db` here so every existing `@/lib/db/queries/invite-candidates`
// import keeps working unchanged.
import { db } from '@/lib/db/client'
import {
  listInviteCandidates as platformListInviteCandidates,
  type InviteCandidate,
  type ListInviteCandidatesInput,
} from '@blackcode/platform-db'

export type { InviteCandidate }

export function listInviteCandidates(
  input: ListInviteCandidatesInput
): Promise<InviteCandidate[]> {
  return platformListInviteCandidates(db, input)
}
