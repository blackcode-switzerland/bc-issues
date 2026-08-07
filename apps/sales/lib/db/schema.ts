// The sales app's database schema: the shared platform tables plus its own.
//
// Derived from `bsales-mockup/assets/js/data.js` by way of
// `docs/sales-app-plan.md` §5. Where the two disagree the mockup wins — it is
// the older and more specific source — and every such departure is recorded in
// `apps/sales/docs/backend.md` with its reason.
//
// ---------------------------------------------------------------------------
// THE BOUNDARY RULE
// ---------------------------------------------------------------------------
// This app's tables live in ITS OWN Postgres schema and it may not read or write
// another app's. That is enforced by grants, not by review: `sales_app` has no
// SELECT on `issues.*`. See docs/platform-architecture.md §4.3 and
// docs/sql/app-role.sql. `lib/app-isolation.test.ts` catches it before a shared
// local credential lets it work by accident.
//
// Deciding where a new table goes is one question: "would a SECOND app need this
// unchanged?" Yes → `packages/platform-db`. No → here. Deals, prospects and
// objections are as app-specific as a table gets.
//
// ---------------------------------------------------------------------------
// FOUR CONVENTIONS, ALL INHERITED, NONE NEGOTIABLE (§5.1)
// ---------------------------------------------------------------------------
//  1. Every addressable row has a workspace-scoped `seq` — the #number. **The
//     serial `id` is never exposed**: not in a route, not in CLI output, not in
//     a URL. `apps/issues` learned that the hard way; `bk trash` printed row ids
//     until Phase 8.
//  2. `seq` is allocated from `sales.counters` INSIDE the insert's transaction.
//     Never read-then-write. See the counters table below.
//  3. Soft delete via `deleted_at`; hard delete only through trash purge. A
//     binned row is restorable, so **its files are still in use** — which is why
//     the blob-reference triggers deliberately do not fire on a soft delete.
//  4. Money is `numeric(14,2)` + `currency char(3)`. Swiss formatting
//     (`CHF 105'000`) lives in one helper, `lib/format.ts`, and nowhere else.
//
// ---------------------------------------------------------------------------
// EVERY WRITE PATH OWES THREE THINGS, IN ONE TRANSACTION
// ---------------------------------------------------------------------------
//     db.transaction(async (tx) => {
//       const seq = await allocateSeq(tx, workspaceId, 'prospect')
//       const [row] = await tx.insert(prospects).values({ …, seq }).returning()
//       await recordEvent(tx, …)        // platform.events — D-6, no sales.activity
//       await projectEntity(tx, …)      // platform.entities — same tx, not after
//     })
//
// A projection written outside the transaction commits even when the source
// write rolls back, and the result is an entities row for a prospect that does
// not exist: `bk search` returns a title, the link resolves, and nothing looks
// wrong until somebody clicks through to a 404 weeks later.
//
// ---------------------------------------------------------------------------
// THE COLUMNS THAT CAN HOLD AN UPLOADED FILE URL — READ BEFORE ADDING ONE
// ---------------------------------------------------------------------------
// Every column below marked `BLOB-REF` needs a `platform.blob_refs_sync` trigger
// in migration 0002, and **a new one added later needs its trigger in the same
// migration**. The index is trigger-maintained precisely so that no write path
// can forget it — which concentrates the entire remaining risk on adding a
// content column without a trigger. Nothing will remind you.
//
// The rule for deciding: a column needs a trigger if a legitimate write can put
// an uploaded-file URL in it — authored prose (`scan` mode) or a column that IS
// a URL (`exact` mode). The asymmetry decides the borderline cases: a trigger on
// a column that never holds a URL costs one no-op function call per write, and a
// missing trigger costs a file somebody was still using, with no undo.
//
// Read `packages/platform-storage/src/references.ts` and
// `packages/platform-db/src/schema.ts` at `blobReferences` before touching
// anything near this.
//
// **Every table carrying a BLOB-REF column also carries `workspace_id`, even
// when it is reachable through its parent.** That is not denormalisation for
// convenience: `platform.blob_references.workspace_id` is copied from the source
// row by the trigger, and the Storage page, `bk storage list` and
// `bk super-admin blob-drift` all work one workspace at a time. `apps/issues`
// shipped `attachments.workspace_id` NULL on every row and had to repair 24
// invisible references inside migration 0037 — a clean report over a hole.

