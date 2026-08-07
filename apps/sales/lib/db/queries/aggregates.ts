// `today`, `pipeline`, `metrics` — the three questions that are arithmetic.
//
// ---------------------------------------------------------------------------
// COMPUTED BY QUERY. THERE IS NO AGGREGATES TABLE, AND THERE MUST NOT BE (D-33)
// ---------------------------------------------------------------------------
// The doctrine forbids the app DECIDING things, not the app READING them, and
// the line is exactly where `docs/backend.md` §1 puts it:
//
//   JUDGEMENT   which product suits this client, which message to lead with.
//               That is `sales.matches`, written by the agent and STORED.
//   ARITHMETIC  `SUM(value) GROUP BY stage`. The same class of thing as counting
//               how many prospects are in a stage, which nobody would store.
//
// Storing an aggregate creates a second number that can disagree with the first,
// and a stale pipeline total is worse than a slow one at a scale where nothing
// is slow. The mockup stores them because a static HTML file has no other
// option; that is a constraint of the artefact, not a design position.
//
// ---------------------------------------------------------------------------
// THE SHAPES ARE NEW, SO THEY ARE STATED HERE RATHER THAN INFERRED
// ---------------------------------------------------------------------------
// §6.1 names the three commands and nothing specifies what they return. Each
// answers ONE question, and the answer is what the mockup's own dashboard shows,
// because that is the shape the stakeholder validated:
//
//   today     what do I owe somebody TODAY, and who am I meeting
//   pipeline  where is the money, by stage
//   metrics   how did the last N days go
//
// None of them takes a vocabulary as a parameter and none of them names a stage
// in its code: the terminal/open split comes from `lib/pipeline.ts`, so adding a
// stage there changes these answers with no second edit.

