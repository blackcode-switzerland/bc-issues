# Blackcode Issues - Feature Implementation Plan

**Generated:** 2026-01-29
**Orchestrator:** @Orchestrator
**Project:** Next.js 16 Issue Tracker with Neon Postgres

---

## Executive Summary

Four major features to implement in parallel tracks:
1. **Gantt Timeline View** - Transform vertical timeline to horizontal Gantt chart
2. **Project Members Management** - UI for team member management (API exists)
3. **Rich Issue Pages** - Rich text editor, file uploads, activity history
4. **Milestone Detail Pages** - Individual milestone pages with filtered views

---

## Wave 0 - Planning Complete

### Current Codebase Analysis

**Tech Stack:**
- Next.js 16.1.4 with TypeScript
- Neon Postgres (serverless) - REQUIRES tagged template literals
- NextAuth 4.x for authentication
- React Query 5.x for data fetching
- Framer Motion for animations
- @hello-pangea/dnd for drag-and-drop
- Tailwind CSS + shadcn/ui patterns

**Key Files:**
- `lib/db.ts` - All database operations using tagged templates
- `components/timeline-view.tsx` - Current vertical timeline (371 lines)
- `components/kanban-board.tsx` - Kanban reference implementation
- `app/api/projects/[id]/members/route.ts` - Members API (complete)
- `app/dashboard/issues/[id]/page.tsx` - Issue detail (553 lines)
- `app/dashboard/milestones/page.tsx` - Milestones list (447 lines)

---

## Feature 1: Gantt Timeline View

### Current State
- Vertical timeline grouped by day
- Issues shown as cards alternating left/right
- Only uses created_at/updated_at dates
- No support for start_date/due_date visualization

### Target State
- Horizontal Gantt chart with time axis
- Issues as horizontal bars (start_date -> due_date)
- Grouping by: milestone, status, assignee
- Interactive: click to open, hover for details
- Time navigation: zoom in/out, pan left/right

### Technical Approach
1. Create new `GanttView` component alongside existing `TimelineView`
2. Keep existing timeline as alternative view option
3. Calculate date range from min(start_date) to max(due_date)
4. Render issues as positioned absolute divs
5. Support issues without dates (show at end with indicator)

### Dependencies Needed
- None - can build with existing stack

### API Changes
- None - existing `getIssuesByProject` returns start_date/due_date

### Implementation Tasks
- [ ] Create `components/gantt-view.tsx`
- [ ] Add date range calculation utilities
- [ ] Implement horizontal bar rendering
- [ ] Add grouping toggle (milestone/status/assignee)
- [ ] Add zoom/pan controls
- [ ] Integrate into project dashboard with view switcher

---

## Feature 2: Project Members Management

### Current State
- API exists: GET/POST/DELETE at `/api/projects/[id]/members`
- No UI for member management
- Members used for assignee dropdown in issues

### Target State
- Members section in project settings/header
- List showing name, email, avatar, role badge
- Invite modal with email input
- Role change dropdown (owner can demote/promote)
- Remove button with confirmation

### Technical Approach
1. Create `ProjectMembersPanel` component
2. Add to project dashboard page or create settings modal
3. Use existing API endpoints
4. Handle errors (user not found, permission denied)

### Dependencies Needed
- None - can build with existing stack

### API Changes
- None - API is complete

### Implementation Tasks
- [ ] Create `components/project-members-panel.tsx`
- [ ] Create invite member modal component
- [ ] Add role change functionality
- [ ] Add remove member with confirmation
- [ ] Integrate into project dashboard

---

## Feature 3: Rich Issue Pages

### Current State
- Plain textarea for description
- Simple text comments
- No file attachments
- No activity history visible

### Target State
- TipTap rich text editor for description
- Image upload via Vercel Blob
- File attachments section
- Activity history from transaction_log

### Technical Approach
1. Add TipTap editor with basic formatting (bold, italic, lists, code)
2. Add Vercel Blob for file storage
3. Create attachments API endpoints
4. Display activity from existing transaction_log

