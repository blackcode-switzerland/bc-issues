// GET /api/users — `bk user view`. Identity is platform data; no app owns it.
import { usersRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = usersRoute(appContext)
