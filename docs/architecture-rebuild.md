# Architecture Rebuild Plan

**Status:** draft v1
**Owner:** balathanusan@blackcode.ch
**Last updated:** 2026-05-22
**Goal:** turn the current app into a stripped-down, professional issue-tracking system to replace Linear for internal use. Production-grade, multi-tenant via workspaces, with first-class activity, inbox, analytics, error tracking, and a Go CLI.

This document is the **single source of truth** for the rebuild. Every phase below produces shippable, working software — no phase leaves the app broken. If a decision in this doc conflicts with code, this doc wins and the code gets updated; if a decision turns out wrong, update this doc *first*, then change the code.

---

## 0. Executive summary

We are restructuring the data model from `Project → Milestone → Issue` to `Workspace → (Projects, Milestones, Issues, Labels, Members, Analytics, Activity)` where projects/milestones/issues can be standalone within a workspace and linked or unlinked at will. Everything else — permissions, invitations, inbox, analytics, errors — is rebuilt around this.

The north star: **a tightly scoped Linear alternative we'd actually want to use ourselves.** Not feature-complete with Linear. Professional in the parts we do build.

**Scope-defining principles** (referenced throughout):

1. **Workspace is the unit of multi-tenancy.** Every domain row carries `workspace_id`. Every API call is workspace-scoped. There is no global cross-workspace listing.
2. **Permissions are workspace-level only.** Two roles: `owner` (invite, remove members, delete workspace) and `member` (everything inside). No per-project ACLs, no nested roles. Anything else creates complexity we don't want.
3. **Issues and milestones are first-class.** They can exist without a project. The project link is metadata, not ownership. The owning row is always the workspace.
4. **Events are the spine.** Every domain mutation writes an event. Activity feed, inbox, and analytics are projections over events. We never duplicate this data; we project it.
5. **Inbox is user-scoped, not workspace-scoped.** A single inbox spans all workspaces a user is in. Filterable by workspace/project/issue.
6. **No email, no webhooks, no push.** All "notifications" are inbox messages with `read/unread` state. We won't pretend to send email.
7. **Soft delete users; hard delete their owned workspaces.** Deleted users remain visible in workspaces they were a member of, marked deleted. Email is reusable by a new signup.
8. **Labels live at the workspace level**, not the project. This lets standalone issues be labeled.
9. **Errors are first-class data.** A public `/status` page summarizes recent failures; full detail is owner-gated.
10. **The CLI is a thin client over the same API as the web app.** No CLI-only endpoints, no parallel auth model. Per `docs/cli-sync.md`.

---

## Part I — Architecture decisions

This section explains *why* we made every non-obvious call. When the implementation gets tricky, come back here.

### 1.1 Multi-tenancy: `workspace_id` on every row

Every domain table gets a `workspace_id` column with `NOT NULL` and a foreign key. Cross-workspace queries are forbidden by convention and enforced by:

- All API routes resolve a workspace from the URL path (`/api/workspaces/[wsId]/...`) or a default-active-workspace setting for "global" pages (inbox, profile).
- The query layer in `lib/db/queries/` takes `workspaceId` as a required argument for every list/read/write operation. Helper `withWorkspace(workspaceId, userId)` gates every call by membership.
- Even the activity and inbox tables carry `workspace_id` so filtering by workspace is a single index lookup.

Trade-off considered and rejected: row-level security in Postgres. Too much overhead for a small team app, and Drizzle support is limited. We get the same safety by enforcing membership at the query helper boundary.

### 1.2 Permission model: owner vs member, single tier

We keep this brutally simple.

- `workspaces.owner_id` is the **current** owner. Exactly one.
- `workspace_members.role ∈ {'owner', 'member'}`. The owner row is always present in `workspace_members` for query consistency.
- **Owner permissions:** invite members, remove members, transfer ownership, update workspace name/logo, delete workspace.
- **Member permissions:** everything else inside the workspace (CRUD projects, milestones, issues, comments, labels, view analytics, view activity).
- **Owner transfer:** a workspace must always have an owner. To leave, owner transfers to another member first. Or deletes the workspace.
- **No per-project private projects.** Every member sees every project in the workspace. If users need privacy, they create another workspace.

We considered adding `admin` between owner and member (for managing labels, removing comments, etc.). Rejected — adds a permission matrix to maintain and the user wants simplicity.

### 1.3 Hierarchy: optional, non-transitive parenting

The user's mental model is that projects, milestones, and issues are first-class within a workspace, linkable in any combination. We model this as **direct, optional foreign keys** rather than a transitive hierarchy.

```
issues.workspace_id   NOT NULL  → workspaces
issues.project_id     NULLABLE  → projects
issues.milestone_id   NULLABLE  → milestones

milestones.workspace_id NOT NULL → workspaces
milestones.project_id   NULLABLE → projects

projects.workspace_id   NOT NULL → workspaces
```

**Rule we adopt:** the issue's project link is independent of its milestone's project link. If issue A is linked to milestone M which is linked to project P, the issue is **not** automatically "in project P." It belongs to P only if `issue.project_id = P`.

This avoids the "what does it mean to be in two projects?" question and gives us simple, predictable listings. Listing "Issues in project P" returns issues where `project_id = P`. The "Issues in this project" page on a project will also offer a tab "Via milestones" that includes issues linked to a milestone of P but not directly to P — but only as a derived view, never persisted.

**Cascade rules:**

| Parent deleted | Child behavior |
|---|---|
| Workspace deleted | Cascade delete all rows (projects, milestones, issues, comments, attachments, labels, members, invitations, events scoped to it, inbox messages scoped to it) |
| Project deleted | Issues' `project_id` set to NULL (issue survives). Milestones' `project_id` set to NULL (milestone survives). |
| Milestone deleted | Issues' `milestone_id` set to NULL (issue survives). |
| Issue deleted | Cascade delete comments, attachments, issue_labels. |
| User deleted (soft) | Issue.assignee_id/reporter_id, comment.user_id stay pointing at the soft-deleted user row. UI shows "(deleted)". |

### 1.4 Events: a single, append-only spine

Every mutation produces a row in `events`. The existing `transaction_log` table is the closest thing we have; we replace it with a more structured `events` table.

```
events {
  id              bigserial PK
  workspace_id    int       NOT NULL FK
  actor_user_id   int       NULL FK     -- null for system events
  actor_token_id  int       NULL FK     -- which API token, if via CLI
  entity_type     text      NOT NULL    -- 'issue' | 'milestone' | 'project' | 'comment' | 'attachment' | 'label' | 'workspace' | 'member' | 'invitation'
  entity_id       int       NOT NULL
  action          text      NOT NULL    -- 'created' | 'updated' | 'deleted' | 'commented' | 'assigned' | 'unassigned' | 'status_changed' | 'priority_changed' | 'milestone_changed' | 'project_changed' | 'labeled' | 'unlabeled' | 'attached' | 'unattached' | 'mentioned' | 'member_added' | 'member_removed' | 'invited' | 'invitation_accepted' | 'ownership_transferred'
  diff            jsonb     NULL        -- { before: {...}, after: {...} } for updates
  meta            jsonb     NULL        -- e.g. { mentioned_user_ids: [...], label_id, comment_id }
  occurred_at     timestamptz NOT NULL DEFAULT now()
  idempotency_key text      NULL        -- optional, for client retries
}
```