### Dependencies Needed
```json
{
  "@tiptap/react": "^2.x",
  "@tiptap/starter-kit": "^2.x",
  "@tiptap/extension-image": "^2.x",
  "@tiptap/extension-link": "^2.x",
  "@vercel/blob": "^0.x"
}
```

### API Changes
- [ ] Create `app/api/upload/route.ts` for Vercel Blob
- [ ] Create `app/api/issues/[id]/attachments/route.ts`
- [ ] Add attachments table to database (if not exists)

### Database Schema (if needed)
```sql
CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  mime_type VARCHAR(100),
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Implementation Tasks
- [ ] Install TipTap dependencies
- [ ] Create `components/rich-text-editor.tsx`
- [ ] Install @vercel/blob
- [ ] Create upload API route
- [ ] Create attachments API route
- [ ] Add attachments section to issue detail
- [ ] Add activity history panel

---

## Feature 4: Milestone Detail Pages

### Current State
- List view at `/dashboard/milestones`
- Shows milestone cards with progress bars
- No individual milestone pages

### Target State
- Detail page at `/dashboard/milestones/[id]`
- Milestone header with full info
- Issues table/list filtered to milestone
- Mini Kanban view of milestone issues
- Mini Gantt view of milestone issues
- Progress statistics

### Technical Approach
1. Create dynamic route page
2. Fetch milestone with issues
3. Reuse KanbanBoard component with milestone filter
4. Reuse GanttView component with milestone filter

### Dependencies Needed
- Depends on Feature 1 (Gantt view)

### API Changes
- [ ] Add `getMilestoneWithIssues(id)` to lib/db.ts
- [ ] Create or extend `/api/milestones/[id]` to include issues

### Implementation Tasks
- [ ] Create `app/dashboard/milestones/[id]/page.tsx`
- [ ] Add milestone detail API endpoint
- [ ] Create milestone header component
- [ ] Add filtered Kanban view
- [ ] Add filtered Gantt view
- [ ] Add statistics panel

---

## Implementation Waves

### Wave 1 - Parallel Implementation (No Dependencies)
- **Track A:** Feature 1 - Gantt Timeline View
- **Track B:** Feature 2 - Project Members Management
- **Track C:** Feature 3 - Rich Issue Pages (partial - editor only)

### Wave 2 - Dependent Features
- **Track A:** Feature 3 - File uploads and attachments
- **Track B:** Feature 4 - Milestone Detail Pages (depends on Gantt)

### Wave 3 - Integration & Polish
- Connect all features
- Add view switcher to dashboard
- Cross-feature navigation

### Wave 4 - Review
- Security review (file uploads, permissions)
- Performance review (Gantt rendering, large datasets)
- Accessibility review (keyboard navigation, ARIA)

---

## Risk Assessment

### High Risk
- **Vercel Blob setup** - Requires Vercel project config and BLOB_READ_WRITE_TOKEN
- **TipTap HTML storage** - Need to sanitize HTML on save/render

### Medium Risk
- **Gantt performance** - Large number of issues may need virtualization
- **Date handling** - Timezone issues with start_date/due_date

### Low Risk
- **Members UI** - API complete, straightforward UI
- **Milestone pages** - Mostly reusing existing components

---

## Estimated Effort

| Feature | Complexity | Est. Hours | Priority |
|---------|------------|------------|----------|
| Gantt View | High | 8-12 | P1 |
| Members UI | Low | 3-4 | P2 |
| Rich Issues | Medium | 6-8 | P1 |
| Milestone Pages | Medium | 4-6 | P2 |

**Total: 21-30 hours**

---

## Next Steps

1. @Coder agents implement Wave 1 tracks in parallel
2. @Reviewer validates after each track completion
3. Wave 2 begins after Wave 1 review passes
4. Final review with 3 specialized reviewers (Security, Performance, Accessibility)
