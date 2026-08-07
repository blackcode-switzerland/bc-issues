// `sales.user_preferences` — one row per (user, workspace).
//
// ---------------------------------------------------------------------------
// EVERYTHING IN THIS TABLE IS A DISPLAY PREFERENCE. NOTHING IN IT IS A RIGHT.
// ---------------------------------------------------------------------------
// `ui_mode` decides what the WEB APP renders (D-7). It is read by React and by
// nothing else: no route in this app calls `getUiMode` to decide whether a write
// is allowed, and none may. Authorisation is `platform.app_access` and the
// workspace role, and it refuses a write the UI allowed exactly as readily as
// one it did not.
//
// The reason that matters is the shape of the mistake it prevents. A toggle that
// looks like a permission, is enforced only in React, and sits on the user's own
// settings page is a control nobody has watched fail and that anybody can turn
// off — the exact pattern CLAUDE.md's standing rule exists for. Three mitigations
// are mandatory (D-7) and this file carries the first: **the default is
// `read_only`**, so the honest behaviour is also the normal one.
//
// ---------------------------------------------------------------------------
// A MISSING ROW IS A DEFAULT, NOT AN ERROR
// ---------------------------------------------------------------------------
// Nothing creates a preferences row at sign-up. `get` answers the defaults for a
// user who has never opened Settings, and `set` upserts. A `notFound` here would
// mean every reader had to handle "you have no preferences", which is not a
// state anybody is in.

import { and, eq } from 'drizzle-orm'
import { getDb } from '../client'
import { userPreferences } from '../schema'
import { UI_MODE_DEFAULT } from '@/lib/pipeline'

export interface Preferences {
  ui_mode: string
  /** Saved listing filters. Opaque to the server — it stores and returns them. */
  default_filters: unknown
  updated_at: string | null
}

const DEFAULTS: Preferences = {
  ui_mode: UI_MODE_DEFAULT,
  default_filters: null,
  updated_at: null,
}

export async function getPreferences(
  workspaceId: number,
  userId: number
): Promise<Preferences> {
  const [row] = await getDb()
    .select()
    .from(userPreferences)
    .where(
      and(eq(userPreferences.workspace_id, workspaceId), eq(userPreferences.user_id, userId))
    )
    .limit(1)
  if (!row) return DEFAULTS
  return {
    ui_mode: row.ui_mode,
    default_filters: row.default_filters ?? null,
    updated_at: row.updated_at?.toISOString() ?? null,
  }
}

/**
 * Upsert the caller's preferences. Only the keys present are changed.
 *
 * **No event is recorded and no entity is projected**, unlike every other write
 * in this app. Both are deliberate: an event is a thing that happened to the
 * PIPELINE, and "Andrea switched her sidebar to full" is not one — putting it in
 * the feed would mean a shared history filling up with other people's display
 * settings. There is nothing to project either: a preference has no #number, no
 * title and no cross-app address, because nothing outside this app could act on
 * one.
 */
export async function setPreferences(
  workspaceId: number,
  userId: number,
  input: { uiMode?: string; defaultFilters?: unknown }
): Promise<Preferences> {
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (input.uiMode !== undefined) patch.ui_mode = input.uiMode
  if (input.defaultFilters !== undefined) patch.default_filters = input.defaultFilters

  await getDb()
    .insert(userPreferences)
    .values({
      workspace_id: workspaceId,
      user_id: userId,
      // An INSERT has to supply a value for a NOT NULL column with no default in
      // the ORM's eyes; the column's own default is the same one. Named from
      // `lib/pipeline.ts` rather than typed, so there is one declaration of what
      // "the default" is and it is the one `bk meta` serves.
      ui_mode: (input.uiMode as string | undefined) ?? UI_MODE_DEFAULT,
      default_filters: (input.defaultFilters ?? null) as never,
    })
    .onConflictDoUpdate({
      target: [userPreferences.user_id, userPreferences.workspace_id],
      set: patch as never,
    })

  return getPreferences(workspaceId, userId)
}