import { sql } from 'drizzle-orm'
import {
  boolean,
  char,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { labels, users, workspaces } from '@blackcode/platform-db'

/** This app's Postgres schema. Named for the app slug — see lib/app.ts. */
export const salesSchema = pgSchema('sales')

// Re-export the platform tables so `@/lib/db/schema` is the single import site
// for the whole schema, exactly as it is in apps/issues.
export * from '@blackcode/platform-db/schema'

// ---------------------------------------------------------------------------
// FULL-TEXT SEARCH (D-9)
// ---------------------------------------------------------------------------
// `bk search` (cross-app, bare) reads `platform.entities`, which holds titles
// only. `bk sales search` (app-owned) has to reach INSIDE records — a phrase in
// a call summary, a name in an attendee list — so each searchable table carries
// a GENERATED tsvector column with a GIN index, unioned by one query helper.
//
// ── TWO THINGS THAT ARE EASY TO GET WRONG, BOTH VERIFIED AGAINST PG 16 ──────
//
// 1. **The regconfig argument is not optional.** `to_tsvector(x)` — one
//    argument — resolves the configuration from `default_text_search_config`
//    and is therefore STABLE, and Postgres rejects it in a generated column.
//    `to_tsvector('simple', x)` is IMMUTABLE. Confirmed by `provolatile` in
//    `pg_proc`: the same function name carries both.
//
// 2. **`array_to_string` is STABLE, so a `text[]` cannot be inlined here.** Nor
//    can `arr::text` — both go through element output functions. `CREATE TABLE`
//    fails with "generation expression is not immutable". Migration 0001 defines
//    `sales.words(text[])`, an IMMUTABLE wrapper, and the generated columns call
//    that. It is honest rather than a volatility lie: the wrapped call is
//    `array_to_string(text[], ' ')`, whose element output function is `textout`,
//    which genuinely is immutable.
//
// ── WHY `'simple'` AND NOT `'english'` ──────────────────────────────────────
// Stemming actively hurts this corpus. The highest-value queries are proper
// nouns — company names, people, product names — and `english` turns "Roches"
// into "roch" and drops one-letter tokens as stopwords. The data is Swiss and
// full of French names however English-only the UI is (§2). `simple` keeps the
// vector's contents predictable, which matters more here than usual because an
// AGENT constructs the queries: prefix matching (`to_tsquery('simple', 'x:*')`)
// covers the shipped/shipping case well enough, and it behaves the same for the
// agent as for the human reading the same page.
//
// Weights: `A` = identity (name, title, subject), `B` = body and everything
// else. Ranking only; both are matched.
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
})

/** `to_tsvector('simple', coalesce(<col>, ''))` at weight `w`. */
function weighted(w: 'A' | 'B', ...columns: string[]) {
  const parts = columns.map((c) => `coalesce(${c}, '')`).join(` || ' ' || `)
  return `setweight(to_tsvector('simple', ${parts}), '${w}')`
}

/** The same, for a `text[]` column — via the IMMUTABLE wrapper (see above). */
function weightedArray(w: 'A' | 'B', ...columns: string[]) {
  const parts = columns.map((c) => `coalesce(sales.words(${c}), '')`).join(` || ' ' || `)
  return `setweight(to_tsvector('simple', ${parts}), '${w}')`
}

// ===========================================================================
// prospects — the core object: company AND deal in one (D-5)
// ===========================================================================
//
// The mockup merges company and deal, and the stakeholder validated that shape.
// It is a simplification we are CHOOSING, not one that is obviously right: the
// mockup's own data already contains the multi-deal case (StaffUp carries both
// "Phase 1 shipped" and "Phase 2 in negotiation", handled with tags).
//
// **Designed for the split without doing it.** The deal fields live here, and
// every child table FKs to `prospect_id` ONLY. Adding `sales.deals` later means
// adding a nullable `deal_id` beside each `prospect_id` — additive, no rewrite,
// no data migration for rows that never split.

