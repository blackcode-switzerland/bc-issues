'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ProjectIcon } from '../project-icon'
import { PriorityIcon, StatusIcon, projectPriorityKey } from '@/components/ui/work-item-icons'
import { PROJECT_STATUSES } from '@/lib/work-items'

interface ProjectRow {
  id: number
  name: string
  status: string
  color: string | null
  icon: string | null
  priority: string | null
  issue_count: number
  open_issues: number
}

const COLUMNS = PROJECT_STATUSES.map((s) => ({ status: s.value, label: s.label, color: s.color }))

export function ProjectsKanban({
  projects,
  wsSlug,
}: {
  projects: ProjectRow[]
  wsSlug: string
}) {
  const queryClient = useQueryClient()
  const [board, setBoard] = useState<Record<string, ProjectRow[]>>(() => group(projects))

  useEffect(() => {
    setBoard(group(projects))
  }, [projects])

  const update = useMutation({
    mutationFn: async (input: { id: number; status: string }) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/projects/${input.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: input.status }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] }),
    onError: () => {
      toast.error('Status change failed — reverting')
      setBoard(group(projects))
    },
  })

  function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const fromCol = result.source.droppableId
    const toCol = result.destination.droppableId
    if (fromCol === toCol && result.source.index === result.destination.index) return
    const projectId = parseInt(result.draggableId)
    const card = board[fromCol].find((c) => c.id === projectId)
    if (!card) return

    const next: Record<string, ProjectRow[]> = {}
    for (const k of Object.keys(board)) next[k] = [...board[k]]
    next[fromCol] = next[fromCol].filter((c) => c.id !== projectId)
    next[toCol] = [
      ...next[toCol].slice(0, result.destination.index),
      { ...card, status: toCol },
      ...next[toCol].slice(result.destination.index),
    ]
    setBoard(next)
    if (fromCol !== toCol) update.mutate({ id: projectId, status: toCol })
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((col) => {
          const items = board[col.status] ?? []
          return (
            <div key={col.status} className="flex w-72 shrink-0 flex-col">
              <header className="mb-2 flex items-center gap-2 px-1">
                <StatusIcon status={col.status} size={14} className="shrink-0" />
                <span className="flex-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {col.label}
                </span>
                <span className="rounded-full bg-secondary px-1.5 text-[10px] tabular-nums text-muted-foreground">
                  {items.length}
                </span>
              </header>
              <Droppable droppableId={col.status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex min-h-[200px] flex-col gap-2 rounded-lg border border-border p-2 transition-colors ${
                      snapshot.isDraggingOver ? 'bg-primary/5' : ''
                    }`}
                  >
                    {items.map((p, idx) => {
                      const total = p.issue_count ?? 0
                      const done = total - (p.open_issues ?? 0)
                      const pct = total > 0 ? Math.round((done / total) * 100) : 0
                      return (
                        <Draggable key={p.id} draggableId={String(p.id)} index={idx}>
                          {(prov, snap) => (
                            <Link
                              href={`/dashboard/${p.id}`}
                              ref={prov.innerRef as unknown as React.Ref<HTMLAnchorElement>}
                              {...prov.draggableProps}
                              {...prov.dragHandleProps}
                              prefetch={false}
                              className={`block rounded-md border border-border bg-card p-2.5 shadow-sm transition-shadow ${
                                snap.isDragging ? 'shadow-lg ring-1 ring-primary' : 'hover:bg-card/80'
                              }`}
                            >
                              <div className="mb-1.5 flex items-center gap-2">
                                <ProjectIcon icon={p.icon} color={p.color} name={p.name} size={18} />
                                <span className="flex-1 truncate text-[13px] font-medium">{p.name}</span>
                              </div>
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <PriorityIcon priority={projectPriorityKey(p.priority)} />
                                <span className="ml-auto tabular-nums">
                                  {done}/{total} · {pct}%
                                </span>
                              </div>
                              <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-secondary">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                              </div>
                            </Link>
                          )}
                        </Draggable>
                      )
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          )
        })}
      </div>
    </DragDropContext>
  )
}

function group(projects: ProjectRow[]): Record<string, ProjectRow[]> {
  const board: Record<string, ProjectRow[]> = {}
  for (const c of COLUMNS) board[c.status] = []
  for (const p of projects) {
    if (board[p.status]) board[p.status].push(p)
    else board[COLUMNS[0].status].push(p)
  }
  return board
}
