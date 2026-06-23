-- Migration 0031: Upload ledger + storage-limit base.
--
-- Two additive changes supporting workspace storage management:
--
-- 1. `uploads` — a ledger with one row per file stored through our upload
--    pipeline (Vercel Blob in prod, public/uploads in dev), written at upload
--    time. It is the authoritative record of "this file exists in storage and
--    belongs to this workspace" and the source for the owner-facing Storage
--    page. It is metadata only: deletion is gated by a live reference scan over
--    the content tables (lib/blob-refs.ts), never by this table, so a stale or
--    missing row can never cause data loss. `url` is unique → re-recording the
--    same upload is a no-op.
--
-- 2. `workspaces.storage_limit_bytes` — future-proofing for storage quotas.
--    NULL = unlimited (the only behaviour today; nothing enforces it yet).
--    Current usage is SUM(uploads.size); enforcement, when added, compares the
--    two at upload time.
--
-- Purely additive; no existing data is touched.

CREATE TABLE uploads (
  id serial PRIMARY KEY,
  workspace_id integer REFERENCES workspaces(id) ON DELETE CASCADE,
  url text NOT NULL,
  pathname text,
  filename varchar(255) NOT NULL,
  size bigint,
  mime_type varchar(100),
  uploaded_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_uploads_url ON uploads (url);
CREATE INDEX idx_uploads_workspace ON uploads (workspace_id);

ALTER TABLE workspaces ADD COLUMN storage_limit_bytes bigint;