export const prospects = salesSchema.table(
  'prospects',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The workspace #number. `bc:sales:{ws}/prospect/{seq}`. */
    seq: integer('seq').notNull(),

    name: varchar('name', { length: 120 }).notNull(),
    city: varchar('city', { length: 80 }),
    /** Free text, not a vocabulary — "SaaS · staffing", "Fiduciaire". */
    sector: varchar('sector', { length: 120 }),

    /** `lib/pipeline.ts` STAGES. Validated in the route, not by a CHECK — the
     *  vocabulary is served live by `bk meta` and a CHECK would need a migration
     *  every time a stage is added. */
    stage: varchar('stage', { length: 24 }).notNull().default('new_lead'),

    value: numeric('value', { precision: 14, scale: 2 }),
    currency: char('currency', { length: 3 }).default('CHF').notNull(),

    /**
     * OUR deal owner — a real person, accountable for the deal.
     *
     * Deliberately a user FK with NO label fallback, unlike the actor columns
     * elsewhere in this schema. An agent can LOG a call and WRITE history; it
     * cannot own a deal. If this ever needs to hold "Companion", that is a
     * product decision, not a schema convenience.
     */
    owner_user_id: integer('owner_user_id').references(() => users.id, { onDelete: 'set null' }),

    /** "referral", "maps", "word of mouth". Free text — the mockup encodes this
     *  in tags today and the taxonomy is not settled. */
    source: varchar('source', { length: 60 }),

    /** BLOB-REF (scan). The last-contact summary — prose, agent-authored. */
    summary: text('summary'),

    // ── the mockup's `nextAction` ─────────────────────────────────────────
    // Four columns rather than a jsonb blob: `due` is filtered on ("actions due
    // today" is a KPI on the mockup's own dashboard) and a jsonb key cannot
    // carry a useful index for that.
    next_action_type: varchar('next_action_type', { length: 24 }),
    /**
     * A DATE, not the mockup's prose.
     *
     * The mockup has "Today", "This week", "Thu 30 July, 10:00". Only the last
     * survives storage: §5.1 says relative strings are a RENDERING, never
     * storage, so the agent resolves a fuzzy due to a concrete date on write.
     * "This week" is genuinely lost — recorded here because it is a real
     * narrowing of what the mockup could express.
     */
    next_action_due: date('next_action_due'),
    /** BLOB-REF (scan). */
    next_action_note: text('next_action_note'),
    /**
     * Who owes the next action — and this one CAN be the agent.
     *
     * Four of the mockup's seven prospects have `ownerId: 'companion'` here, so
     * a user FK alone cannot represent the data. The `_user_id` + `_label` pair
     * is the same shape used for `stage_entries.actor_*` and
     * `communications.logged_by_*`: the FK when a platform user did it, the
     * label always — so agent-written history stays visibly agent-written.
     */
    next_action_owner_user_id: integer('next_action_owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    next_action_owner_label: varchar('next_action_owner_label', { length: 80 }),

    /** Set together when `stage` becomes `won` or `lost`. */
    closed_at: timestamp('closed_at', { withTimezone: true }),
    /** BLOB-REF (scan). Free text — "went with Pipedrive, revisit summer 2027". */
    closed_reason: text('closed_reason'),

    /**
     * Reserved for a future CRM / Google Workspace id. Empty in v1 by design:
     * Gmail / Drive / Calendar integration is an explicit non-goal (§2), and
     * this column is what lets it be ADDED later rather than migrated in.
     */
    external_ref: jsonb('external_ref'),

    created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw(
        [
          weighted('A', 'name'),
          weighted('B', 'city', 'sector', 'source', 'summary', 'next_action_note', 'closed_reason'),
        ].join(' || ')
      )
    ),
  },
  (t) => ({
    wsSeq: uniqueIndex('uq_prospects_ws_seq').on(t.workspace_id, t.seq),
    wsStage: index('idx_prospects_ws_stage').on(t.workspace_id, t.stage),
    wsOwner: index('idx_prospects_ws_owner').on(t.workspace_id, t.owner_user_id),
    wsUpdated: index('idx_prospects_ws_updated').on(t.workspace_id, t.updated_at),
    wsDue: index('idx_prospects_ws_due').on(t.workspace_id, t.next_action_due),
    search: index('idx_prospects_search').using('gin', t.search),
  })
)

// ===========================================================================
// contacts — decision makers at a prospect
// ===========================================================================
// No `seq`: a contact is not independently addressable and has no URN. It is
// always reached through its prospect, so giving it a #number would advertise an
// identity `bk` cannot resolve.

