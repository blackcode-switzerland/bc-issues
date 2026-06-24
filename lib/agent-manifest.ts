// Single source of truth for the machine-readable "how to use this
// programmatically" note embedded on every page by <AgentManifest/>
// (components/agent-manifest.tsx).
//
// Keep it TRUE — it is one of the product surfaces covered by the API
// multi-surface sync contract (see CLAUDE.md / AGENTS.md). If the auth header,
// envelope shape, or discovery endpoints change, update this too.

export const AGENT_MANIFEST = {
  project: 'blackcode issues',
  summary:
    'AI-native issue tracker. The same workspace data is available through a web UI, a Go CLI (bk), and an HTTP API.',
  recommended_interface:
    'For programmatic/agent access we recommend the bk CLI over direct HTTP API calls. The CLI wraps the same API but handles auth, JSON-body encoding, pagination, file upload+embed, and gives stable exit codes — which makes agent runs markedly more reliable. The raw HTTP API stays fully supported; reach for it when the CLI cannot cover a case (e.g. an urgent one-off). Not required, just the more dependable path.',
  programmatic_access: {
    api_base: '/api',
    workspace_scoped_routes: '/api/workspaces/{workspace_slug_or_id}/...',
    auth: 'HTTP header — Authorization: Bearer bk_live_<token>',
    get_a_token: 'Mint at /dashboard/settings/tokens, or run: bk login',
    list_envelope: '{ data: [...], next_cursor?: number | null, total?: number }',
    error_envelope: '{ error, code, suggestion?, details? }',
    pagination: 'Most lists (issues, projects, tasks) return everything in one response (no cursor); issues add a total. Only the keyset feeds paginate via ?limit=&?cursor=: activity, trash, super-admin errors.',
    rich_text: 'Description/comment/body fields accept Markdown or HTML (stored as sanitized HTML); send real newlines, not literal \\n. GFM Markdown tables (and HTML <table>) render natively. To embed video/audio, upload it (see file_uploads) and reference the url — raw <iframe> and external (non-uploaded) media are stripped.',
    json_bodies: 'Build request bodies with a real JSON encoder, not string concatenation. Embedded urls and Markdown like ![](url) contain () and special chars that break hand-built JSON/shell strings — encode, then POST the file (e.g. curl --data @body.json).',
    file_uploads:
      'To embed a file/image in a description or comment: (1) POST the file to /api/upload (multipart, field "file") to get back { url }; (2) reference that url in the body with Markdown — an image as ![name](url), any other file as [name](url). The server auto-renders uploaded urls inline (image preview, video/audio player, or download card). Max 100MB. CLI shortcuts: `bk upload <file>` prints the url; `bk issue|task|project create --file ./x` (and `bk issue comment <id> --file ./x`) upload+embed in one step; or reference a local path directly in --description/--description-file (wrap paths with spaces/parens in angle brackets, e.g. [](</abs/my file (2).mp4>)) and the CLI uploads+rewrites it.',
    storage:
      'Editing a file out of a body never deletes the stored bytes (so undo/restore stay safe). But terminal deletes DO free storage automatically: hard-deleting a comment/reply or purging an item from Trash removes the files that content referenced once nothing else references them. A workspace owner can also review/clean everything: GET /api/workspaces/{ws}/storage lists every file with its live references + usage; DELETE /api/workspaces/{ws}/storage/{id} permanently removes a file with reference_count 0 (refused 409 if anything, including a trashed item, still references it). CLI: `bk storage list`, `bk storage rm <id>`, `bk storage attachments`.',
  },
  discovery: {
    context: '/api/meta',
    openapi: '/api/openapi.json',
    docs: '/api/docs',
    changelog: '/docs/api-changelog.md',
  },
  cli: {
    recommended: 'Preferred interface for agents — more reliable than calling the HTTP API directly (see recommended_interface).',
    package: '@blackcode_sa/bc-issues',
    install: 'npm install -g @blackcode_sa/bc-issues',
    login: 'bk login',
    machine_output: 'add --json or -o yaml; set BK_NO_PROMPT=1 for unattended runs',
  },
  for_developers: '/AGENTS.md',
} as const

// Human-readable prose for agents that scrape the raw HTML rather than parse the
// JSON block. Rendered inside an HTML comment at the top of <body>.
export const AGENT_MANIFEST_NOTE = `
blackcode issues — programmatic access
This is a rendered web page, but everything here is also available over an HTTP API and a CLI.
- RECOMMENDED: use the bk CLI rather than calling the HTTP API directly. It wraps the same API but handles auth, JSON encoding, pagination, file upload+embed and stable exit codes, so agent runs are more reliable. The HTTP API stays supported for cases the CLI can't cover — it's a recommendation, not a requirement.
- API base: /api  (tenant data is workspace-scoped under /api/workspaces/{ws}/...)
- Auth: send  Authorization: Bearer bk_live_<token>  (mint at /dashboard/settings/tokens, or run: bk login)
- Start here: GET /api/meta  (your context + the valid status/priority values)
- Full spec: GET /api/openapi.json  (OpenAPI 3.1; human-browsable at /api/docs)
- CLI: npm install -g @blackcode_sa/bc-issues  then  bk login
- Item ids (project/task/issue) are the workspace #number shown in the app — address everything by it; the global db id is never exposed. Breaking changes: /docs/api-changelog.md
- Lists return { data } in one response (issues/projects/tasks aren't paginated; issues add total); only activity/trash/super-admin errors paginate via ?limit=&?cursor= with next_cursor. Errors return { error, code, suggestion?, details? }
- Rich text (descriptions, comments, bodies): send Markdown or HTML; use real newlines, not literal \\n. GFM/HTML tables render natively; embed video/audio by uploading it (raw <iframe>/external media are stripped)
- Files/images: POST to /api/upload (multipart "file") -> { url }, then put the url in the body as ![name](url) (image) or [name](url) (any file); it renders inline. CLI: bk ... create --file ./x
- File storage is tracked per workspace. Deleting a comment/reply or purging from Trash auto-frees referenced files (when nothing else references them); editing a file out of a body never deletes the bytes. Owner review/cleanup: GET /api/workspaces/{ws}/storage (files + references + usage), DELETE /api/workspaces/{ws}/storage/{id}. CLI: bk storage list|rm|attachments
- Build JSON bodies with a real encoder, not string concatenation — urls + Markdown like ![](url) contain () and special chars that break hand-built JSON/shell strings (POST via curl --data @file.json)
- Developer/agent guide: /AGENTS.md
A structured version of this note is in the <script type="application/json" id="agent-manifest"> element on this page.
`.trim()
