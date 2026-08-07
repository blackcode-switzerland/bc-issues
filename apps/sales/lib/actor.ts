// Who did this, and what to write in the `_label` column beside the FK.
//
// ---------------------------------------------------------------------------
// WHY THIS APP NEEDS IT AND `apps/issues` DOES NOT
// ---------------------------------------------------------------------------
// `docs/backend.md` §3.4: four sales tables carry a user FK **and** a free-text
// label — `stage_entries.actor_*`, `communications.logged_by_*`,
// `prospects.next_action_owner_*`, `documents.added_by_*`. The reason is that
// "Companion" is an AGENT, not a `platform.users` row, and the mockup's "by
// Andrea / by Companion" attribution is a validated feature: agent-written
// history has to stay visibly agent-written.
//
// The FK is who owns the credential. The label is who was at the keyboard, and
// for an agent that is the TOKEN'S NAME — the string a human typed into
// `bk token create --name Companion`.
//
// ---------------------------------------------------------------------------
// HOW THE TOKEN IS IDENTIFIED, AND THE ONE THING THIS IS NOT
// ---------------------------------------------------------------------------
// **This is attribution, never authentication.** The request has already been
// authenticated by `AppContext.resolveUser` → `verifyToken`, which does the
// constant-time hash comparison and the expiry check. By the time this runs we
// KNOW which user is calling; the only open question is which of that user's
// tokens they used, so that the row can be labelled.
//
// So the lookup matches `platform.api_tokens.token_prefix` — the first eight
// characters of the secret, stored in clear precisely so a token can be
// recognised without being verified — and it is scoped to the authenticated
// user's own tokens. Two consequences worth stating plainly:
//
//   - It re-hashes nothing. A second implementation of credential verification
//     is two chances to get constant-time comparison wrong
//     (`packages/platform-auth/src/tokens.ts` header), and this file must not be
//     the second one.
//   - A prefix collision between two of ONE user's tokens would mislabel a row.
//     That is 1 in 64^8 within one user's token list, and the failure is a wrong
//     name in a history entry — not a wrong identity, because the identity was
//     settled before this function was called.
//
// ---------------------------------------------------------------------------
// THE PROPER FIX IS UPSTREAM, AND IT IS NOT THIS PHASE'S TO MAKE
// ---------------------------------------------------------------------------
// `AppContext.resolveUser` returns a `User` and drops the credential that proved
// it. If it returned "who, and by what means", this file would be four lines and
// `platform.events.actor_token_id` — a column both apps have and neither fills —
// would start carrying data everywhere. That is a `packages/platform-api` change
// and Phase 1 is closed; it is logged for the master rather than done here.

// NOTE FOR THE READER LOOKING FOR IT: there is no sha256 in this file, on
// purpose. See "HOW THE TOKEN IS IDENTIFIED" above.
import type { NextRequest } from 'next/server'
import { sql } from 'drizzle-orm'
import type { Executor, User } from '@blackcode/platform-db'
import { apiTokens } from './db/schema'

/** Matches `TOKEN_PREFIX` / `PREFIX_VISIBLE_LEN` in platform-auth's tokens.ts. */
const BEARER_TOKEN_PREFIX = 'bk_live_'
const PREFIX_VISIBLE_LEN = 8

export interface Actor {
  /** The authenticated user. Always set — every write path is behind auth. */
  userId: number
  /**
   * The API token this request arrived on, or null for a browser session.
   * Written to `platform.events.actor_token_id`.
   */
  tokenId: number | null
  /**
   * What to put in a `_label` column: the token's name for an agent, the user's
   * name (falling back to their email) for a person. Never empty.
   */
  label: string
}

/**
 * Resolve the actor for a request whose user has already been authenticated.
 *
 * Never throws and never returns null: attribution failing must not fail the
 * write it is attributing. The worst case is a label that says the user's name
 * where it could have said the token's.
 */
export async function resolveActor(
  db: Executor,
  req: NextRequest,
  user: User
): Promise<Actor> {
  const fallback: Actor = {
    userId: user.id,
    tokenId: null,
    label: (user.name ?? '').trim() || user.email,
  }

  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return fallback
  const plaintext = header.slice('Bearer '.length).trim()
  if (!plaintext.startsWith(BEARER_TOKEN_PREFIX)) return fallback

  const prefix = plaintext
    .slice(BEARER_TOKEN_PREFIX.length, BEARER_TOKEN_PREFIX.length + PREFIX_VISIBLE_LEN)
  if (prefix.length < PREFIX_VISIBLE_LEN) return fallback

  try {
    const res = await db.execute(sql`
      SELECT id, name FROM ${apiTokens}
      WHERE user_id = ${user.id} AND token_prefix = ${prefix}
      LIMIT 2
    `)
    // Exactly one, or we do not know which. Two rows means a prefix collision
    // inside one user's tokens, and guessing between them would put a name on a
    // history row that nobody can trust — the fallback is honest instead.
    if (res.rows.length !== 1) return fallback
    const row = res.rows[0]!
    const name = String(row.name ?? '').trim()
    return {
      userId: user.id,
      tokenId: Number(row.id),
      label: name || fallback.label,
    }
  } catch {
    return fallback
  }
}