export const contacts = salesSchema.table(
  'contacts',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 120 }).notNull(),
    /** "Co-founder · product", "Sponsor · SKS Innovation SA". */
    role: varchar('role', { length: 120 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 40 }),
    is_primary: boolean('is_primary').default(false).notNull(),
    /** BLOB-REF (scan). */
    notes: text('notes'),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw([weighted('A', 'name'), weighted('B', 'role', 'email', 'notes')].join(' || '))
    ),
  },
  (t) => ({
    prospectIdx: index('idx_contacts_prospect').on(t.prospect_id),
    wsIdx: index('idx_contacts_ws').on(t.workspace_id),
    search: index('idx_contacts_search').using('gin', t.search),
  })
)

// ===========================================================================
// stage_entries — the deal journey
// ===========================================================================
// One row per step of the ladder, INCLUDING the steps not taken yet: the mockup
// renders `upcoming` placeholders with no date, no actor and no note, which is
// why `occurred_at`, `actor_user_id` and `actor_label` are all nullable.
//
// The "by Andrea / by Companion" attribution is a validated feature, not
// decoration. `actor_label` is populated from the TOKEN's name when the write
// comes from a token and from the user's name otherwise, so agent-written
// history stays visibly agent-written.

export const stageEntries = salesSchema.table(
  'stage_entries',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),

    stage: varchar('stage', { length: 24 }).notNull(),
    /** `done | current | upcoming` — `lib/pipeline.ts` STAGE_ENTRY_STATUSES. */
    status: varchar('status', { length: 16 }).notNull().default('upcoming'),
    /** Null on an `upcoming` step, which has not happened yet. */
    occurred_at: timestamp('occurred_at', { withTimezone: true }),

    actor_user_id: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actor_label: varchar('actor_label', { length: 80 }),
    /** BLOB-REF (scan). */
    note: text('note'),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw(weighted('B', 'note', 'actor_label'))
    ),
  },
  (t) => ({
    prospectIdx: index('idx_stage_entries_prospect').on(t.prospect_id, t.occurred_at),
    wsIdx: index('idx_stage_entries_ws').on(t.workspace_id),
    search: index('idx_stage_entries_search').using('gin', t.search),
  })
)

// ===========================================================================
// meetings — the ledger, NOT a calendar
// ===========================================================================
// Google Calendar owns scheduling; this is the per-prospect RECORD of meetings,
// extracted by the agent from voice debriefs, WhatsApp and email threads. A past
// meeting carries an `outcome`; an upcoming one carries an `agenda`. Both
// columns exist on every row because a cancelled meeting can have had both.

export const meetings = salesSchema.table(
  'meetings',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),

    starts_at: timestamp('starts_at', { withTimezone: true }).notNull(),
    duration_min: integer('duration_min'),
    /** `video | call | in_person`. */
    type: varchar('type', { length: 16 }).notNull(),
    /** `upcoming | done | cancelled`. */
    status: varchar('status', { length: 16 }).notNull().default('upcoming'),
    title: varchar('title', { length: 200 }).notNull(),
    /** Plain names, ours and theirs mixed — the mockup does not distinguish and
     *  neither does the record. Not FKs: half of these people are not users. */
    attendees: text('attendees').array(),
    /** BLOB-REF (scan). */
    agenda: text('agenda'),
    /** BLOB-REF (scan). */
    outcome: text('outcome'),

    external_ref: jsonb('external_ref'),

    created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw(
        [
          weighted('A', 'title'),
          weighted('B', 'agenda', 'outcome'),
          weightedArray('B', 'attendees'),
        ].join(' || ')
      )
    ),
  },
  (t) => ({
    wsSeq: uniqueIndex('uq_meetings_ws_seq').on(t.workspace_id, t.seq),
    prospectIdx: index('idx_meetings_prospect').on(t.prospect_id, t.starts_at),
    wsStarts: index('idx_meetings_ws_starts').on(t.workspace_id, t.starts_at),
    search: index('idx_meetings_search').using('gin', t.search),
  })
)

// ===========================================================================
// communications — the multi-channel log
// ===========================================================================
// The mockup's channel for a Google-Maps prospecting sweep is `maps`. Stored as
// `discovery`: the RECORD is "we found them by looking", and naming the tool in
// the schema would need a migration the first time the tool changes. `note` is
// new and is D-13's consequence — sales has no `platform.comments`, so an
// internal note about a prospect is `bk sales comm log --channel note`.