import { and, asc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../client'
import { communications, meetings, prospects, users } from '../schema'
import { OPEN_STAGES, STAGE_VALUES, TERMINAL_STAGES } from '@/lib/pipeline'

/** A prospect as the Today queue lists it. */
export interface DueAction {
  number: number
  name: string
  stage: string
  action_type: string | null
  due: string | null
  due_label: string | null
  note: string | null
  owner: string | null
  overdue: boolean
}

export interface MeetingSlot {
  number: number
  prospect_number: number
  prospect_name: string
  title: string
  starts_at: string
  type: string
  status: string
}

export interface TodayResult {
  /** The date the answer was computed FOR, so a caller can tell what "today" meant. */
  date: string
  due_actions: DueAction[]
  meetings: MeetingSlot[]
  counts: { due_today: number; overdue: number; meetings_today: number }
}

/**
 * What is owed today.
 *
 * "Due" means `next_action_due <= today` — so an action due last Tuesday and
 * never done is IN this list, flagged `overdue`, rather than quietly rolling out
 * of view the day after it was missed. That is the failure mode a follow-up
 * queue exists to prevent.
 *
 * Terminal stages are excluded: a won or lost deal has no next action, and a
 * stale one left on a closed record would show up here forever.
 */
export async function today(workspaceId: number, now = new Date()): Promise<TodayResult> {
  const db = getDb()
  const dayStart = new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z')
  const dayEnd = new Date(dayStart.getTime() + 86_400_000)
  const todayDate = dayStart.toISOString().slice(0, 10)

  const dueRows = await db
    .select({
      seq: prospects.seq,
      name: prospects.name,
      stage: prospects.stage,
      action_type: prospects.next_action_type,
      due: prospects.next_action_due,
      due_label: prospects.next_action_due_label,
      note: prospects.next_action_note,
      owner_label: prospects.next_action_owner_label,
      owner_name: users.name,
    })
    .from(prospects)
    .leftJoin(users, eq(users.id, prospects.next_action_owner_user_id))
    .where(
      and(
        eq(prospects.workspace_id, workspaceId),
        isNull(prospects.deleted_at),
        sql`${prospects.stage} IN (${sql.join(OPEN_STAGES.map((s) => sql`${s}`), sql`, `)})`,
        sql`${prospects.next_action_due} IS NOT NULL`,
        sql`${prospects.next_action_due} <= ${todayDate}::date`
      )
    )
    .orderBy(asc(prospects.next_action_due), asc(prospects.seq))

  const due_actions: DueAction[] = dueRows.map((r) => ({
    number: r.seq,
    name: r.name,
    stage: r.stage,
    action_type: r.action_type,
    due: r.due,
    due_label: r.due_label,
    note: r.note,
    // The verbatim label wins over the resolved user, same rule as everywhere:
    // "Companion" is not a `platform.users` row and the record says so.
    owner: r.owner_label ?? r.owner_name ?? null,
    overdue: r.due != null && r.due < todayDate,
  }))

  const meetingRows = await db
    .select({
      seq: meetings.seq,
      prospect_number: prospects.seq,
      prospect_name: prospects.name,
      title: meetings.title,
      starts_at: meetings.starts_at,
      type: meetings.type,
      status: meetings.status,
    })
    .from(meetings)
    .innerJoin(prospects, eq(prospects.id, meetings.prospect_id))
    .where(
      and(
        eq(meetings.workspace_id, workspaceId),
        isNull(meetings.deleted_at),
        gte(meetings.starts_at, dayStart),
        lte(meetings.starts_at, dayEnd)
      )
    )
    .orderBy(asc(meetings.starts_at))

  return {
    date: todayDate,
    due_actions,
    meetings: meetingRows.map((m) => ({
      number: m.seq,
      prospect_number: m.prospect_number,
      prospect_name: m.prospect_name,
      title: m.title,
      starts_at: m.starts_at.toISOString(),
      type: m.type,
      status: m.status,
    })),
    counts: {
      due_today: due_actions.filter((a) => !a.overdue).length,
      overdue: due_actions.filter((a) => a.overdue).length,
      meetings_today: meetingRows.length,
    },
  }
}

export interface StageBucket {
  stage: string
  count: number
  /** A decimal string, never a float — see `lib/views.ts`. */
  value: string
  currency: string
}

export interface PipelineResult {
  stages: StageBucket[]
  open: { count: number; value: string }
  won: { count: number; value: string }
  lost: { count: number; value: string }
  currency: string
}

/**
 * Where the money is, by stage.
 *
 * EVERY stage appears, including the empty ones, and in pipeline order. A funnel
 * that silently omits the stage nobody is in is a funnel that hides the thing
 * worth noticing.
 *
 * Currency: reported as the majority currency across the workspace rather than
 * summed blindly across mixed ones. Everything is CHF today, and a total that
 * added francs to euros without saying so is the kind of wrong that looks right.
 */
export async function pipeline(workspaceId: number): Promise<PipelineResult> {
  const db = getDb()
  const res = await db.execute(sql`
    SELECT stage,
           count(*)::int                     AS count,
           coalesce(sum(value), 0)::text     AS value,
           mode() WITHIN GROUP (ORDER BY currency) AS currency
    FROM sales.prospects
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    GROUP BY stage`)

  const byStage = new Map<string, { count: number; value: string; currency: string }>()
  for (const r of res.rows) {
    byStage.set(String(r.stage), {
      count: Number(r.count),
      value: String(r.value),
      currency: String(r.currency ?? 'CHF'),
    })
  }

  const stages: StageBucket[] = STAGE_VALUES.map((s) => ({
    stage: s,
    count: byStage.get(s)?.count ?? 0,
    value: byStage.get(s)?.value ?? '0',
    currency: byStage.get(s)?.currency ?? 'CHF',
  }))

  const sum = (want: readonly string[]) =>
    stages
      .filter((s) => want.includes(s.stage))
      .reduce(
        (acc, s) => ({ count: acc.count + s.count, value: acc.value + Number(s.value) }),
        { count: 0, value: 0 }
      )

  const open = sum(OPEN_STAGES)
  const won = sum(['won'].filter((s) => TERMINAL_STAGES.includes(s)))
  const lost = sum(['lost'].filter((s) => TERMINAL_STAGES.includes(s)))
  const currency = stages.find((s) => s.count > 0)?.currency ?? 'CHF'

  return {
    stages,
    open: { count: open.count, value: open.value.toFixed(2) },
    won: { count: won.count, value: won.value.toFixed(2) },
    lost: { count: lost.count, value: lost.value.toFixed(2) },
    currency,
  }
}

export interface MetricsResult {
  period_days: number
  from: string
  to: string
  closed: {
    won: { count: number; value: string }
    lost: { count: number; value: string }
    /** Won / (won + lost), as a percentage with one decimal. Null when nothing closed. */
    win_rate: string | null
    /** Mean value of a won deal. Null when none were won. */
    average_won: string | null
  }
  created: { count: number; value: string }
  activity: { communications: number; meetings: number }
  currency: string
}

/**
 * How the last N days went.
 *
 * `win_rate` is null rather than 0 when nothing closed, and the distinction is
 * the reason it is a nullable string: "we closed nothing" and "we lost
 * everything" are not the same month, and a 0% that means the first is a number
 * somebody will act on.
 */
export async function metrics(workspaceId: number, periodDays: number, now = new Date()): Promise<MetricsResult> {
  const db = getDb()
  const to = now
  const from = new Date(now.getTime() - periodDays * 86_400_000)

  const closedRes = await db.execute(sql`
    SELECT stage, count(*)::int AS count, coalesce(sum(value), 0)::text AS value
    FROM sales.prospects
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
      AND closed_at IS NOT NULL AND closed_at >= ${from} AND closed_at <= ${to}
    GROUP BY stage`)
  const closedBy = new Map<string, { count: number; value: number }>()
  for (const r of closedRes.rows) {
    closedBy.set(String(r.stage), { count: Number(r.count), value: Number(r.value) })
  }
  const won = closedBy.get('won') ?? { count: 0, value: 0 }
  const lost = closedBy.get('lost') ?? { count: 0, value: 0 }
  const decided = won.count + lost.count

  const createdRes = await db.execute(sql`
    SELECT count(*)::int AS count, coalesce(sum(value), 0)::text AS value
    FROM sales.prospects
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
      AND created_at >= ${from} AND created_at <= ${to}`)
  const created = createdRes.rows[0] ?? { count: 0, value: '0' }

  const commCount = await countInPeriod(communications, 'occurred_at', workspaceId, from, to)
  const meetCount = await countInPeriod(meetings, 'starts_at', workspaceId, from, to)

  const currencyRes = await db.execute(sql`
    SELECT mode() WITHIN GROUP (ORDER BY currency) AS currency
    FROM sales.prospects WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL`)

  return {
    period_days: periodDays,
    from: from.toISOString(),
    to: to.toISOString(),
    closed: {
      won: { count: won.count, value: won.value.toFixed(2) },
      lost: { count: lost.count, value: lost.value.toFixed(2) },
      win_rate: decided === 0 ? null : ((won.count / decided) * 100).toFixed(1),
      average_won: won.count === 0 ? null : (won.value / won.count).toFixed(2),
    },
    created: { count: Number(created.count), value: Number(created.value).toFixed(2) },
    activity: { communications: commCount, meetings: meetCount },
    currency: String(currencyRes.rows[0]?.currency ?? 'CHF'),
  }
}

async function countInPeriod(
  table: typeof communications | typeof meetings,
  column: 'occurred_at' | 'starts_at',
  workspaceId: number,
  from: Date,
  to: Date
): Promise<number> {
  const db = getDb()
  const col = column === 'occurred_at' ? communications.occurred_at : meetings.starts_at
  const where: SQL[] = [
    eq(table.workspace_id, workspaceId),
    isNull(table.deleted_at),
    gte(col, from),
    lte(col, to),
  ]
  const res = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(and(...where))
  return Number(res[0]?.n ?? 0)
}
