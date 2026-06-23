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

// --- Secondary entities (comments, attachments, project updates) ---
//
// These aren't work items, so their own `id` is a private-domain id that passes
// through unchanged (like user/label ids). But the FK that points BACK at a work
// item must be translated to that work item's #number, never the global serial.
// The caller already knows the parent's #number (it's in the request path), so
// it passes it in rather than us re-querying.

// Comments reference a polymorphic parent (issue/task/project). Expose the
// parent's #number as `parent_id`; drop the legacy internal `issue_id` mirror
// (parent_type + parent_id fully describe the parent).
export function publicComment(input: object, parentSeq: number | null): Row {
  const { issue_id: _legacy, parent_id: _internal, ...rest } = input as Row
  return { ...rest, parent_id: parentSeq ?? null }
}

// Attachments belong to an issue. Expose the issue's #number as `issue_id`.
export function publicAttachment(input: object, issueSeq: number | null): Row {
  const { issue_id: _internal, ...rest } = input as Row
  return { ...rest, issue_id: issueSeq ?? null }
}

// Project updates belong to a project. Expose the project's #number.
export function publicProjectUpdate(input: object, projectSeq: number | null): Row {
  const { project_id: _internal, ...rest } = input as Row
  return { ...rest, project_id: projectSeq ?? null }
}

// Activity events reference a polymorphic entity via (entity_type, entity_id).
// For work items (issue/task/project) `entity_id` must be the #number, not the
// internal serial — resolved via a batch seq map (build it with
// resolveEventEntitySeqs). Purged items aren't in the map, so we fall back to the
// seq snapshotted in `meta` at delete time, else null. Other entity types
// (comment/label/attachment/workspace/member/invitation) keep their own-domain id.
export function publicEvent(input: object, seqMap: Map<string, number>): Row {
  const row = input as Row
  const type = row.entity_type as string
  const eid = row.entity_id as number | null
  if ((type === 'issue' || type === 'task' || type === 'project') && eid != null) {
    const meta = row.meta as { seq?: number } | null
    return { ...row, entity_id: seqMap.get(`${type}:${eid}`) ?? meta?.seq ?? null }
  }
  return row
}
