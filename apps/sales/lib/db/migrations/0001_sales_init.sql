-- b/sales, migration 0001 — the schema, the counters, full-text search.
--
-- Hand-written rather than `drizzle-kit generate`d, for three reasons the
-- generator cannot express: the schema and an IMMUTABLE helper have to exist
-- before any table that uses them, the `tsvector` columns are GENERATED with a
-- weighted expression, and `documents` carries a CHECK. `apps/issues` 0037,
-- 0041–0043 are hand-written for the same kind of reason.
--
-- ENTIRELY ADDITIVE and touches nothing outside `sales`. It does NOT insert the
-- `platform.apps` row and it does NOT install a single blob-reference trigger —
-- both are 0002's job, and the ORDER is the one irreversible thing in this
-- project. See the header of 0002.
--
-- Re-runnable: every CREATE is IF NOT EXISTS / OR REPLACE.
-- Rollback: docs/sql/sales-0001-rollback.sql.

CREATE SCHEMA IF NOT EXISTS sales;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE IMMUTABLE WRAPPER, AND WHY IT HAS TO EXIST
-- ---------------------------------------------------------------------------
-- The generated `search` columns below index `text[]` columns (meeting
-- attendees, document tags, product fit/refs). Neither `array_to_string(arr,' ')`
-- nor `arr::text` may appear in a generation expression: both are STABLE, not
-- IMMUTABLE, because they route through element output functions, and Postgres
-- rejects the CREATE TABLE outright with
--
--     ERROR: generation expression is not immutable
--
-- Checked against PostgreSQL 16 rather than remembered — `provolatile` in
-- `pg_proc` reads 's' for `array_to_string` and 'i' for `setweight`. (The same
-- query is why every `to_tsvector` call below passes an explicit `'simple'`:
-- the one-argument form resolves `default_text_search_config` at runtime and is
-- STABLE too. Same function name, both volatilities.)
--
-- This wrapper is not a volatility lie. It is declared over `text[]` only, whose
-- element output function is `textout`, and that genuinely is immutable. What
-- makes `array_to_string(anyarray, text)` STABLE is the *any* — an array of a
-- type whose output depends on a GUC. There is no such type here.
CREATE OR REPLACE FUNCTION sales.words(arr text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT array_to_string(arr, ' ')
$fn$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- prospects — the core object: company AND deal in one (D-5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.prospects (
  id                        serial PRIMARY KEY,
  workspace_id              integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  seq                       integer NOT NULL,
  name                      varchar(120) NOT NULL,
  city                      varchar(80),
  sector                    varchar(120),
  stage                     varchar(24) NOT NULL DEFAULT 'new_lead',
  value                     numeric(14,2),
  currency                  char(3) NOT NULL DEFAULT 'CHF',
  owner_user_id             integer REFERENCES platform.users(id) ON DELETE SET NULL,
  source                    varchar(60),
  summary                   text,
  next_action_type          varchar(24),
  next_action_due           date,
  next_action_due_label     varchar(40),
  next_action_note          text,
  next_action_owner_user_id integer REFERENCES platform.users(id) ON DELETE SET NULL,
  next_action_owner_label   varchar(80),
  closed_at                 timestamptz,
  closed_reason             text,
  external_ref              jsonb,
  created_by                integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple',
      coalesce(city, '') || ' ' || coalesce(sector, '') || ' ' || coalesce(source, '') || ' ' ||
      coalesce(summary, '') || ' ' || coalesce(next_action_note, '') || ' ' ||
      coalesce(closed_reason, '')), 'B')
  ) STORED
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospects_ws_seq     ON sales.prospects (workspace_id, seq);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prospects_ws_stage         ON sales.prospects (workspace_id, stage);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prospects_ws_owner         ON sales.prospects (workspace_id, owner_user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prospects_ws_updated       ON sales.prospects (workspace_id, updated_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prospects_ws_due           ON sales.prospects (workspace_id, next_action_due);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prospects_search           ON sales.prospects USING gin (search);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- contacts — decision makers. No `seq`: not independently addressable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.contacts (
  id           serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  prospect_id  integer NOT NULL REFERENCES sales.prospects(id) ON DELETE CASCADE,
  name         varchar(120) NOT NULL,
  role         varchar(120),
  email        varchar(255),
  phone        varchar(40),
  is_primary   boolean NOT NULL DEFAULT false,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple',
      coalesce(role, '') || ' ' || coalesce(email, '') || ' ' || coalesce(notes, '')), 'B')
  ) STORED
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_prospect ON sales.contacts (prospect_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_ws       ON sales.contacts (workspace_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_search   ON sales.contacts USING gin (search);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- stage_entries — the deal journey, INCLUDING the steps not reached yet, which
-- is why occurred_at and both actor columns are nullable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.stage_entries (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  prospect_id   integer NOT NULL REFERENCES sales.prospects(id) ON DELETE CASCADE,
  stage         varchar(24) NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'upcoming',
  occurred_at   timestamptz,
  actor_user_id integer REFERENCES platform.users(id) ON DELETE SET NULL,
  actor_label   varchar(80),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple',
      coalesce(note, '') || ' ' || coalesce(actor_label, '')), 'B')
  ) STORED
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_stage_entries_prospect ON sales.stage_entries (prospect_id, occurred_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_stage_entries_ws       ON sales.stage_entries (workspace_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_stage_entries_search   ON sales.stage_entries USING gin (search);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- meetings — the LEDGER, not a calendar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.meetings (
  id           serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  seq          integer NOT NULL,
  prospect_id  integer NOT NULL REFERENCES sales.prospects(id) ON DELETE CASCADE,
  starts_at    timestamptz NOT NULL,
  duration_min integer,
  type         varchar(16) NOT NULL,
  status       varchar(16) NOT NULL DEFAULT 'upcoming',
  title        varchar(200) NOT NULL,
  attendees    text[],
  agenda       text,
  outcome      text,
  external_ref jsonb,
  created_by   integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple',
      coalesce(agenda, '') || ' ' || coalesce(outcome, '') || ' ' ||
      coalesce(sales.words(attendees), '')), 'B')
  ) STORED
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_ws_seq   ON sales.meetings (workspace_id, seq);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_meetings_prospect       ON sales.meetings (prospect_id, starts_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_meetings_ws_starts      ON sales.meetings (workspace_id, starts_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_meetings_search         ON sales.meetings USING gin (search);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- communications — the multi-channel log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.communications (
  id                serial PRIMARY KEY,
  workspace_id      integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  seq               integer NOT NULL,
  prospect_id       integer NOT NULL REFERENCES sales.prospects(id) ON DELETE CASCADE,
  channel           varchar(16) NOT NULL,
  direction         varchar(3) NOT NULL,
  occurred_at       timestamptz NOT NULL,
  subject           varchar(300),
  body              text,
  contact_id        integer REFERENCES sales.contacts(id) ON DELETE SET NULL,
  logged_by_user_id integer REFERENCES platform.users(id) ON DELETE SET NULL,
  logged_by_label   varchar(80),
  external_ref      jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('simple',
      coalesce(body, '') || ' ' || coalesce(logged_by_label, '')), 'B')
  ) STORED
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_communications_ws_seq ON sales.communications (workspace_id, seq);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_communications_prospect     ON sales.communications (prospect_id, occurred_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_communications_ws_occurred  ON sales.communications (workspace_id, occurred_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_communications_ws_channel   ON sales.communications (workspace_id, channel);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_communications_search       ON sales.communications USING gin (search);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- objections — spoken / real_fear / counter. Three columns, deliberately: it is
-- the only structured sales insight in the product.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.objections (
  id           serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  prospect_id  integer NOT NULL REFERENCES sales.prospects(id) ON DELETE CASCADE,
  type         varchar(32) NOT NULL,
  raised_by    varchar(120),
  raised_at    timestamptz,
  status       varchar(16) NOT NULL DEFAULT 'open',
  spoken       text,
  real_fear    text,
  counter      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(raised_by, '')), 'A') ||
    setweight(to_tsvector('simple',
      coalesce(spoken, '') || ' ' || coalesce(real_fear, '') || ' ' ||
      coalesce(counter, '')), 'B')
  ) STORED
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_objections_prospect  ON sales.objections (prospect_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_objections_ws_status ON sales.objections (workspace_id, status);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_objections_search    ON sales.objections USING gin (search);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.products (
  id           serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  seq          integer NOT NULL,
  category     varchar(16) NOT NULL,
  name         varchar(120) NOT NULL,
  price_label  varchar(120),
  price_from   numeric(14,2),
  price_to     numeric(14,2),
  currency     char(3) NOT NULL DEFAULT 'CHF',
  description  text,
  fit          text[],
  pitch        text,
  status_label varchar(80),
  refs         text[],
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple',
      coalesce(description, '') || ' ' || coalesce(pitch, '') || ' ' ||
      coalesce(price_label, '') || ' ' || coalesce(status_label, '') || ' ' ||
      coalesce(sales.words(fit), '') || ' ' || coalesce(sales.words(refs), '')), 'B')
  ) STORED
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_ws_seq ON sales.products (workspace_id, seq);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_products_ws_category  ON sales.products (workspace_id, category);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_products_search       ON sales.products USING gin (search);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.templates (
  id           serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  seq          integer NOT NULL,
  channel      varchar(16) NOT NULL,
  category     varchar(24) NOT NULL,
  stage        varchar(24),
  name         varchar(120) NOT NULL,
  subject      varchar(300),
  body         text,
  variables    text[],
  created_by   integer REFERENCES platform.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple',
      coalesce(name, '') || ' ' || coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'B')
  ) STORED
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_ws_seq ON sales.templates (workspace_id, seq);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_templates_ws_channel   ON sales.templates (workspace_id, channel);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_templates_ws_stage     ON sales.templates (workspace_id, stage);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_templates_search       ON sales.templates USING gin (search);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- documents — ONE library (D-8): an uploaded file OR an external link.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.documents (
  id               serial PRIMARY KEY,
  workspace_id     integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  seq              integer NOT NULL,
  title            varchar(200) NOT NULL,
  kind             varchar(16) NOT NULL,
  upload_url       text,
  external_url     text,
  size_bytes       integer,
  mime_type        varchar(120),
  description      text,
  tags             text[],
  added_by_user_id integer REFERENCES platform.users(id) ON DELETE SET NULL,
  added_by_label   varchar(80),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple',
      coalesce(description, '') || ' ' || coalesce(added_by_label, '') || ' ' ||
      coalesce(sales.words(tags), '')), 'B')
  ) STORED,
  -- Exactly one. A document is a file we hold or a link we point at, never both
  -- and never neither. NOTE that this constraint is also why `external_url`
  -- carries a blob-reference trigger in 0002: a blob URL put in the wrong column
  -- makes the RIGHT column illegal, and an untriggered reference is invisible to
  -- the delete gate.
  CONSTRAINT documents_one_location CHECK ((upload_url IS NULL) <> (external_url IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_ws_seq ON sales.documents (workspace_id, seq);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documents_ws_kind      ON sales.documents (workspace_id, kind);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documents_search       ON sales.documents USING gin (search);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- matches — WRITTEN BY THE AGENT. The app never computes this.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.matches (
  id                serial PRIMARY KEY,
  workspace_id      integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  prospect_id       integer NOT NULL REFERENCES sales.prospects(id) ON DELETE CASCADE,
  product_id        integer NOT NULL REFERENCES sales.products(id) ON DELETE CASCADE,
  fit               smallint,
  template_id       integer REFERENCES sales.templates(id) ON DELETE SET NULL,
  why               text,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  computed_by_label varchar(80),
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(why, '')), 'B')
  ) STORED
);--> statement-breakpoint
-- One verdict per (prospect, product), so `bk sales match set` is an upsert and
-- the table cannot accumulate three contradictory scores for the same pair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_matches_prospect_product ON sales.matches (prospect_id, product_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_matches_prospect ON sales.matches (prospect_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_matches_ws       ON sales.matches (workspace_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_matches_search   ON sales.matches USING gin (search);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The join tables. Composite PK, no surrogate id, cascade both ways.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.match_documents (
  match_id    integer NOT NULL REFERENCES sales.matches(id) ON DELETE CASCADE,
  document_id integer NOT NULL REFERENCES sales.documents(id) ON DELETE CASCADE,
  PRIMARY KEY (match_id, document_id)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_match_documents_document ON sales.match_documents (document_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sales.document_prospects (
  document_id integer NOT NULL REFERENCES sales.documents(id) ON DELETE CASCADE,
  prospect_id integer NOT NULL REFERENCES sales.prospects(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, prospect_id)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_document_prospects_prospect ON sales.document_prospects (prospect_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sales.document_products (
  document_id integer NOT NULL REFERENCES sales.documents(id) ON DELETE CASCADE,
  product_id  integer NOT NULL REFERENCES sales.products(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, product_id)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_document_products_product ON sales.document_products (product_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sales.template_documents (
  template_id integer NOT NULL REFERENCES sales.templates(id) ON DELETE CASCADE,
  document_id integer NOT NULL REFERENCES sales.documents(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, document_id)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_template_documents_document ON sales.template_documents (document_id);--> statement-breakpoint

-- Prospect tags are `platform.labels`, app-scoped (D-14). Reuses colours,
-- attach/detach, filtering and `bk sales label` instead of a parallel tag system
-- every future app would then also build.
CREATE TABLE IF NOT EXISTS sales.prospect_labels (
  prospect_id integer NOT NULL REFERENCES sales.prospects(id) ON DELETE CASCADE,
  label_id    integer NOT NULL REFERENCES platform.labels(id) ON DELETE CASCADE,
  PRIMARY KEY (prospect_id, label_id)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prospect_labels_label ON sales.prospect_labels (label_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- counters — the #number allocator. See lib/db/queries/counters.ts for the
-- single-statement allocation and why two concurrent creates cannot collide.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.counters (
  workspace_id integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  entity_type  varchar(32) NOT NULL,
  last_seq     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, entity_type)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- user_preferences — the read-only / full AFFORDANCE switch (D-7). Not a
-- permission: permissions are `platform.app_access`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.user_preferences (
  user_id         integer NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  workspace_id    integer NOT NULL REFERENCES platform.workspaces(id) ON DELETE CASCADE,
  ui_mode         varchar(16) NOT NULL DEFAULT 'read_only',
  default_filters jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id)
);
