// The public shape of each entity — what a route serves and what `bk` parses.
//
// It lives in one file rather than beside each route because two routes serve
// the same entity (`…/prospects` and `…/prospects/{n}`), and a shape defined
// twice is a shape that drifts once. The scaffold puts its `publicNote` in the
// route file; that works with one route per entity and stops working at two.
//
// ---------------------------------------------------------------------------
// THREE RULES, ALL INHERITED
// ---------------------------------------------------------------------------
// 1. **`number`, never `id`.** The workspace #number is the address. Once a
//    serial id reaches an agent it ends up in a script, and then it is a
//    contract nobody agreed to.
//
// 2. **The wire stays bare** (D-29). No app-qualified values, no `sales:`
//    prefixes on a type: the route is already scoped to one app by its path, so
//    the segment adds nothing a caller could act on.
//
// 3. **No rendering.** `value` goes out as the raw numeric string and `CHF` as a
//    separate field; `next_action.due` is an ISO date and `due_label` is the
//    phrase the agent wrote. Swiss formatting (`CHF 105'000`) and "2 days ago"
//    are things the WEB does with these — §5.1: a relative string is a
//    rendering, never storage, and by the same argument never a wire format.

import type { LinkRow } from '@blackcode/platform-db'
import type { ProspectLabel, ProspectRow } from './db/queries/prospects'
import { entityUrnOrNull } from './entity-address'

export interface PublicProspect {
  number: number
  name: string
  city: string | null
  sector: string | null
  stage: string
  value: string | null
  currency: string
  owner: { id: number; name: string | null; email: string } | null
  source: string | null
  summary: string | null
  next_action: {
    type: string | null
    due: string | null
    due_label: string | null
    note: string | null
    owner: string | null
  }
  closed_at: string | null
  closed_reason: string | null
  labels: ProspectLabel[]
  /** `bc:sales:{ws}/prospect/{n}` — how another app addresses this row. */
  urn: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function publicProspect(row: ProspectRow, workspaceSlug: string): PublicProspect {
  return {
    number: row.seq,
    name: row.name,
    city: row.city,
    sector: row.sector,
    stage: row.stage,
    value: row.value,
    currency: row.currency,
    owner:
      row.owner && row.owner.id != null && row.owner.email != null
        ? { id: row.owner.id, name: row.owner.name, email: row.owner.email }
        : null,
    source: row.source,
    summary: row.summary,
    next_action: {
      type: row.next_action_type,
      // `next_action_due` is a Postgres `date`, which the driver hands back as
      // 'YYYY-MM-DD'. Left exactly as it is: turning it into a Date here would
      // make it a timestamp at midnight UTC, and a due date is not an instant.
      due: row.next_action_due,
      due_label: row.next_action_due_label,
      note: row.next_action_note,
      owner: row.next_action_owner_label,
    },
    closed_at: iso(row.closed_at),
    closed_reason: row.closed_reason,
    labels: row.labels,
    urn: entityUrnOrNull(workspaceSlug, 'prospect', row.seq),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
    deleted_at: iso(row.deleted_at),
  }
}

/**
 * A cross-app link, as `bk sales prospect show` prints it (D-18).
 *
 * The far end is already resolved by `listLinks`, so this is a projection of its
 * row rather than a second query. `url` is absolute — built by platform-db from
 * the other app's registered `base_url` — which is the whole point: a link an
 * agent cannot follow to the other deployment is a link that only exists in the
 * database.
 */
export interface PublicLink {
  direction: 'out' | 'in'
  rel: string
  urn: string
  app: string
  entity_type: string
  number: number
  title: string
  url: string | null
  deleted: boolean
}

export function publicLink(l: LinkRow): PublicLink {
  return {
    direction: l.direction,
    rel: l.rel,
    urn: l.other_urn,
    app: l.other_app,
    entity_type: l.other_entity_type,
    number: l.other_number,
    title: l.other_title,
    url: l.other_url,
    deleted: l.other_deleted,
  }
}

function iso(v: Date | string | null | undefined): string | null {
  if (v == null) return null
  return v instanceof Date ? v.toISOString() : String(v)
}
