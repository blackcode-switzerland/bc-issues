'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

// Remembers the workspace you're viewing as your default (used for bare
// /dashboard and the next login). Mounted by the {ws} layout. The chrome itself
// reads the workspace from the URL via useActiveWorkspace, so this is purely
// about persistence — no visual dependency on it completing.
export function PersistActiveWorkspace({ workspaceId }: { workspaceId: number }) {
  const queryClient = useQueryClient()
  const lastRef = useRef<number | null>(null)

  useEffect(() => {
    if (lastRef.current === workspaceId) return
    lastRef.current = workspaceId
    fetch('/api/me/active-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    })
      .then((r) => {
        if (!r.ok) return
        queryClient.invalidateQueries({ queryKey: ['me'] })
        queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
      })
      .catch(() => {})
  }, [workspaceId, queryClient])

  return null
}
