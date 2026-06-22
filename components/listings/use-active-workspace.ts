'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'

export interface ActiveWorkspace {
  id: number
  name: string
  slug: string
  member_role: 'owner' | 'member'
}

// The workspace the user is currently working in.
//
// URL is the source of truth: workspace-scoped pages live under
// /dashboard/{ws}/… so the `ws` route param (a slug or id) decides the
// workspace. On unscoped pages (inbox, settings) there is no `ws` param, so we
// fall back to the user's remembered default (`active_workspace_id`).
export function useActiveWorkspace() {
  const params = useParams()
  const rawWs = params?.ws
  const urlWs = typeof rawWs === 'string' ? rawWs : Array.isArray(rawWs) ? rawWs[0] : null

  return useQuery({
    queryKey: ['active-workspace', urlWs ?? null],
    queryFn: async (): Promise<ActiveWorkspace | null> => {
      const wsRes = await fetch('/api/workspaces')
      if (!wsRes.ok) return null
      const { data } = await wsRes.json()
      const list = data as ActiveWorkspace[]
      if (list.length === 0) return null

      // Prefer the workspace named in the URL (match by slug or numeric id).
      if (urlWs) {
        const match = list.find((w) => w.slug === urlWs || String(w.id) === urlWs)
        if (match) return match
      }

      // Otherwise the remembered default.
      const meRes = await fetch('/api/me')
      if (!meRes.ok) return list[0]
      const me = await meRes.json()
      return list.find((w) => w.id === me.active_workspace_id) ?? list[0]
    },
  })
}
