# Blackcode Issues - Complete Handover Document

**Date:** January 25, 2026  
**Purpose:** Full knowledge transfer for continuing development  
**Live URL:** https://blackcode-issues.vercel.app  
**GitHub:** https://github.com/Drew-source/blackcode-issues

---

## Part 1: The Trinity Architecture

### What is the Trinity?

Three components working together as an AI-augmented development ecosystem:

```
┌─────────────────────────────────────────────────────────────────┐
│                         TRINITY                                  │
│                                                                  │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐      │
│   │  COMPANION  │────►│  BLACKCODE  │◄────│   HUMAN     │      │
│   │   (Brain)   │     │   ISSUES    │     │ (Director)  │      │
│   │             │     │  (Memory)   │     │             │      │
│   └─────────────┘     └─────────────┘     └─────────────┘      │
│         │                    │                    │              │
│         └────────────────────┴────────────────────┘              │
│                              │                                   │
│                    MCP (Nervous System)                         │
└─────────────────────────────────────────────────────────────────┘
```

| Component | Role | Description |
|-----------|------|-------------|
| **Companion** | The Brain | AI assistant with LangGraph, can see screen, take actions, use tools |
| **Blackcode Issues** | The Memory | Persistent task state, project management, issue tracking |
| **Human** | The Director | Guides decisions, sets priorities, approves actions |
| **MCP** | Nervous System | Connects everything via Model Context Protocol |

### The Vision Flow

```
Developer encounters problem
        ↓
Discusses with Companion (AI assistant)
        ↓
Companion captures context + screenshots
        ↓
Creates rich issue in Blackcode Issues
        ↓
Issue tracked with full AI-generated context
        ↓
Later: Companion works on issue
        ↓
Resolves and marks done
```

---

## Part 2: Companion Architecture

### Overview

**Companion** (`C:\Users\Hugo\Documents\Companion`) is a desktop AI assistant built with:
- **Electron** - Desktop shell for native OS access
- **LangGraph** - Python backend for AI orchestration
- **MCP/Composio** - Tool integrations

Unlike web chatbots, Companion can:
- **See your screen** - take screenshots, understand what's happening
- **Take real action** - click, type, drag, scroll via RobotJS
- **Work for hours** - context compression prevents amnesia
- **Extend infinitely** - MCP/Composio integrations

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER                                      │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              DESKTOP APP (Electron)                      │    │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │    │
│  │  │  Renderer   │◄──►│   Preload   │◄──►│    Main     │  │    │
│  │  │  (React UI) │    │ (IPC Bridge)│    │  (Node.js)  │  │    │
│  │  └─────────────┘    └─────────────┘    └──────┬──────┘  │    │
│  └───────────────────────────────────────────────┼─────────┘    │
│                                                  │ WebSocket    │
│                                                  ▼              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              BACKEND SERVER (Python)                     │    │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │    │
│  │  │  FastAPI    │───►│  LangGraph  │───►│   Tools     │  │    │
│  │  │  WebSocket  │    │   Agent     │    │  Execution  │  │    │
│  │  └─────────────┘    └─────────────┘    └─────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                          │                                       │
│                          ▼                                       │
│              ┌─────────────────────┐                            │
│              │  Redis + Postgres   │                            │
│              │  (LangGraph State)  │                            │
│              └─────────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

### LangGraph (The Brain)

LangGraph provides state machine orchestration. The agent is a **graph of nodes**:

```
call_model → decide → tools OR computer_use → loop back
```

**Why LangGraph:**
- **Routing logic** - decide whether to call tools, use Computer Use, or just respond
- **Persistent state** - conversations survive restarts (Redis + Postgres)
- **Interruptible flows** - pause mid-task, resume later

### Computer Use Agent (CUA)

The AI can **use the computer like a human**:

```
1. Screenshot the screen
2. AI analyzes: "I see a button labeled Submit"
3. AI decides: "Click at coordinates (450, 320)"
4. Desktop executes the click (RobotJS)
5. Repeat until task complete
```

### MCP & Composio

**MCP (Model Context Protocol)** + **Composio** enable connecting to any service:
- Gmail, Slack, GitHub, Notion, etc.
- User authorizes once, agent can use forever
- Dynamic tool discovery

### The Four Persistence Systems

| System | Scope | What It Does |
|--------|-------|--------------|
| **Janitor** | Within session | Compresses tool outputs to XML summaries |
| **Compaction** | Within session | Summarizes old conversation messages |
| **User Memories** | Across sessions (per-user) | Remembers personal facts via mem0 + pgvector |
| **Tool Learnings** | Across sessions (global) | Remembers technical discoveries for ALL users |

```
┌─────────────────────────────────────────────────────────┐
│                 WITHIN SESSION                          │
│  ┌─────────────┐          ┌─────────────┐              │
│  │   Janitor   │          │ Compaction  │              │
│  │ (tool data) │          │ (chat data) │              │
│  └─────────────┘          └─────────────┘              │
├─────────────────────────────────────────────────────────┤
│                 ACROSS SESSIONS                         │
│  ┌─────────────┐          ┌─────────────┐              │
│  │   User      │          │    Tool     │              │
│  │  Memories   │          │  Learnings  │              │
│  │ (per-user)  │          │  (global)   │              │
│  └─────────────┘          └─────────────┘              │
└─────────────────────────────────────────────────────────┘
```

