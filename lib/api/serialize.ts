// Public serialization for the three work-item entities.
//
// Contract: the only id anyone outside the DB ever sees is the workspace-scoped
// number (`seq`). We expose it as `id`. The global serial primary key is never
// emitted, and cross-entity references (project_id, task_id) are translated to
// the referenced entity's workspace number too. User ids, label ids, comment
// ids, etc. are a different domain and pass through unchanged.

type Row = Record<string, unknown>

// Strip the global id + the raw seq fields, expose seq as `id`.
function base(row: Row): Row {
  const { id: _globalId, seq, ...rest } = row
  return { id: seq ?? null, ...rest }
}

export function publicProject(input: object): Row {
  // Projects have no parent work-item FK; owner_id is a user id (unchanged).
  return base(input as Row)
}

export function publicTask(input: object): Row {
  const { project_seq, project_id: _g, ...rest } = base(input as Row) as Row & {
    project_seq?: number | null
  }
  return { ...rest, project_id: project_seq ?? null }
}

export function publicIssue(input: object): Row {
  const {
    project_seq,
    task_seq,
    project_id: _gp,
    task_id: _gt,
    ...rest
  } = base(input as Row) as Row & { project_seq?: number | null; task_seq?: number | null }
  return { ...rest, project_id: project_seq ?? null, task_id: task_seq ?? null }
}
