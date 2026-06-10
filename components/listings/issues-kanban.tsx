'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ISSUE_STATUSES } from '@/lib/work-items'
import { StatusIcon, PriorityIcon, issuePriorityKey } from '@/components/ui/work-item-icons'
import { MemberAvatar } from '@/components/ui/member-avatar'

interface IssueRow {
  id: number
  seq: number | null
  title: string
  status: string
  priority: number
  assignee_id: number | null
  assignee_name: string | null
}

const COLUMNS = ISSUE_STATUSES.map((s) => ({ status: s.value, label: s.label }))

export function IssuesKanban({
  issues,
  workspaceKey,
}: {
  issues: IssueRow[]
  workspaceKey: string
}) {
  const queryClient = useQueryClient()
  const [board, setBoard] = useState<Record<string, IssueRow[]>>(() => groupByStatus(issues))

  // Re-sync board when source data changes.
  useEffect(() => {
    setBoard(groupByStatus(issues))
  }, [issues])

  const update = useMutation({
    mutationFn: async (input: { id: number; status: string }) => {
      const res = await fetch(`/api/issues/${input.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: input.status }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
    },
    onError: () => {
      toast.error('Status change failed — reverting')
      setBoard(groupByStatus(issues))
    },
  })

  function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const fromCol = result.source.droppableId
    const toCol = result.destination.droppableId
    if (fromCol === toCol && result.source.index === result.destination.index) return

    const issueId = parseInt(result.draggableId)
    const card = board[fromCol].find((c) => c.id === issueId)
    if (!card) return

    // Optimistic move
    const next: Record<string, IssueRow[]> = {}
    for (const k of Object.keys(board)) next[k] = [...board[k]]
    next[fromCol] = next[fromCol].filter((c) => c.id !== issueId)
    next[toCol] = [
      ...next[toCol].slice(0, result.destination.index),
      { ...card, status: toCol },
      ...next[toCol].slice(result.destination.index),
    ]
    setBoard(next)

    if (fromCol !== toCol) {
      update.mutate({ id: issueId, status: toCol })
    }
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((col) => {
          const items = board[col.status] ?? []
          return (
            <div key={col.status} className="flex w-64 shrink-0 flex-col">
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
                    {items.map((issue, idx) => (
                      <Draggable key={issue.id} draggableId={String(issue.id)} index={idx}>
                        {(p, s) => (
                          <Link
                            href={`/dashboard/issues/${issue.id}`}
                            ref={p.innerRef as unknown as React.Ref<HTMLAnchorElement>}
                            {...p.draggableProps}
                            {...p.dragHandleProps}
                            prefetch={false}
                            className={`block rounded-md border border-border bg-card p-2.5 text-sm shadow-sm transition-shadow ${
                              s.isDragging ? 'shadow-lg ring-1 ring-primary' : 'hover:bg-card/80'
                            }`}
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                {issue.seq != null ? `${workspaceKey}-${issue.seq}` : `#${issue.id}`}
                              </span>
                              {issue.assignee_name ? (
                                <MemberAvatar name={issue.assignee_name} size={16} />
                              ) : null}
                            </div>
                            <p className="line-clamp-2 text-[13px] font-medium">{issue.title}</p>
                            <div className="mt-2 flex items-center gap-1.5">
                              <PriorityIcon priority={issuePriorityKey(issue.priority)} size={14} />
                            </div>
                          </Link>
                        )}
                      </Draggable>
                    ))}
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

function groupByStatus(issues: IssueRow[]): Record<string, IssueRow[]> {
  const board: Record<string, IssueRow[]> = {}
  for (const c of COLUMNS) board[c.status] = []
  for (const i of issues) {
    if (board[i.status]) board[i.status].push(i)
    else board[COLUMNS[0].status].push(i) // fallback for unknown statuses
  }
  return board
}