export const communications = salesSchema.table(
  'communications',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),

    /** `email | whatsapp | call | note | discovery | system`. */
    channel: varchar('channel', { length: 16 }).notNull(),
    /** `out` = we → them, `in` = them → us. */
    direction: varchar('direction', { length: 3 }).notNull(),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).notNull(),
    subject: varchar('subject', { length: 300 }),
    /** BLOB-REF (scan). */
    body: text('body'),

    /** Which decision maker, when the record names one. */
    contact_id: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    /** Who logged it — the FK when a platform user did, the label always.
     *  "Companion · auto-logged", "Andrea · voice debrief". */
    logged_by_user_id: integer('logged_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    logged_by_label: varchar('logged_by_label', { length: 80 }),

    external_ref: jsonb('external_ref'),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw([weighted('A', 'subject'), weighted('B', 'body', 'logged_by_label')].join(' || '))
    ),
  },
  (t) => ({
    wsSeq: uniqueIndex('uq_communications_ws_seq').on(t.workspace_id, t.seq),
    prospectIdx: index('idx_communications_prospect').on(t.prospect_id, t.occurred_at),
    wsOccurred: index('idx_communications_ws_occurred').on(t.workspace_id, t.occurred_at),
    wsChannel: index('idx_communications_ws_channel').on(t.workspace_id, t.channel),
    search: index('idx_communications_search').using('gin', t.search),
  })
)

// ===========================================================================
// objections — what they pushed back on, and our counter
// ===========================================================================
// The three-text-column shape is the mockup's and it is the point of the table:
// `spoken` is what they SAID, `real_fear` is what we think they MEAN, `counter`
// is what we say back. Collapsing them into one "notes" field would delete the
// only structured sales insight in the product.

export const objections = salesSchema.table(
  'objections',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),

    /** `pricing | complexity | existing_solution | timing | decision_pending`. */
    type: varchar('type', { length: 32 }).notNull(),
    /** The person at the prospect who raised it, by name. A plain string, not a
     *  `contact_id`: the mockup records a name, and requiring a contact row
     *  would make logging an objection from a call impossible until somebody had
     *  entered the person. Adding a nullable `contact_id` beside it is additive. */
    raised_by: varchar('raised_by', { length: 120 }),
    raised_at: timestamp('raised_at', { withTimezone: true }),
    /** `open | countered | resolved`. */
    status: varchar('status', { length: 16 }).notNull().default('open'),

    /** BLOB-REF (scan). What they actually said, in quotes. */
    spoken: text('spoken'),
    /** BLOB-REF (scan). What we think is really going on. */
    real_fear: text('real_fear'),
    /** BLOB-REF (scan). Our answer. */
    counter: text('counter'),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw(
        [weighted('A', 'raised_by'), weighted('B', 'spoken', 'real_fear', 'counter')].join(' || ')
      )
    ),
  },
  (t) => ({
    prospectIdx: index('idx_objections_prospect').on(t.prospect_id),
    wsStatus: index('idx_objections_ws_status').on(t.workspace_id, t.status),
    search: index('idx_objections_search').using('gin', t.search),
  })
)

// ===========================================================================
// products — what we sell
// ===========================================================================

export const products = salesSchema.table(
  'products',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),

    /** `module | service | licence`. */
    category: varchar('category', { length: 16 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),

    /**
     * The price AS WRITTEN — "CHF 4'800 + CHF 190/mo", "on request", "from CHF
     * 12,000". The mockup has exactly one price field and it is prose, because
     * half the catalogue is not a single number.
     *
     * `price_from` / `price_to` are the machine-readable half where one exists,
     * for filtering and for the pipeline-value maths. Neither derives from the
     * other and `price_label` is what the UI shows.
     */
    price_label: varchar('price_label', { length: 120 }),
    price_from: numeric('price_from', { precision: 14, scale: 2 }),
    price_to: numeric('price_to', { precision: 14, scale: 2 }),
    /** §5.1: money is an amount AND a currency. §5's products table omitted
     *  this; a price with no currency is the bug that only shows up abroad. */
    currency: char('currency', { length: 3 }).default('CHF').notNull(),

    /** BLOB-REF (scan). */
    description: text('description'),
    /** Who it suits — "SMB < 20 employees", "construction trades". */
    fit: text('fit').array(),
    /** BLOB-REF (scan). The one-line pitch. */
    pitch: text('pitch'),
    /** "v1.3 · shipped internally". Prose, not a vocabulary — it is a note about
     *  the product's maturity, not a state machine. */
    status_label: varchar('status_label', { length: 80 }),
    /** Reference customers, by NAME rather than by `prospect_id`: the mockup
     *  cites names, and a reference can be a company we never had a deal row for. */
    refs: text('refs').array(),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw(
        [
          weighted('A', 'name'),
          weighted('B', 'description', 'pitch', 'price_label', 'status_label'),
          weightedArray('B', 'fit', 'refs'),
        ].join(' || ')
      )
    ),
  },
  (t) => ({
    wsSeq: uniqueIndex('uq_products_ws_seq').on(t.workspace_id, t.seq),
    wsCategory: index('idx_products_ws_category').on(t.workspace_id, t.category),
    search: index('idx_products_search').using('gin', t.search),
  })
)