**Why one events table instead of one per type?** Querying "everything that happened to issue 1234" or "everything in workspace W since X" or "everything by user U" is one indexed query, and the activity feed UI is one component. Per-type tables would force a UNION ALL of 6 tables. We accept the wide jsonb column for flexibility.

**Indexes:**
- `(workspace_id, occurred_at DESC)` — activity feed
- `(workspace_id, entity_type, entity_id, occurred_at DESC)` — entity history
- `(workspace_id, actor_user_id, occurred_at DESC)` — member achievements
- `(workspace_id, action, occurred_at DESC)` — analytics queries

**Write rule:** events are written **in the same transaction** as the mutation that produced them. We add a helper `withEvent(tx, event)` that wraps the existing mutation pattern. If the mutation rolls back, the event rolls back. No event = no analytics or activity for that change — never acceptable.

**Idempotency:** for API calls that pass `Idempotency-Key`, we hash it with the route and store in `idempotency_key`. Re-runs match by `(workspace_id, idempotency_key)` and short-circuit.

### 1.5 Inbox: a per-user projection of events

Inbox is **not** "every event in your workspaces." It's a fan-out from interesting events to the users who should be notified.

```
inbox_messages {
  id            bigserial PK
  user_id       int       NOT NULL FK
  event_id      bigint    NULL FK         -- source event (null for synthetic messages)
  workspace_id  int       NULL FK         -- nullable for cross-workspace system messages
  type          text      NOT NULL        -- 'mention' | 'assigned' | 'unassigned' | 'status_changed' | 'commented' | 'invitation' | 'member_added' | 'workspace_deleted' | 'ownership_transferred' | 'due_soon' | 'milestone_due_soon' | 'system'
  entity_type   text      NULL            -- denormalized for filter UI
  entity_id     int       NULL
  payload       jsonb     NOT NULL        -- enough to render the message without joining events
  read_at       timestamptz NULL
  archived_at   timestamptz NULL
  created_at    timestamptz NOT NULL DEFAULT now()
}
```

**Fan-out rules** (computed at write time, in the same transaction as the event):

| Event | Recipients |
|---|---|
| `comment.created` with mentions | each mentioned user (type=`mention`) |
| `comment.created` (no mentions) | issue assignee + reporter + watchers (type=`commented`) |
| `issue.assigned` | the new assignee (type=`assigned`) |
| `issue.unassigned` | the previous assignee (type=`unassigned`) |
| `issue.status_changed` to `done` or `cancelled` | reporter + watchers (type=`status_changed`) |
| `issue.updated` (any field) | watchers only (type=`status_changed`) — only if assigned or watching |
| `invitation.created` | the invited email's user, if it exists (type=`invitation`); else deferred |
| `workspace.member_added` | owner (type=`member_added`) |
| `workspace.ownership_transferred` | new owner + old owner (type=`ownership_transferred`) |
| `workspace.deleted` | all members (type=`workspace_deleted`) |
| Cron: issue due within 24h | assignee (type=`due_soon`) |
| Cron: milestone due within 72h | all watchers of issues in milestone (type=`milestone_due_soon`) |

**Watchers** (`issue_watchers` table): you auto-watch when you create or are assigned to an issue. You auto-unwatch when unassigned, unless you've manually pinned it. Manual `bk issue watch/unwatch`.

**Dedup:** for high-frequency edits (e.g. status flipped twice in a minute), we coalesce inbox messages of the same `(user_id, entity_id, type)` within a 60-second window — last write wins, payload updated. Reduces noise.

**Invitations to non-users:** stored in `workspace_invitations`. On signup, a hook materializes inbox messages for any pending invitations matching the new user's email. See §1.6.

### 1.6 Invitations to non-existing users

```
workspace_invitations {
  id           serial PK
  workspace_id int   NOT NULL FK
  email        varchar(255) NOT NULL
  invited_by   int   NOT NULL FK → users
  role         varchar(20) NOT NULL DEFAULT 'member'   -- always 'member' for now
  token        varchar(64) NOT NULL UNIQUE             -- random, for accept link
  status       varchar(20) NOT NULL DEFAULT 'pending'  -- 'pending' | 'accepted' | 'revoked' | 'expired'
  expires_at   timestamptz NOT NULL                    -- default now()+14 days
  created_at   timestamptz NOT NULL DEFAULT now()
  accepted_at  timestamptz NULL
  accepted_by  int NULL FK → users
}
```

Flow:
1. Owner enters email + clicks Invite. Row created, status=pending. Event `invitation.created`.
2. If a user with that email **exists**, immediately create inbox message type=`invitation` for that user.
3. If not, the invitation sits as `pending`. No inbox message yet (no user to attach to).
4. On signup (and on Google OAuth first-time signup), a hook runs: `SELECT * FROM workspace_invitations WHERE LOWER(email) = LOWER(?) AND status = 'pending' AND expires_at > now()`. For each, create an inbox message type=`invitation`.
5. User clicks Accept on inbox message → `workspace_members` row created with role=member, invitation status=accepted, event `invitation.accepted`, owner gets `member_added` inbox message.

**Resending:** new invitation row, prior pending invitations for the same `(workspace_id, email)` set to `revoked`. We do not extend the existing row, so the audit trail is clean.

### 1.7 Soft-delete users; allow email reuse

```sql
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
-- replace existing UNIQUE on email with a partial unique index
DROP INDEX users_email_key;  -- whatever it's called
CREATE UNIQUE INDEX uq_users_email_active ON users(email) WHERE deleted_at IS NULL;
```

Deletion flow (`DELETE /api/me`):

