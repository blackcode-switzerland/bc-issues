'use client'

import { useQuery } from '@tanstack/react-query'

export interface ActiveWorkspace {
  id: number
  name: string
  slug: string
  key: string
  member_role: 'owner' | 'member'
}

export function useActiveWorkspace() {
  return useQuery({
    queryKey: ['active-workspace'],
    queryFn: async (): Promise<ActiveWorkspace | null> => {
      const meRes = await fetch('/api/me')
      if (!meRes.ok) return null
      const me = await meRes.json()
      if (!me.active_workspace_id) return null
      const wsRes = await fetch('/api/me/workspaces')
      if (!wsRes.ok) return null
      const { data } = await wsRes.json()
      return (data as ActiveWorkspace[]).find((w) => w.id === me.active_workspace_id) ?? null
    },
  })
}
