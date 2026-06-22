'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { DetailPageSkeleton } from '@/components/ui/motion'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { IssueDetailView } from './issue-detail-view'
import { ProjectDetailView } from './project-detail-view'
import { TaskDetailView } from './task-detail-view'

type EntityType = 'issue' | 'task' | 'project'

interface Located {
  workspace_id: number
  workspace_slug: string
}

/**
 * Wraps the issue/task/project detail pages. Detail URLs carry only the
 * globally-unique entity id (e.g. /dashboard/issues/30), so a link shared
 * across workspaces resolves here:
 *   - member of the entity's workspace → render it, and auto-switch the active
 *     workspace so the surrounding chrome (sidebar, back-links) matches;
 *   - not a member / entity gone → restore the user's own workspace context
 *     (do nothing) and show an error toast, then bounce to the dashboard.
 */
export function EntityResolver({ type, id }: { type: EntityType; id: number }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const activeWsQuery = useActiveWorkspace()
  const activeWs = activeWsQuery.data
  const switchedRef = useRef(false)

  const located = useQuery({
    queryKey: ['locate', type, id],
    retry: false,
    queryFn: async (): Promise<Located> => {
      const res = await fetch(`/api/me/locate?type=${type}&id=${id}`)
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
  })

  // No access (404/403) or entity deleted → bounce home, keep their own workspace.
  useEffect(() => {
    if (!located.isError) return
    toast.error(`You don't have access to this ${type}, or it no longer exists.`)
    router.replace('/dashboard')
  }, [located.isError, type, router])

  // Member, but the entity lives in another workspace → switch active workspace.
  useEffect(() => {
    const target = located.data
    if (!target || switchedRef.current || activeWsQuery.isLoading) return
    if (activeWs && activeWs.id === target.workspace_id) return
    switchedRef.current = true
    fetch('/api/me/active-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: target.workspace_id }),
    })
      .then((r) => {
        if (!r.ok) return
        // ['me'] drives the sidebar workspace switcher; ['active-workspace']
        // drives the rest. Refresh both so the chrome reflects the new context.
        queryClient.invalidateQueries({ queryKey: ['me'] })
        queryClient.invalidateQueries({ queryKey: ['active-workspace'] })
        queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
      })
      .catch(() => {})
  }, [located.data, activeWs, activeWsQuery.isLoading, queryClient])

  if (located.isLoading || located.isError || !located.data) {
    return <DetailPageSkeleton />
  }

  const slug = located.data.workspace_slug
  if (type === 'issue') return <IssueDetailView issueId={id} workspaceSlug={slug} />
  if (type === 'task') return <TaskDetailView taskId={id} workspaceSlug={slug} />
  return <ProjectDetailView projectId={id} workspaceSlug={slug} />
}
