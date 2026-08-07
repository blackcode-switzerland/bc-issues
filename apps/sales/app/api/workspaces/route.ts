// GET /api/workspaces — `bk workspace list`, and what `bk workspace use` reads.
//
// WITHOUT THIS, A SALES-HOMED CLI CANNOT SET AN ACTIVE WORKSPACE, so the first
// two commands of the north-star script fail and nothing after them runs.
//
// **POST is deliberately absent.** D-3: sales has no create-workspace flow —
// a workspace is the company, and it is created where people are onboarded.
// `bk workspace create` is answered by the issues deployment. That is a real
// capability decision, not a gap, which is why it is written here rather than
// only in a test's exclusion list.
import { workspacesRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = workspacesRoute(appContext)