1. Find all workspaces where user is sole owner with no other members. Hard-delete them (cascade).
2. For workspaces where user is owner with members: **block deletion**, prompt to transfer ownership first.
3. For other memberships: set `workspace_members.role = 'member'` if owner (shouldn't happen) and keep the row. The row's `user_id` still points at the soft-deleted user.
4. Revoke all `api_tokens` for the user.
5. Hard-delete `inbox_messages` for the user (privacy).
6. Set `users.deleted_at = now()`. Clear `password_hash`. Clear `google_id`. Keep `email` and `name` for display.
7. Active session is invalidated on next request (JWT check against `deleted_at`).

A new signup with the same email creates a fresh `users` row — the partial unique index permits this.

**UI:** anywhere we render a user (assignee chip, comment author, member list), if `users.deleted_at IS NOT NULL` we show `<Name> (deleted)` in gray, no link.

### 1.8 Labels at workspace level

```
labels {
  id           serial PK
  workspace_id int   NOT NULL FK
  name         varchar(50) NOT NULL
  color        varchar(7) NOT NULL DEFAULT '#6b7280'   -- hex
  description  text NULL
  created_by   int NULL FK → users
  created_at   timestamptz NOT NULL DEFAULT now()
}
UNIQUE (workspace_id, LOWER(name))   -- enforced via uniqueIndex on lower(name)
```

Issue-label join:
```
issue_labels {
  issue_id  int NOT NULL FK
  label_id  int NOT NULL FK
  PRIMARY KEY (issue_id, label_id)
}
```

Migration of existing labels: today they're keyed by project. We re-key to workspace by `UPDATE labels SET workspace_id = (SELECT workspace_id FROM projects WHERE projects.id = labels.project_id)`. If two projects in the same workspace have a label with the same name, we coalesce (keep the older row, repoint `issue_labels`, delete duplicates). See migration phase.

### 1.9 Analytics: views, filters, PDF

The user wants analytics views: workspace, project, milestone, issues, member, with date filters and PDF download. We compute everything from `events` and the live state tables.

**Implementation:**
- A single `/api/workspaces/[ws]/analytics` route accepts query params: `view` (workspace|project|milestone|member), `id` (id of project/milestone/member when view ≠ workspace), `from`, `to`.
- Returns a normalized `AnalyticsPayload`:
  ```ts
  {
    scope: { type, id, label },
    period: { from, to },
    summary: {
      total_issues, open, in_progress, done, cancelled,
      created_in_period, completed_in_period,
      avg_cycle_time_hours, avg_lead_time_hours,
      total_members, active_members_in_period,
    },
    by_status: [{ status, count }],
    by_priority: [{ priority, count }],
    by_assignee: [{ user_id, name, open, done }],
    by_label: [{ label_id, name, color, count }],
    velocity_series: [{ bucket: '2026-05-15', created, completed }],
    burndown_series?: [{ date, remaining }],  // only for milestone view
    top_active_members: [{ user_id, name, events }],
  }
  ```
- The page reads this and renders charts (one component per chart). Recharts is fine; small dep.
- PDF: a route `/dashboard/[ws]/analytics/print` that reads the same payload and renders a print-styled view (no shell, no sidebar). User clicks "Download PDF" → window.open this route, then `window.print()` with Save-as-PDF. Zero server cost.

**Performance:** for now, all analytics is computed live. Acceptable up to ~100k events per workspace. If it gets slow, add materialized views on a cron. Don't optimize before measuring.

### 1.10 Activity page

The activity page is the literal `events` table for a workspace, filtered/grouped for humans. Filters: actor, entity_type, action, project, milestone, date range.

Reuses the same data the inbox is built from, so the two stay consistent.

### 1.11 Members page + per-member achievements

`/dashboard/[ws]/members` — list of all `workspace_members` joined with `users`.
`/dashboard/[ws]/members/[userId]` — that member's activity in this workspace:
- Counts: issues created, completed, assigned, in-progress, comments written
- Last 50 activities (filtered events where actor_user_id = userId AND workspace_id = ws)
- Velocity sparkline (events per day, last 30 days)

Everything is derived from `events` + a few aggregate queries. No new tables needed.

### 1.12 Profile and account deletion UI

`/dashboard/settings/profile`:
- Name, tagline, avatar upload, email (read-only after signup)
- Save → updates `users` row
- "Delete account" button with confirmation modal. Lists workspaces that would be deleted (sole-owner, no members). Lists workspaces that block deletion (owner with members) and prompts to transfer first.

Signup form intentionally collects minimum data: email + password (or Google). Name is captured from Google for OAuth signups; for credentials signup, name defaults to email local-part and the user fills it in on first dashboard load via a one-time "Welcome, set your name" prompt.

### 1.13 API tokens

Keep current model. Tokens are user-scoped, not workspace-scoped — same as Linear's. CLI sets active workspace via `bk workspace use <id>`, stored in CLI config. API enforces membership at request time, not at token time.

`/dashboard/settings/tokens` — list/create/revoke. Existing implementation, light refactor.

### 1.14 Real-time and revalidation

Phase 1: no WebSocket/SSE. Pages use SWR with `revalidateOnFocus: true` and a manual refresh button. Inbox badge polls every 30s when the tab is focused; pauses when not.

Why: WebSockets on Vercel mean a separate Edge worker or paid Realtime service. Not worth it for a team-sized app. Revisit when we feel the pain.

### 1.15 PDF generation

Print-to-PDF via browser dialog (§1.9). No server-side PDF lib, no headless Chrome.

### 1.16 Error tracking + status page

```
error_events {
  id            bigserial PK
  workspace_id  int NULL FK
  user_id       int NULL FK
  level         varchar(10) NOT NULL   -- 'error' | 'warn' | 'fatal'
  code          varchar(50) NULL        -- e.g. 'DB_TIMEOUT', 'BLOB_503', 'UNAUTHORIZED'
  message       text NOT NULL
  stack         text NULL               -- truncated to 8KB
  route         varchar(255) NULL       -- e.g. '/api/workspaces/12/issues'
  method        varchar(10) NULL
  status_code   int NULL
  context       jsonb NULL              -- sanitized, no tokens/passwords
  occurred_at   timestamptz NOT NULL DEFAULT now()
}
```

Capture point: an `apiHandler(handler)` wrapper around every API route catches thrown errors, inserts an `error_events` row, then re-throws as the appropriate HTTP response. Frontend errors caught by a top-level Error Boundary POST to `/api/errors/client` which also inserts.

`/status` page (public, no auth):
- Top section: current health probes. Three pings:
  - `db_ping` — runs `SELECT 1` against Postgres (cached 30s).
  - `blob_ping` — HEAD on a known blob URL if `BLOB_READ_WRITE_TOKEN` is set; otherwise marked "not configured" green.
  - `app_ping` — returns the current build sha + uptime.
- Last 7 days uptime sparkline (rough: derived from `error_events` of `level=fatal` per hour).
- Last 100 errors (paginated): show `code`, `route`, `method`, `status_code`, `occurred_at`, `level`. No `stack`, no `context`, no user_id/workspace_id (those leak info).
- Admin-only detail view at `/status/errors/[id]` (gated by being an `owner` of *any* workspace — the workspace owner trusted bar): full stack, context.

**Privacy:** we deliberately sanitize before storing. `context` jsonb whitelist: route params, query keys (not values), error name, anonymized user agent. Never store request bodies. Never store cookies/auth headers.

### 1.17 CLI sync

Existing `docs/cli-sync.md` already covers the workflow. The breaking changes incoming:

- `/api/projects/...` → `/api/workspaces/[ws]/projects/...` (workspace in URL)
- New endpoints: workspaces, members, invitations, inbox, labels (currently absent or scoped wrong), error events, status
- CLI gains: `bk workspace list/use/show/create`, `bk inbox list/read`, `bk member list/show`, `bk label list/create/add/remove`, `bk invite send/list/revoke`

Maintained backward-compat shim: for a single release, `/api/projects/[id]` continues to work by resolving the project's workspace internally. We then remove the shim. CLI version bumps from `0.1.x` to `0.2.0` to signal the workspace requirement; older CLI prints an upgrade prompt.

---

## Part II — Data model (complete schema)

This is the target schema. Migrations to get from current → target are in Phase 1 and 2.

```text
workspaces
  id              serial PK
  name            varchar(80)   NOT NULL
  slug            varchar(40)   NOT NULL UNIQUE         -- url-safe, kebab-case
  key             varchar(6)    NOT NULL UNIQUE         -- e.g. 'ACME', issue prefix
  logo_url        text
  owner_id        int           NOT NULL FK → users
  created_at      timestamptz   NOT NULL DEFAULT now()
  updated_at      timestamptz   NOT NULL DEFAULT now()
  deleted_at      timestamptz                              -- reserved, not used in v1
  INDEX (owner_id)

workspace_counters
  workspace_id    int           PRIMARY KEY FK → workspaces ON DELETE CASCADE
  last_issue_seq  int           NOT NULL DEFAULT 0
  -- updated in the same transaction as `issues` insert to allocate `seq`

workspace_members
  id              serial PK
  workspace_id    int           NOT NULL FK → workspaces ON DELETE CASCADE
  user_id         int           NOT NULL FK → users      ON DELETE CASCADE
  role            varchar(20)   NOT NULL DEFAULT 'member' CHECK role IN ('owner','member')
  joined_at       timestamptz   NOT NULL DEFAULT now()
  UNIQUE (workspace_id, user_id)
  INDEX (user_id)

workspace_invitations
  see §1.6

users
  id              serial PK
  google_id       varchar(255) UNIQUE
  email           varchar(255)  NOT NULL
  name            varchar(255)
  tagline         varchar(140)                          -- NEW
  avatar_url      text
  password_hash   varchar(255)
  active_workspace_id int FK → workspaces               -- NEW: last-used, for "default"
  last_login      timestamptz
  created_at      timestamptz   NOT NULL DEFAULT now()
  updated_at      timestamptz   NOT NULL DEFAULT now()
  deleted_at      timestamptz                           -- NEW
  -- partial unique:
  UNIQUE (email) WHERE deleted_at IS NULL
  -- the global users.role column is REMOVED — replaced by workspace_members.role

projects
  id              serial PK
  workspace_id    int           NOT NULL FK → workspaces ON DELETE CASCADE   -- NEW
  name            varchar(100)  NOT NULL
  description     text
  status          varchar(20)   NOT NULL DEFAULT 'active'  -- 'active' | 'archived' | 'completed'
  color           varchar(10)   NOT NULL DEFAULT '#3B82F6'
  icon            varchar(20)                              -- emoji or icon key
  lead_user_id    int           FK → users               -- previously owner_id; renamed for clarity
  start_date      date
  end_date        date
  created_by      int           FK → users
  created_at      timestamptz   NOT NULL DEFAULT now()
  updated_at      timestamptz   NOT NULL DEFAULT now()
  INDEX (workspace_id, status)
  -- visibility, priority, banner_url, icon_url DROPPED (unused / over-engineered)

milestones
  id              serial PK
  workspace_id    int           NOT NULL FK → workspaces ON DELETE CASCADE   -- NEW
  project_id      int           FK → projects ON DELETE SET NULL              -- now NULLABLE
  name            varchar(120)  NOT NULL
  description     text
  due_date        date
  status          varchar(20)   NOT NULL DEFAULT 'active'  -- 'active' | 'completed' | 'cancelled'
  created_by      int           FK → users
  created_at      timestamptz   NOT NULL DEFAULT now()
  updated_at      timestamptz   NOT NULL DEFAULT now()
  INDEX (workspace_id, status)
  INDEX (project_id) WHERE project_id IS NOT NULL

issues
  id              serial PK
  workspace_id    int           NOT NULL FK → workspaces ON DELETE CASCADE   -- NEW
  seq             int           NOT NULL                                       -- NEW: workspace-scoped, allocated via workspace_counters
  project_id      int           FK → projects ON DELETE SET NULL              -- now NULLABLE
  milestone_id    int           FK → milestones ON DELETE SET NULL
  title           varchar(200)  NOT NULL
  description     text
  status          varchar(20)   NOT NULL DEFAULT 'backlog'  -- 'backlog'|'todo'|'in_progress'|'in_review'|'done'|'cancelled'
  priority        int           NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5)
  assignee_id     int           FK → users ON DELETE SET NULL
  reporter_id     int           FK → users ON DELETE SET NULL
  start_date      date
  due_date        date
  estimated_hours numeric(5,1)
  completed_at    timestamptz                             -- NEW: set when status moves to 'done', cleared on un-done
  cancelled_at    timestamptz                             -- NEW
  created_at      timestamptz   NOT NULL DEFAULT now()
  updated_at      timestamptz   NOT NULL DEFAULT now()
  UNIQUE (workspace_id, seq)
  INDEX (workspace_id, status)
  INDEX (workspace_id, assignee_id)
  INDEX (workspace_id, project_id) WHERE project_id IS NOT NULL
  INDEX (workspace_id, milestone_id) WHERE milestone_id IS NOT NULL
  INDEX (workspace_id, priority)

labels
  id              serial PK
  workspace_id    int           NOT NULL FK → workspaces ON DELETE CASCADE
  name            varchar(50)   NOT NULL
  color           varchar(7)    NOT NULL DEFAULT '#6b7280'
  description     text
  created_by      int           FK → users
  created_at      timestamptz   NOT NULL DEFAULT now()
  UNIQUE INDEX (workspace_id, LOWER(name))

issue_labels
  issue_id  int NOT NULL FK → issues ON DELETE CASCADE
  label_id  int NOT NULL FK → labels ON DELETE CASCADE
  PRIMARY KEY (issue_id, label_id)

issue_watchers
  issue_id  int NOT NULL FK → issues ON DELETE CASCADE
  user_id   int NOT NULL FK → users  ON DELETE CASCADE
  reason    varchar(20) NOT NULL CHECK reason IN ('manual','assigned','reporter')
  created_at timestamptz NOT NULL DEFAULT now()
  PRIMARY KEY (issue_id, user_id)

comments
  id              serial PK
  workspace_id    int           NOT NULL FK → workspaces ON DELETE CASCADE   -- NEW
  parent_type     varchar(20)   NOT NULL CHECK parent_type IN ('issue','milestone','project')   -- NEW
  parent_id       int           NOT NULL                                       -- references issues/milestones/projects by parent_type; integrity in query layer
  user_id         int           FK → users ON DELETE SET NULL
  content         text          NOT NULL                          -- markdown
  mentions        int[]                                            -- NEW: cached @-mention user_ids
  edited_at       timestamptz                                      -- NEW
  created_at      timestamptz   NOT NULL DEFAULT now()
  updated_at      timestamptz   NOT NULL DEFAULT now()
  INDEX (parent_type, parent_id, created_at)
  INDEX (workspace_id, created_at)

attachments
  id              serial PK
  workspace_id    int           NOT NULL FK → workspaces ON DELETE CASCADE   -- NEW
  issue_id        int           NOT NULL FK → issues ON DELETE CASCADE
  filename        varchar(255)  NOT NULL
  file_url        text          NOT NULL
  file_size       int
  mime_type       varchar(100)
  uploaded_by     int           FK → users ON DELETE SET NULL
  created_at      timestamptz   NOT NULL DEFAULT now()
  INDEX (issue_id)

events  (see §1.4 for full spec)

inbox_messages  (see §1.5)

error_events  (see §1.16)

api_tokens
  -- unchanged from current schema

-- DROPPED: transaction_log (replaced by events), project_members (replaced by workspace_members)
-- KEPT FOR ONE RELEASE then dropped: transaction_log + project_members for rollback safety
```

**Total tables:** 13 active (was 11). Two replaced (`transaction_log`→`events`, `project_members`→`workspace_members`), four new (`workspaces`, `workspace_invitations`, `inbox_messages`, `issue_watchers`, `error_events`).

---

## Part III — API surface

Convention: `/api/workspaces/[ws]/...` for workspace-scoped resources. `/api/me/...` for user-scoped resources (inbox, profile, tokens). `/api/auth/...` and `/api/status` are unscoped.

```
# Auth (mostly existing)
POST    /api/auth/register
POST    /api/auth/[...nextauth]               # NextAuth
DELETE  /api/me                                # delete account

# Me / personal
GET     /api/me                                # profile + active workspace
PATCH   /api/me                                # name, tagline, avatar
GET     /api/me/workspaces                     # list workspaces I'm a member of
POST    /api/me/active-workspace               # set active workspace
GET     /api/me/inbox?filter=unread|all&workspace_id=&type=
POST    /api/me/inbox/mark-read                # body: { ids: [] } or { all: true }
POST    /api/me/inbox/archive                  # body: { ids: [] }
GET     /api/me/tokens
POST    /api/me/tokens
DELETE  /api/me/tokens/[id]

# Workspaces
POST    /api/workspaces                        # create
GET     /api/workspaces/[ws]                   # show
PATCH   /api/workspaces/[ws]                   # owner-only: name, logo, slug
DELETE  /api/workspaces/[ws]                   # owner-only
POST    /api/workspaces/[ws]/transfer          # owner-only: { new_owner_user_id }

# Workspace members
GET     /api/workspaces/[ws]/members
GET     /api/workspaces/[ws]/members/[userId]  # achievements
DELETE  /api/workspaces/[ws]/members/[userId]  # owner-only
POST    /api/workspaces/[ws]/leave             # any member

# Invitations
GET     /api/workspaces/[ws]/invitations
POST    /api/workspaces/[ws]/invitations       # owner-only: { email }
DELETE  /api/workspaces/[ws]/invitations/[id]  # owner-only: revoke
POST    /api/invitations/accept                # body: { token } — current user accepts
POST    /api/invitations/decline               # body: { token }

# Projects
GET     /api/workspaces/[ws]/projects?status=&search=&cursor=
POST    /api/workspaces/[ws]/projects
GET     /api/workspaces/[ws]/projects/[id]
PATCH   /api/workspaces/[ws]/projects/[id]
DELETE  /api/workspaces/[ws]/projects/[id]

# Milestones
GET     /api/workspaces/[ws]/milestones?project_id=&status=&search=&cursor=
POST    /api/workspaces/[ws]/milestones
GET     /api/workspaces/[ws]/milestones/[id]
PATCH   /api/workspaces/[ws]/milestones/[id]
DELETE  /api/workspaces/[ws]/milestones/[id]

# Issues
GET     /api/workspaces/[ws]/issues?project_id=&milestone_id=&assignee_id=&status=&label_id=&priority=&search=&cursor=&sort=
POST    /api/workspaces/[ws]/issues
GET     /api/workspaces/[ws]/issues/[id]
PATCH   /api/workspaces/[ws]/issues/[id]
DELETE  /api/workspaces/[ws]/issues/[id]
POST    /api/workspaces/[ws]/issues/[id]/watch
DELETE  /api/workspaces/[ws]/issues/[id]/watch

# Issue children
GET     /api/workspaces/[ws]/issues/[id]/comments
POST    /api/workspaces/[ws]/issues/[id]/comments
PATCH   /api/workspaces/[ws]/issues/[id]/comments/[cid]
DELETE  /api/workspaces/[ws]/issues/[id]/comments/[cid]
POST    /api/workspaces/[ws]/issues/[id]/attachments
DELETE  /api/workspaces/[ws]/issues/[id]/attachments/[aid]
POST    /api/workspaces/[ws]/issues/[id]/labels       # { label_id }
DELETE  /api/workspaces/[ws]/issues/[id]/labels/[lid]

# Labels
GET     /api/workspaces/[ws]/labels
POST    /api/workspaces/[ws]/labels
PATCH   /api/workspaces/[ws]/labels/[id]
DELETE  /api/workspaces/[ws]/labels/[id]

# Activity
GET     /api/workspaces/[ws]/activity?actor=&entity_type=&action=&project_id=&milestone_id=&from=&to=&cursor=

# Analytics
GET     /api/workspaces/[ws]/analytics?view=&id=&from=&to=

# Errors / status (mostly public)
GET     /api/status                            # public
GET     /api/status/errors?cursor=             # public, redacted
GET     /api/status/errors/[id]                # auth, owner of any workspace
POST    /api/errors/client                     # auth, body: client-side error

# Uploads (existing)
POST    /api/upload                            # blob/local-fs upload
```

Pagination: keyset (`cursor`) on `(occurred_at DESC, id DESC)` for activity, `(updated_at DESC, id DESC)` for issues. No offset pagination.

Error format: always `{ error: { code, message, details? } }` with appropriate HTTP status. Codes are stable strings (`workspace_not_found`, `not_a_member`, `email_already_invited`, etc.) so the CLI can branch on them.

---

## Part IV — Phase-by-phase implementation

Each phase ships independently. The current app keeps working between phases — no flag-day deploys.

### Phase 0 — Repo readiness (1 session)

**Goal:** make the rebuild safe.

- [ ] Tag current `main` as `v0-pre-rebuild` for easy diff/rollback reference.
- [ ] Snapshot prod DB if any prod data exists (export via `pg_dump`).
- [ ] Add a `DEV_MODE=true` env flag — the few admin/destructive endpoints check this to allow seed/reset locally.
- [ ] Write `lib/api/handler.ts`: an `apiHandler(handler)` HOC that wraps API routes, catches errors, inserts `error_events` rows, returns the canonical error shape. Used in every new route.
- [ ] Write `lib/api/workspace-context.ts`: parses `[ws]` from URL, loads session, asserts membership, returns `{ workspace, member, role }`. Every workspace-scoped route uses this.
- [ ] Write `lib/db/queries/events.ts`: `recordEvent(tx, event)` for inline use in mutations.
- [ ] Wire `withEvent`/`recordEvent` placeholder so phase-1 migrations can call into it.

Tests: a smoke test that posts a bad request and verifies an `error_events` row gets written.

**Acceptance:** new helpers exist, are unit-tested, but no existing route is rewritten yet.

### Phase 1 — Workspace foundation, no behavioral change yet (1 session)

**Goal:** introduce `workspaces`, `workspace_members`, populate them from existing data without breaking anything.

Migrations:
1. Create `workspaces`, `workspace_members`, `workspace_invitations` tables.
2. Create one "Personal" workspace per existing user: `INSERT INTO workspaces (name, slug, owner_id) SELECT (name || '''s workspace'), lower(replace(email,'@','-')), id FROM users`.
3. Make every existing user a member of their own workspace.
4. For each existing project: derive a workspace assignment. Use this rule:
   - If the project has members other than the owner, create a new shared workspace (`name = project.name + ' workspace'`, owner = project.owner_id) and put all project members in it.
   - Otherwise, attach the project to its owner's Personal workspace.
5. Add `workspace_id` columns to `projects`, `milestones`, `issues`, `comments`, `attachments` (nullable initially), backfill them via joins, then `ALTER ... SET NOT NULL`.
6. Add `labels.workspace_id`, backfill from `projects.workspace_id`. Deduplicate label names per workspace (coalesce + repoint `issue_labels`).
7. Add `users.deleted_at`, `users.tagline`, `users.active_workspace_id`.
8. Replace `users.email` unique constraint with partial unique on `WHERE deleted_at IS NULL`.

After this phase, every existing API route still works as before — we haven't changed any route URL or handler logic yet. Internal queries just have access to `workspace_id` for free.

**Verification:** boot the app, log in, see all old projects/milestones/issues exactly as before. CLI `bk projects ls` returns same results.

**Acceptance:** schema migrated, data backfilled, all current routes pass smoke tests.

### Phase 2 — Workspace-aware API + minimal workspace UI (2 sessions)

**Goal:** route everything through `/api/workspaces/[ws]/...`, but keep the old `/api/projects/...` etc. as compatibility shims that resolve workspace internally.

- [ ] Create new routes under `app/api/workspaces/[ws]/...` for projects/milestones/issues/comments/attachments. Each uses `workspaceContext()` to assert membership.
- [ ] Keep old routes (`/api/projects/[id]`, etc.) as shims that internally look up `project.workspace_id` and call the new handlers. Mark `@deprecated` in code.
- [ ] Add `POST /api/workspaces`, `GET /api/workspaces/[ws]`, `PATCH /api/workspaces/[ws]`, `DELETE /api/workspaces/[ws]`, `POST /api/workspaces/[ws]/transfer`.
- [ ] Add `GET /api/me/workspaces`, `POST /api/me/active-workspace`.
- [ ] Frontend: add workspace switcher to dashboard sidebar (dropdown showing all memberships + "Create workspace" + "Manage workspaces"). Active workspace persists in `users.active_workspace_id` and in a cookie.
- [ ] Frontend: `/dashboard/[ws]/...` route group. Existing `/dashboard/...` routes redirect to `/dashboard/[active-ws-slug]/...`.
- [ ] Frontend: `/dashboard/[ws]/settings/workspace` page (name, logo upload, transfer, delete with confirmation).

**Acceptance:** can create a workspace, switch to it, projects/milestones/issues in it are isolated from other workspaces. Old URLs still work via shim. CLI continues to work against the shims.

### Phase 3 — Members & invitations (1-2 sessions)

**Goal:** invite people to a workspace, accept invitations, manage membership.

- [ ] Migration: `workspace_invitations` table (already created in Phase 1; verify constraints).
- [ ] `POST /api/workspaces/[ws]/invitations` (owner-only). Validates email format. If email belongs to a current member, return `409 already_member`. If a pending invite already exists, return existing token unless `?force=true` (which revokes prior and reissues).
- [ ] `GET /api/workspaces/[ws]/invitations` — list pending/revoked/accepted (paginated).
- [ ] `DELETE /api/workspaces/[ws]/invitations/[id]` — owner-only, sets status=revoked.
- [ ] `POST /api/invitations/accept`, `POST /api/invitations/decline` — current user, validates token + email match + not expired + still pending.
- [ ] Signup hook: after registering, materialize inbox messages for pending invitations matching the new user's email.
- [ ] `GET /api/workspaces/[ws]/members`, `DELETE /api/workspaces/[ws]/members/[userId]`, `POST /api/workspaces/[ws]/leave`.
- [ ] Frontend: `/dashboard/[ws]/members` page. Lists members with role badge, "Invite" button (owner), per-row "Remove" (owner), "Leave workspace" (self).
- [ ] Frontend: an "Accept invitation" flow accessible from inbox once Phase 4 is in. For Phase 3, we can land a basic `/invitations/[token]` page that lets the recipient accept without inbox UI.
- [ ] Events written: `member_added`, `member_removed`, `invitation_created`, `invitation_accepted`, `invitation_revoked`.

**Acceptance:** owner invites alice@example.com; if alice exists she sees an invitation; she accepts; she's a member. If alice doesn't exist, she signs up later and finds the invitation waiting.

### Phase 4 — Events spine + activity page (1-2 sessions)

**Goal:** replace `transaction_log` with `events`. Build the activity page. Migrate undo to use new table.

- [ ] Migration: create `events` table with indexes from §1.4.
- [ ] Refactor every mutation route to call `recordEvent(tx, ...)` in the same transaction. This includes: workspace CRUD, member changes, project/milestone/issue/comment/attachment/label CRUD, status/priority/assignee changes (each gets a distinct `action`).
- [ ] Backfill: from `transaction_log` rows, generate equivalent `events` rows (best-effort, with `meta.migrated_from = 'transaction_log'`). For old rows where workspace_id is unknown, derive it from the target entity.
- [ ] `GET /api/workspaces/[ws]/activity` with filters. Returns `{ data: [...], next_cursor }`.
- [ ] Frontend: `/dashboard/[ws]/activity` page. Filter panel: actor (multi), entity type (multi), action (multi), project, milestone, date range. List grouped by day.
- [ ] Refactor undo: replace lookups against `transaction_log` with `events`. Undo only applies to events where `action ∈ ('created','updated','deleted','assigned','status_changed','priority_changed','milestone_changed','project_changed','labeled','unlabeled')` and the user is the actor. Same 5-undo limit as today (or whatever current behavior is).
- [ ] Keep `transaction_log` table for one more release for rollback safety, but stop writing to it.

**Acceptance:** every mutation produces an event. The activity page renders. Undo still works (now reading from `events`).

### Phase 5 — Inbox + watchers + mentions (2 sessions)

**Goal:** ship the inbox.

- [ ] Migration: create `inbox_messages`, `issue_watchers`.
- [ ] `recordEvent` is enhanced: based on event type, it computes recipients and inserts inbox rows in the same transaction. This is **the** fan-out point.
- [ ] Watcher rules: auto-add reporter on issue create, auto-add assignee on assign, auto-remove on unassign unless watcher reason is `'manual'`.
- [ ] Mention parsing: comment content scanned for `@username` (we'll need a lookup helper — `username` is the email local-part for now). Resolved IDs are stored in `comments.mentions` and `events.meta.mentioned_user_ids`. Each mentioned user gets a `mention` inbox row.
- [ ] Dedup window: 60-second coalescing for `(user_id, entity_id, type)`. Implemented via an upsert that updates `payload` and bumps `created_at` when a matching message younger than 60s exists.
- [ ] `GET /api/me/inbox`, `POST /api/me/inbox/mark-read`, `POST /api/me/inbox/archive`.
- [ ] Frontend: `/dashboard/inbox` (not workspace-scoped; user-scoped). Filter dropdowns: workspace, type, read/unread.
- [ ] Unread badge in sidebar — polls `/api/me/inbox?filter=unread&count_only=true` every 30s while focused.

**Acceptance:** assign an issue to alice → alice has an `assigned` inbox message. Mention `@alice` in a comment → alice gets a `mention` message. Owner invites alice → alice gets `invitation` message. Mark-read updates UI.

### Phase 6 — Labels at workspace scope (1 session)

**Goal:** make labels usable across the workspace, on any issue, including standalone.

- [ ] Migration verified from Phase 1 (labels.workspace_id present, dedup'd).
- [ ] Drop `labels.project_id`. Drop the related index.
- [ ] `GET/POST/PATCH/DELETE /api/workspaces/[ws]/labels`.
- [ ] `POST /api/workspaces/[ws]/issues/[id]/labels`, `DELETE .../labels/[lid]`.
- [ ] Frontend: label manager page `/dashboard/[ws]/settings/labels`. Issue detail panel: label picker.
- [ ] Issue list/kanban: label chips shown.
- [ ] Events: `labeled`, `unlabeled` with `meta.label_id`.

**Acceptance:** create a label, add to two issues across different projects in the same workspace, filter by label in the issues list.

### Phase 7 — Three listing pages with list/kanban/timeline views (3-4 sessions)

**Goal:** rebuild the three main listing pages — projects, milestones, issues — with search, filters, and three views.

This is the biggest visual workload. We do it after the data plumbing is right.

For each of the three pages (`/dashboard/[ws]/projects`, `/dashboard/[ws]/milestones`, `/dashboard/[ws]/issues`):

- [ ] **List view** — paginated table. Sort by any column. Saved sort/filter as URL query params.
- [ ] **Kanban view** — columns by status (issues, milestones) or by quarter (projects, grouped by `end_date` quarter). Drag-and-drop to change status.
- [ ] **Timeline view** — Gantt-style horizontal bars. Issues span `start_date` → `due_date`. Milestones plot as a vertical line on `due_date`. Projects span `start_date` → `end_date`. Library choice: build a simple custom timeline (Gantt libraries are heavy and over-styled); we have date ranges and a horizontal scroller is enough.
- [ ] **Search:** simple ILIKE on name/title/description (Postgres `pg_trgm` index added later if needed).
- [ ] **Filters:** assignee (multi), status (multi), priority (multi), label (multi), project (for issues/milestones), milestone (for issues), date range. Filters persist in URL.
- [ ] **Empty/loading/error states** for each view.
- [ ] **Standalone entities visible**: the issues list shows issues regardless of project/milestone link. A facet shows "No project" / "No milestone" as filter options.

A reasonable build order: issues list → kanban → timeline → milestones (same shape) → projects (same shape). The kanban/timeline components should be parameterized — same component, different field bindings.

**Acceptance:** all three pages have all three views, share filter components, URL-state synced, ~50ms perceived load on a dataset of 1k rows.

### Phase 8 — Per-member achievements (1 session)

**Goal:** member profile pages.

- [ ] `GET /api/workspaces/[ws]/members/[userId]` returns: profile, role, joined_at, counts (issues created/completed/assigned, comments written, current open assignments), last 50 events, 30-day velocity sparkline.
- [ ] Frontend: `/dashboard/[ws]/members/[userId]` page renders all of the above.
- [ ] Linking: clicking a member's avatar anywhere in the workspace navigates here.

**Acceptance:** member page renders without joins to anything outside this workspace, no information leakage from other workspaces.

### Phase 9 — Analytics + PDF export (2 sessions)

**Goal:** the analytics page.

- [ ] `GET /api/workspaces/[ws]/analytics` with full `AnalyticsPayload` (§1.9).
- [ ] Frontend: `/dashboard/[ws]/analytics` page. View selector (workspace/project/milestone/member), date range picker, charts. Recharts for charts.
- [ ] Print view: `/dashboard/[ws]/analytics/print?view=...&id=...&from=...&to=...` — no shell, no nav, print-styled. "Download PDF" opens this in a new window and immediately calls `window.print()`.
- [ ] CSS print stylesheet for clean PDFs (page breaks before each major section, no shadows).
- [ ] Test PDF export from each view.

**Acceptance:** every view + filter combination produces a valid charted page that exports as a clean multi-page PDF via Cmd-P / Save as PDF.

### Phase 10 — Profile and account deletion (1 session)

**Goal:** finish user lifecycle.

- [ ] `GET /api/me`, `PATCH /api/me`.
- [ ] `DELETE /api/me`: implements the deletion algorithm from §1.7. Returns `409 owner_with_members` if there are sole-owner-with-members workspaces; client must transfer first.
- [ ] Frontend: `/dashboard/settings/profile` page (name, tagline, avatar upload).
- [ ] Frontend: `/dashboard/settings/account` page (email read-only, "Delete account" with confirm modal that lists affected workspaces).
- [ ] Frontend: post-signup "Welcome, what should we call you?" prompt for credentials users without a name.
- [ ] Auth: JWT validation checks `users.deleted_at IS NULL`; if not, session is invalid and we redirect to login.

**Acceptance:** delete account → user can sign up again with the same email and is a brand-new user. Their old workspaces (sole-owner) are gone; workspaces where they were a member still exist and show "Deleted user" where the old user appeared.

### Phase 11 — Error tracking + status page (1 session)

**Goal:** ship the public status page.

- [ ] Migration: `error_events` table.
- [ ] Confirm `apiHandler` wrapper (from Phase 0) inserts rows on every uncaught error.
- [ ] `POST /api/errors/client` — accepts client error payloads (level, code, message, stack truncated, route).
- [ ] Top-level Next.js Error Boundary in `app/error.tsx` reports to `/api/errors/client`.
- [ ] `GET /api/status`, `GET /api/status/errors`, `GET /api/status/errors/[id]` (owner-gated).
- [ ] Frontend: `/status` page (public). Three health probes at top, error feed below with pagination.
- [ ] Frontend: `/status/errors/[id]` — full detail for owners only.
- [ ] Sanitization: assert in tests that no `error_events.context` row ever contains keys named `token`, `password`, `cookie`, `authorization`.

**Acceptance:** trip an API to throw → row appears in `error_events`, status page shows redacted summary, owner can drill into full detail.

### Phase 12 — CLI resync (1-2 sessions)

**Goal:** CLI catches up to the new API. See `docs/cli-sync.md` for the standing workflow.

- [ ] Add workspace context to CLI config (`config.json` gains `active_workspace_id`, `active_workspace_slug`).
- [ ] New commands:
  - `bk workspace list|use|show|create`
  - `bk inbox list|read|archive`
  - `bk member list|show <user>`
  - `bk label list|create|delete`
  - `bk issue label add|remove`
  - `bk invite send|list|revoke`
- [ ] Rewire existing commands (`bk project|milestone|issue ...`) to call `/api/workspaces/[ws]/...` using the active workspace.
- [ ] Bump CLI version to `0.2.0`. On startup, ping `/api/version`; if server version requires CLI ≥ 0.2.0 and CLI is older, print upgrade message + exit non-zero.
- [ ] Update `docs/cli-sync.md` worked examples for the new endpoints.
- [ ] Smoke test script (`scripts/cli-smoke.sh`) covering create workspace → invite → accept → create project → issue → comment → mention → assign → kanban move → archive → delete workspace.

**Acceptance:** all existing CLI workflows succeed against the new API. New commands work. Old `/api/projects/[id]` shim is finally removed.

### Phase 13 — Polish, cleanup, performance pass (1-2 sessions)

**Goal:** make it feel professional.

- [ ] Drop `transaction_log` and `project_members` tables (kept since Phase 4 for rollback).
- [ ] Drop `users.role` column.
- [ ] Drop compatibility shim routes (`/api/projects/[id]`, etc.).
- [ ] Add `idx_events_workspace_actor_occurred` if member-page queries are slow.
- [ ] Add `pg_trgm` and `GIN` indexes on `issues.title`, `issues.description`, `projects.name` if search is slow.
- [ ] Lighthouse pass on every page; fix top 3 issues.
- [ ] Empty state design on every list (no projects yet, no milestones, no issues, no labels, no members beyond self, empty inbox, no activity).
- [ ] Keyboard shortcuts: `c` create issue, `g i` go to issues, `g p` projects, `g m` milestones, `g a` activity, `/` search, `?` shortcuts help.
- [ ] Dark/light mode polish (already in place; verify on new pages).

**Acceptance:** the team uses it daily for a sprint and prefers it to Linear for this team's workflow.

---

## Part V — Risks, open questions, sequencing notes

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Migration loses data (e.g. label dedup wrong) | Phase 1 migration runs against a snapshot DB first; we diff row counts pre/post. Original tables (`transaction_log`, `project_members`) survive until Phase 13. |
| Fan-out in `recordEvent` makes mutations slow | Inbox inserts are bounded (≤ N members per workspace). For workspaces > 50 members, the fan-out happens in a separate same-transaction COPY. Measure before optimizing. |
| Print-PDF looks ugly | Phase 9 spends time on the print stylesheet. Test on Chrome + Safari. If unacceptable, drop in `@react-pdf/renderer` for a phase-9.5. |
| Error events table grows unbounded | A weekly cron prunes `error_events` older than 90 days. Implemented in Phase 11. |
| Inbox grows unbounded for active users | Archive UX exists from Phase 5. A monthly cron hard-deletes archived messages > 60 days. |
| CLI breaks for users on stale versions | Version-check ping in Phase 12. Compat shims kept until Phase 13. |
| @-mention parsing edge cases (e.g. emails) | Mentions only match `@<local-part>` where local-part is the email local-part of an existing workspace member. Fall back to silent no-op. |

### Resolved decisions

1. **Mentions stay email-based.** No username column. When the user types `@` in a comment box, an autocomplete dropdown queries workspace members and inserts the chosen user's `email` token (rendered nicely in the comment). The parser stores resolved `user_id`s in `comments.mentions` so we don't depend on the textual form for lookups later.
2. **Issue identifiers: `WORKSPACE_KEY-<seq>`, workspace-scoped.** Every `workspaces` row has a `key` (3–6 chars, uppercase, alphanumeric, unique). Default derived from the slug; owner-editable. Every `issues` row has a `seq` (int, unique within workspace). Display is always `<workspace.key>-<seq>` (e.g. `ACME-42`) — the number is stable even if the issue moves between projects. Sequence is allocated via a Postgres advisory lock or a per-workspace counter table to avoid gaps under contention. We pick **a counter table** (`workspace_counters(workspace_id, last_issue_seq)`) updated in the same transaction as the insert — predictable, no race.
3. **Polymorphic comments.** `comments` is generalized: `parent_type ∈ ('issue','milestone','project')`, `parent_id` references the right table by convention (enforced in the query layer, not via FK). All existing comments migrate to `parent_type='issue'`. Workspace and project pages get a "Discussion" tab; milestone pages get one too. Attachments and watchers stay issue-only for v1 — there's no real ask for project-level attachments.
4. **No email notifications.** Inbox-only, confirmed.
5. **Polling, not push, for v1.** SWR with focus-revalidate and a 30s inbox-badge poll. Revisit if the team complains about staleness.

### Sequencing notes

- Phases 0–2 must be done in order. After Phase 2, the app is workspace-aware end-to-end.
- Phase 4 (events) blocks Phase 5 (inbox), Phase 8 (achievements), Phase 9 (analytics), Phase 13 (cleanup).
- Phase 5 (inbox) and Phase 3 (invitations) are tightly coupled — invitations create inbox messages. Get the invitation UI to a basic state in Phase 3, then prettify in Phase 5.
- Phase 7 (listings) can be parallelized internally — different team member per view if desired.
- Phase 12 (CLI) should be done before Phase 13 because removing shims breaks an old CLI.

---

## Appendix A — Worked examples of common edge cases

### A.1 User invited by email, signs up later
1. Owner of `acme` invites `bob@new.com`. Row in `workspace_invitations`. No inbox message (no user).
2. Three days later, Bob signs up with `bob@new.com`. In the registration transaction:
   - Insert `users` row.
   - `SELECT * FROM workspace_invitations WHERE LOWER(email) = LOWER('bob@new.com') AND status='pending' AND expires_at > now()`.
   - For each row, insert `inbox_messages` of type `invitation`.
3. Bob signs in, sees the invitation in his inbox, clicks Accept → `workspace_members` row created, invitation status = accepted, event emitted, owner gets `member_added` inbox message.

### A.2 Owner deletes account while owning a workspace with other members
1. Bob is owner of `acme` (members: bob, alice, carol).
2. Bob clicks Delete Account. Client calls `DELETE /api/me`.
3. Server returns `409 owner_with_members` with `{ workspaces: [{ id, name }] }`.
4. UI prompts Bob to transfer ownership. Bob picks Alice.
5. `POST /api/workspaces/<acme>/transfer { new_owner_user_id: alice.id }`. Both alice and bob get inbox messages.
6. Bob retries Delete Account. Now succeeds: his `Personal` workspace is sole-owner-no-members, gets hard-deleted. Acme survives with Alice as owner. Bob's user row is soft-deleted.
7. Acme's members page shows Bob's name with "(deleted)" badge in old comments and the activity feed.

### A.3 Issue with no project, attached to milestone with project P, then filter by project P
1. Alice creates issue `WS-42` with no project, attached to milestone `M` which is in project `P`.
2. Alice opens `/dashboard/[ws]/projects/P`. The page shows tabs "Issues directly in P" and "Issues via milestones of P". The first tab excludes `WS-42`, the second includes it.
3. If Alice goes to "Issues" page and filters `project = P`, she sees only the first tab's contents (direct project membership). To find `WS-42` she'd filter `milestone = M`.
4. This is intentional — the project link on an issue is a deliberate, direct association.

### A.4 Comment mentions a non-member
1. Alice writes "Heads up @bob" in a comment, but Bob is not a member of this workspace.
2. Mention parser tries to resolve `bob` (or `bob@anything`) against `workspace_members(workspace_id=ws) JOIN users(username=...)`. No match → no mention recorded, no inbox message.
3. The literal text `@bob` still renders in the comment, just not as a link.

### A.5 Same person, two workspaces, both have an issue assigned
1. Alice is a member of both `acme` and `personal`.
2. She's assigned issues in both. Both go into her single inbox.
3. Her inbox shows both. Filter dropdown: "All workspaces" (default) | "acme" | "personal".
4. Mark-read marks across whatever filter is active.

---

## Appendix B — Files we'll touch (rough map)

For each phase, the files most likely to change:

- **Schema & migrations:** `lib/db/schema.ts`, `lib/db/migrations/00xx_*.sql`, `lib/db/migrations/meta/_journal.json`.
- **Query layer:** `lib/db/queries/<entity>.ts` for each entity; new files for `workspaces.ts`, `members.ts` (rewritten), `invitations.ts`, `events.ts`, `inbox.ts`, `errors.ts`, `analytics.ts` (rewritten).
- **API:** `app/api/workspaces/[ws]/...` (new tree), `app/api/me/...`, `app/api/status/...`, `app/api/invitations/...`. Existing `app/api/projects/...` etc. become shims, then deleted in Phase 13.
- **Dashboard pages:** `app/dashboard/[ws]/...` (new tree), `app/dashboard/inbox/`, `app/dashboard/settings/`, `app/status/`.
- **Components:** `components/listings/{List,Kanban,Timeline}View.tsx` (shared, parameterized), `components/inbox/`, `components/workspace-switcher.tsx`, `components/labels/`.
- **CLI:** `cli/internal/client/client.go` + `types.go` (most of the work), `cli/internal/commands/{workspace,inbox,member,label,invite}.go` (new), updates to existing commands.
- **Docs:** this doc, `docs/cli-sync.md` (worked-example updates), `README.md` (high-level overview refresh).

---

## Appendix C — What we are NOT building (yet)

To stay honest about scope. These are deliberate omissions for v1; we may revisit.

- Email notifications
- Webhooks / outgoing integrations
- WebSocket / real-time push
- Full-text search beyond ILIKE
- Saved views / custom filters as first-class entities
- Issue templates
- Sub-issues / parent-child issues beyond the milestone link
- Slash commands in comments
- Mobile app
- SAML / SSO beyond Google
- Multi-language / i18n
- Per-project private projects (use a separate workspace)
- Cycle / sprint as a first-class entity (milestones cover this)
- Roadmap view
- Recurring issues
- Time tracking (we keep `estimated_hours` but no log)

If something here turns out to be a must-have, it gets a phase 14+ and a write-up here first.

---

*End of plan v1.*