// ===========================================================================
// templates — how we say it
// ===========================================================================

export const templates = salesSchema.table(
  'templates',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),

    /** `email | whatsapp | call` — a call template is a script, not a message. */
    channel: varchar('channel', { length: 16 }).notNull(),
    /** `intro | follow_up | objection | meeting | kickoff`. */
    category: varchar('category', { length: 24 }).notNull(),
    /** The pipeline stage this template is FOR. Nullable — some are stageless. */
    stage: varchar('stage', { length: 24 }),
    name: varchar('name', { length: 120 }).notNull(),
    subject: varchar('subject', { length: 300 }),
    /** BLOB-REF (scan). */
    body: text('body'),
    /**
     * The `{{placeholder}}` names, PARSED FROM `body` ON WRITE.
     *
     * Derived, and stored anyway, for one reason: `bk sales template render`
     * validates that every placeholder was supplied, and doing that by
     * re-parsing on every render puts the parser in two places. Parsed in one
     * helper on the write path; if this ever disagrees with `body`, the write
     * path is the bug.
     */
    variables: text('variables').array(),

    created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw([weighted('A', 'name', 'subject'), weighted('B', 'body')].join(' || '))
    ),
  },
  (t) => ({
    wsSeq: uniqueIndex('uq_templates_ws_seq').on(t.workspace_id, t.seq),
    wsChannel: index('idx_templates_ws_channel').on(t.workspace_id, t.channel),
    wsStage: index('idx_templates_ws_stage').on(t.workspace_id, t.stage),
    search: index('idx_templates_search').using('gin', t.search),
  })
)

// ===========================================================================
// documents — ONE library (D-8)
// ===========================================================================
// A document is either an UPLOADED FILE — through `/api/upload` on the sales
// host, so it lands in `platform.uploads` with `app = 'sales'` and the
// `sales/{ws}/` path prefix — or an EXTERNAL LINK (a Drive folder, a Loom
// recording). The mockup has both and they are not two tables.
//
// The many-to-many tables below are what make the per-prospect Documents tab a
// FILTERED VIEW into one library rather than a silo.

export const documents = salesSchema.table(
  'documents',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),

    title: varchar('title', { length: 200 }).notNull(),
    /** `pdf | deck | image | video | link`. */
    kind: varchar('kind', { length: 16 }).notNull(),

    /**
     * BLOB-REF (exact). The uploaded file's URL, from `platform.uploads`.
     *
     * No FK to `platform.uploads.url`: the same URL can legitimately be
     * referenced without a ledger row (an old upload, a URL pasted between
     * workspaces), and a reference must still count. `platform.blob_references`
     * makes the same choice for the same reason.
     */
    upload_url: text('upload_url'),
    /**
     * BLOB-REF (exact) — and this is the non-obvious one.
     *
     * The column is FOR external URLs, so most rows contribute nothing to the
     * index. But nothing stops a caller putting a blob URL here instead of in
     * `upload_url`, and the CHECK below then forbids the correct column. A file
     * referenced ONLY from an untriggered column is invisible to the delete
     * gate — which is the one failure that ends in lost bytes. `exact` mode
     * filters non-uploads out for free, so the cost of covering it is zero.
     */
    external_url: text('external_url'),

    size_bytes: integer('size_bytes'),
    mime_type: varchar('mime_type', { length: 120 }),
    /** BLOB-REF (scan). The mockup's `note` — prose about what the file is for. */
    description: text('description'),
    tags: text('tags').array(),

    /** Who added it — the FK when a platform user did, the label always.
     *  The mockup has "Companion · auto" and "Kali · field", neither of which is
     *  necessarily a platform user. Same pair as the other actor columns. */
    added_by_user_id: integer('added_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    added_by_label: varchar('added_by_label', { length: 80 }),

    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),

    search: tsvector('search').generatedAlwaysAs(
      sql.raw(
        [
          weighted('A', 'title'),
          weighted('B', 'description', 'added_by_label'),
          weightedArray('B', 'tags'),
        ].join(' || ')
      )
    ),
  },
  (t) => ({
    wsSeq: uniqueIndex('uq_documents_ws_seq').on(t.workspace_id, t.seq),
    wsKind: index('idx_documents_ws_kind').on(t.workspace_id, t.kind),
    search: index('idx_documents_search').using('gin', t.search),
    // Exactly one of the two URL columns. Written in migration 0001 as
    //   CHECK ((upload_url IS NULL) <> (external_url IS NULL))
  })
)