### Mission Center

Coordination layer between the chat agent and CUA:
- **Constraints** - human can inject rules ("don't touch production")
- **Storyboard** - current task broken into steps
- **Telemetry** - what CUA is doing right now

### Key Companion Files

| To Start... | Go To |
|-------------|-------|
| The whole app | `START-DEV.bat` |
| Backend only | `aios-langgraph-server/server_cli.py` |
| Desktop only | `aios-desktop-app/src/main/index.ts` |
| Agent personality | `prompts.py` (790+ lines) |
| Computer Use | `nodes/computer_use.py` |
| Master docs | `_agent_context/_ONE_RING.md` |

---

## Part 3: Blackcode Issues (This Project)

### Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | Neon Postgres (serverless) |
| Auth | NextAuth.js with Google OAuth |
| Styling | Tailwind CSS + shadcn/ui patterns |
| State | React Query (@tanstack/react-query) |
| Animations | Framer Motion |
| Drag & Drop | @hello-pangea/dnd |
| Hosting | Vercel |

### Database Schema

```sql
-- Users (synced from Google OAuth)
users: id, google_id, email, name, avatar_url, role ('admin'|'member'), last_login

-- Projects
projects: id, name, description, owner_id, status, created_at, updated_at

-- Project Members (many-to-many)
project_members: project_id, user_id, role ('owner'|'member')

-- Milestones
milestones: id, project_id, name, description, due_date, created_at, updated_at

-- Issues
issues: id, project_id, title, description, status, priority (1-5), 
        assignee_id, reporter_id, milestone_id, 
        start_date, due_date, estimated_hours,
        created_at, updated_at

-- Comments
comments: id, issue_id, user_id, content, created_at

-- Attachments (planned)
attachments: id, issue_id, filename, url, size, created_at

-- Transaction Log (for undo)
transaction_log: id, user_id, operation_type, table_name, record_id, 
                 old_data, new_data, rolled_back, created_at
```

**Issue Statuses:** `backlog`, `todo`, `in_progress`, `blocked`, `in_review`, `done`, `cancelled`

**Priority Levels:** 1 (Urgent), 2 (High), 3 (Medium), 4 (Low), 5 (None)

### File Structure

```
blackcode-issues/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts  # NextAuth handler
│   │   ├── projects/route.ts            # CRUD projects
│   │   ├── projects/[id]/route.ts
│   │   ├── projects/[id]/members/route.ts
│   │   ├── issues/route.ts              # CRUD issues
│   │   ├── issues/[id]/route.ts
│   │   ├── issues/[id]/comments/route.ts
│   │   ├── milestones/route.ts
│   │   ├── users/route.ts
│   │   ├── migrate/route.ts             # DB migrations (admin only)
│   │   ├── seed/route.ts                # Mock data (admin only)
│   │   └── admin/promote/route.ts       # One-time admin bootstrap
│   ├── dashboard/
│   │   ├── layout.tsx                   # Shared sidebar layout
│   │   ├── page.tsx                     # Projects list
│   │   ├── [projectId]/page.tsx         # Project detail (Kanban/Timeline)
│   │   ├── issues/page.tsx              # All Issues list
│   │   ├── issues/[id]/page.tsx         # Issue detail/edit
│   │   └── milestones/page.tsx
│   ├── login/page.tsx
│   └── page.tsx                         # Landing page
├── components/
│   ├── dashboard.tsx                    # Projects grid
│   ├── dashboard-layout.tsx             # Sidebar navigation
│   ├── kanban-board.tsx                 # Drag-drop Kanban view
│   ├── timeline-view.tsx                # Timeline (currently vertical)
│   └── project-view.tsx                 # Wrapper for Kanban/Timeline
├── lib/
│   ├── auth.ts                          # NextAuth config (IMPORTANT)
│   └── db.ts                            # All database functions
```

### CRITICAL: Neon Serverless Compatibility

**THE MOST IMPORTANT THING TO KNOW:**

Neon's serverless driver does NOT work with dynamic SQL queries in production.

**DON'T DO THIS:**
```typescript
const { rows } = await sql.query(`SELECT * FROM issues WHERE id = $1`, [id])
```

**DO THIS INSTEAD:**
```typescript
const { rows } = await sql`SELECT * FROM issues WHERE id = ${id}`
```

All database functions in `lib/db.ts` must use **tagged template literals**, not `sql.query()`. This caused many bugs that were fixed in this session.

### Current Features (Working)

- ✅ Google OAuth login
- ✅ Project CRUD
- ✅ Issue CRUD with Kanban drag-drop (persists correctly now)
- ✅ Issue detail page with edit (title, description, status, priority, assignee, start/due dates)
- ✅ Comments on issues
- ✅ Timeline view (vertical, grouped by day)
- ✅ All Issues page with filters (status, priority, specific assignee)
- ✅ Sidebar navigation across all dashboard pages
- ✅ Role-based access (admin/member)

