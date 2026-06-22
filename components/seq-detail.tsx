'use client'

import { useQuery } from '@tanstack/react-query'
import { DetailPageSkeleton } from '@/components/ui/motion'
import { IssueDetailView } from './issue-detail-view'
import { ProjectDetailView } from './project-detail-view'
import { TaskDetailView } from './task-detail-view'

type EntityType = 'issue' | 'task' | 'project'

const BACK: Record<EntityType, { href: (ws: string) => string; label: string }> = {
  issue: { href: (ws) => `/dashboard/${ws}/issues`, label: 'issues' },
  task: { href: (ws) => `/dashboard/${ws}/tasks`, label: 'tasks' },
  project: { href: (ws) => `/dashboard/${ws}`, label: 'projects' },
}

/**
 * Detail-page entry point for workspace-scoped URLs
 * (/dashboard/{ws}/{type}/{seq}). Resolves the workspace-scoped #number (seq)
 * to the global id the detail views fetch by, then renders the right view.
 * Membership + the active-workspace switch are handled by the {ws} layout, so
 * this only deals with seq → id.
 */
export function SeqDetail({ ws, type, seq }: { ws: string; type: EntityType; seq: number }) {
  const resolved = useQuery({
    queryKey: ['resolve-seq', ws, type, seq],
    retry: false,
    queryFn: async (): Promise<{ id: number }> => {
      const res = await fetch(`/api/workspaces/${ws}/resolve?type=${type}&seq=${seq}`)
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
  })

  if (resolved.isLoading) return <DetailPageSkeleton />

  if (resolved.isError || !resolved.data) {
    const back = BACK[type]
    return (
      <div className="p-8">
        <a href={back.href(ws)} className="text-xs text-muted-foreground hover:underline">
          ← Back to {back.label}
        </a>
        <p className="mt-4 text-sm capitalize">{type} not found.</p>
      </div>
    )
  }

  const id = resolved.data.id
  if (type === 'issue') return <IssueDetailView issueId={id} workspaceSlug={ws} />
  if (type === 'task') return <TaskDetailView taskId={id} workspaceSlug={ws} />
  return <ProjectDetailView projectId={id} workspaceSlug={ws} />
}