// ===========================================================================
// matches — the triangulation result
// ===========================================================================
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │ THIS TABLE IS WRITTEN BY THE AGENT. THE APP NEVER COMPUTES IT.       │
//   └──────────────────────────────────────────────────────────────────────┘
//
// A live recommendation engine is an explicit non-goal (§2). The agent decides
// which product fits which prospect, with which message and which attachments,
// and STORES the answer here. Building a matcher in the app would contradict the
// doctrine and double the surface — and the first person to add "recompute
// matches" to a route will not have read this far, which is why the sentence is
// at the top of the file rather than in a doc.

export const matches = salesSchema.table(
  'matches',
  {
    id: serial('id').primaryKey(),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    product_id: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),

    /** 0–100. `smallint` because a percentage is not a measurement. */
    fit: smallint('fit'),
    /** The message to lead with, when the agent picked one. */
    template_id: integer('template_id').references(() => templates.id, { onDelete: 'set null' }),
    /** BLOB-REF (scan). The agent's reasoning, in prose — and the agent is the
     *  actor most likely to be holding an upload URL when it writes one. */
    why: text('why'),

    computed_at: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    computed_by_label: varchar('computed_by_label', { length: 80 }),

    search: tsvector('search').generatedAlwaysAs(sql.raw(weighted('B', 'why'))),
  },
  (t) => ({
    /** One verdict per (prospect, product) — so `bk sales match set` is an
     *  upsert rather than an append, and the table cannot silently accumulate
     *  three contradictory scores for the same pair. */
    uq: uniqueIndex('uq_matches_prospect_product').on(t.prospect_id, t.product_id),
    prospectIdx: index('idx_matches_prospect').on(t.prospect_id),
    wsIdx: index('idx_matches_ws').on(t.workspace_id),
    search: index('idx_matches_search').using('gin', t.search),
  })
)

// ===========================================================================
// The join tables
// ===========================================================================
// All four are pure links: a composite primary key, no surrogate id, cascade on
// both sides. Nothing about a link needs a #number, a soft delete or an actor.

/** The attachments a match recommends — the third corner of the triangle. */
export const matchDocuments = salesSchema.table(
  'match_documents',
  {
    match_id: integer('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    document_id: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.match_id, t.document_id] }),
    docIdx: index('idx_match_documents_document').on(t.document_id),
  })
)

/** Which deals a document has been sent to / attached on. */
export const documentProspects = salesSchema.table(
  'document_prospects',
  {
    document_id: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.document_id, t.prospect_id] }),
    prospectIdx: index('idx_document_prospects_prospect').on(t.prospect_id),
  })
)

/** Which products a document is collateral for. */
export const documentProducts = salesSchema.table(
  'document_products',
  {
    document_id: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    product_id: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.document_id, t.product_id] }),
    productIdx: index('idx_document_products_product').on(t.product_id),
  })
)

/** A template's default attachments — references INTO the one library, never a
 *  second copy of a file. */
export const templateDocuments = salesSchema.table(
  'template_documents',
  {
    template_id: integer('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    document_id: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.template_id, t.document_id] }),
    docIdx: index('idx_template_documents_document').on(t.document_id),
  })
)

/**
 * Prospect tags — `platform.labels`, app-scoped (D-14).
 *
 * The mockup's tags ("Phase 1 shipped", "Active client", "Referral ·
 * Metaesthetics") are labels, so they reuse proven machinery — colours, attach,
 * detach, filtering, `bk sales label` — instead of a parallel tag system that
 * every future app then also builds. `platform.labels.app` is what keeps issues'
 * labels out of sales' picker; a read that ignores that column returns another
 * app's labels while the command spelling promises otherwise, so
 * `app IS NULL OR app = 'sales'` belongs in EVERY read, not just the list route.
 */