### Authentication Flow

1. User clicks "Sign in with Google"
2. NextAuth handles OAuth flow
3. `signIn` callback in `lib/auth.ts` upserts user to database
4. `session` callback fetches user's `id` and `role` from database
5. All API routes check `getServerSession(authOptions)` for auth

**Important:** `authOptions` must be imported from `lib/auth.ts`, NOT from the API route file.

### Admin Access

- User id=1 (Andrea Edelman) is the owner/admin
- Admin role set via `/api/admin/promote` (one-time bootstrap, already used)
- Admin-only endpoints: `/api/migrate`, `/api/seed`

### Environment Variables (Vercel)

```
DATABASE_URL=postgres://...@neon.tech/...
NEXTAUTH_URL=https://blackcode-issues.vercel.app
NEXTAUTH_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### Console Commands

```javascript
// Check users and roles
fetch('/api/users').then(r => r.json()).then(console.log)

// Run migrations (admin only)
fetch('/api/migrate', { method: 'POST' }).then(r => r.json()).then(console.log)

// Seed mock data (admin only)
fetch('/api/seed', { method: 'POST' }).then(r => r.json()).then(console.log)

// Promote first user to admin (one-time)
fetch('/api/admin/promote', { method: 'POST' }).then(r => r.json()).then(console.log)
```

### Users

- **Owner:** Andrea Edelman (andrea@blackcode.ch) - id: 1, role: admin
- **Member:** Achmad Bifari (bifariachmad@gmail.com) - id: 7, role: member

---

## Part 4: Remaining Work (Roadmap)

### 1. Gantt Timeline View
**Current:** Vertical timeline grouped by day (like a feed)  
**Needed:** Horizontal Gantt chart with:
- Time axis (dates) across the top
- Issues as horizontal bars showing duration (start_date → due_date)
- Grouped by milestone or status
- Reference image provided shows classic project timeline style

### 2. Project Members Management
**Current:** No UI to manage team members  
**Needed:**
- UI to invite users to projects
- Assign roles (owner/member)
- Remove members
- Show members list in project settings

### 3. Rich Issue Pages
**Current:** Basic text description  
**Needed:**
- Rich text editor (bold, lists, code blocks)
- Image uploads (use Vercel Blob Storage)
- File attachments
- Activity history

### 4. Rich Milestone Pages
**Current:** Basic milestone list  
**Needed:**
- Individual milestone page showing its issues
- Progress bar (% complete)
- Kanban or Gantt view filtered to milestone
- Sortable by project

---

## Part 5: Future Integration

### Blackcode Issues as MCP Server

The goal is to create an **MCP server for Blackcode Issues** that Companion can call:

```
mcps/
└── blackcode-issues/
    └── tools/
        ├── create_issue.json
        ├── update_issue.json
        ├── list_issues.json
        ├── add_attachment.json
        └── ...
```

This would let Companion:
```python
CallMcpTool("blackcode-issues", "create_issue", {
    project_id: 1,
    title: "Login button unresponsive",
    description: "Found during testing...",
    attachments: ["/path/to/screenshot.png"],
    priority: 2
})
```

### Why Rich Issues Matter

Blackcode Issues needs rich content support (images, attachments) because:
1. Companion captures screenshots during conversations
2. AI-generated context should be preserved
3. Conversation excerpts may include code blocks, images
4. Full debugging context needs to travel with the issue

---

## Part 6: Session Summary (Jan 25, 2026)

### Bugs Fixed Today

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Projects not loading | `authOptions` imported from API route | Created `lib/auth.ts` |
| Drag-drop not persisting | `sql.query()` incompatible with Neon | Rewrote to tagged templates |
| Timeline view crashing | Null date handling | Added null safety checks |
| No sidebar on All Issues | Layout not shared | Created `dashboard/layout.tsx` |
| Filters not working | Static button, no state | Added filter dropdown with state |

### Features Added Today

- Shared dashboard layout with sidebar navigation
- Issue detail page with Start/Due date fields
- Database migration system (`/api/migrate`)
- Mock data seeder (`/api/seed`)
- Admin role security on sensitive endpoints
- Assignee filter with specific team members
- Auto-refresh for kanban data consistency

### Key Learnings

1. **Neon serverless requires tagged templates** - `sql.query()` fails silently in production
2. **Next.js 16 App Router** - `params` must be awaited, use `useParams()` in client components
3. **authOptions centralization** - Must be in separate file, not in API route
4. **React Query invalidation** - Must invalidate all related caches after mutations

---

## Quick Reference

| Task | Command/Location |
|------|-----------------|
| Start Blackcode Issues dev | `npm run dev` in blackcode-issues/ |
| Start Companion | `START-DEV.bat` in Companion/ |
| Deploy | Push to GitHub, Vercel auto-deploys |
| Run migration | Console: `fetch('/api/migrate', {method:'POST'})` |
| Check users | Console: `fetch('/api/users').then(r=>r.json())` |
| Companion docs | `Companion/_agent_context/_ONE_RING.md` |

---

*This document contains everything needed to continue development on Blackcode Issues and understand its role in the Trinity architecture with Companion.*
