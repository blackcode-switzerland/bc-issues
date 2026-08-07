// GET /api/workspaces/{ws}/members — `bk member list`.
// Neutral: no app owns a membership, so every deployment answers alike.
import { workspaceMembersRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = workspaceMembersRoute(appContext)