export const prospectLabels = salesSchema.table(
  'prospect_labels',
  {
    prospect_id: integer('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    label_id: integer('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.prospect_id, t.label_id] }),
    labelIdx: index('idx_prospect_labels_label').on(t.label_id),
  })
)

// ===========================================================================
// counters — the #number allocator
// ===========================================================================

/**
 * One row per (workspace, entity type). **Not** `platform.workspace_counters`:
 * that table no longer exists and must not be recreated
 * (`platform-architecture.md` §4.6). Sharing a counter buys nothing and costs a
 * shared write point plus a shared migration per entity type — and the version
 * the scaffold documents has FIXED columns (`last_issue_seq`, …), so a second
 * app would have to ALTER a platform table every time it added an entity.
 *
 * This shape is generic on purpose: adding `sales.quotes` later adds a ROW, not
 * a column.
 *
 * ── ALLOCATION, AND WHY TWO CONCURRENT CREATES CANNOT COLLIDE ───────────────
 * One statement, inside the same transaction as the insert it numbers:
 *
 *     INSERT INTO sales.counters (workspace_id, entity_type, last_seq)
 *     VALUES ($1, $2, 1)
 *     ON CONFLICT (workspace_id, entity_type)
 *       DO UPDATE SET last_seq = sales.counters.last_seq + 1
 *     RETURNING last_seq;
 *
 * `ON CONFLICT DO UPDATE` takes a ROW LOCK on the conflicting row and re-reads
 * it under that lock, so a second transaction doing the same thing BLOCKS until
 * the first commits or rolls back, then increments the committed value. Two
 * concurrent `prospect create` calls therefore get 12 and 13, never 12 twice.
 *
 * §5.1 says "`UPDATE … RETURNING`", and a bare UPDATE is not enough: the FIRST
 * allocation for a (workspace, type) pair has no row to update and returns zero
 * rows. Splitting it into "UPDATE, and INSERT if that returned nothing" is
 * exactly the read-then-write §5.1 forbids — two concurrent first-creates both
 * see zero rows and both insert. The upsert is one statement and has neither
 * problem.
 *
 * A rollback LOSES the number rather than reusing it, and that is correct:
 * #numbers are identity, not a count. Gaps are fine; a reused number is not.
 */
export const counters = salesSchema.table(
  'counters',
  {
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** `prospect | meeting | communication | product | template | document` —
     *  the projected entity types, from `lib/entity-address.ts`. */
    entity_type: varchar('entity_type', { length: 32 }).notNull(),
    last_seq: integer('last_seq').default(0).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspace_id, t.entity_type] }),
  })
)

// ===========================================================================
// user_preferences — the read-only / full affordance switch (D-7)
// ===========================================================================

/**
 * `ui_mode` is an AFFORDANCE SWITCH, not a permission.
 *
 * `read_only` means the web renders no mutation affordances at all. It does NOT
 * mean the API refuses writes — permissions are `platform.app_access`, and a
 * preference that looked like a permission would be a security control anybody
 * could turn off from their own settings page. Default `read_only`, because the
 * product's doctrine is that the agent writes and the human reads.
 */
export const userPreferences = salesSchema.table(
  'user_preferences',
  {
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspace_id: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** `read_only | full`. */
    ui_mode: varchar('ui_mode', { length: 16 }).default('read_only').notNull(),
    /** Saved listing filters — stage, owner, sort. Opaque to the server. */
    default_filters: jsonb('default_filters'),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.user_id, t.workspace_id] }),
  })
)

// ===========================================================================
// Row types
// ===========================================================================

export type Prospect = typeof prospects.$inferSelect
export type Contact = typeof contacts.$inferSelect
export type StageEntry = typeof stageEntries.$inferSelect
export type Meeting = typeof meetings.$inferSelect
export type Communication = typeof communications.$inferSelect
export type Objection = typeof objections.$inferSelect
export type Product = typeof products.$inferSelect
export type Template = typeof templates.$inferSelect
export type SalesDocument = typeof documents.$inferSelect
export type Match = typeof matches.$inferSelect
export type UserPreferences = typeof userPreferences.$inferSelect
