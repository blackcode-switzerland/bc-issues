// Rich-text normalization for stored content (issue/comment/project descriptions,
// project-update bodies).
//
// The app stores rich text as HTML (TipTap) and the display layer sanitizes it
// with DOMPurify on render. But clients other than the web editor — AI agents,
// the CLI, raw API calls — naturally send **Markdown** (or plain text), which
// would otherwise be stored verbatim and render as a literal "## ..." blob.
//
// toRichTextHtml() makes any client "just work":
//   - already HTML (web editor, or a client that sent tags) → sanitized and
//     stored. "Already HTML" means it contains a block-level container tag, not
//     merely any `<word>`; see HTML_TAG_RE.
//   - Markdown / plain text → converted to HTML and sanitized (marked output is
//     predictable, so a generous allowlist is safe).
// The sanitizer allowlist covers every construct the TipTap editor emits — task
// lists, mentions, tables (incl. colgroup widths), file-attachment nodes — so
// sanitizing is lossless for editor content in both directions.
//   - tolerates agents that JSON-escaped newlines, i.e. sent the two characters
//     "\n" instead of real line breaks.
//
// On BOTH paths it also runs upgradeUploadedMedia(): a reference to a file that
// was uploaded through our own pipeline (Vercel Blob in prod, /uploads in dev) —
// whether written as a Markdown image `![](url)`, a link `[name](url)`, or a raw
// HTML5 `<video>`/`<audio>` tag — is rewritten into the exact TipTap node the
// editor uses, so it renders inline
// just like a web drag-and-drop (image preview, video/audio player, or a file
// download card). This is what lets the CLI / API embed files without knowing
// any app-specific markup: they only ever send the uploaded URL in Markdown.
//
// null/undefined are preserved so callers can distinguish "clear the field" from
// "leave untouched".

import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import { FILE_ATTACHMENT_ATTRS, renderFileAttachmentHtml } from '@blackcode/platform-ui/file-attachment'

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'blockquote',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'sub', 'sup',
    'code', 'pre',
    'ul', 'ol', 'li',
    // TipTap task-item internals (`<label><input type="checkbox">`).
    'label', 'input',
    'a', 'img',
    // Tables: gfm Markdown emits table/thead/tbody/tr/th/td; the TipTap editor
    // additionally emits colgroup/col (column widths) when resizing is used.
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'style'],
    // The file-attachment node emitted by upgradeUploadedMedia(). These are inert
    // data attributes (no script), and the render layer (DOMPurify) whitelists the
    // same set, so they survive end-to-end.
    div: [...FILE_ATTACHMENT_ATTRS],
    // Table cell/column geometry (inert layout attrs, no script).
    td: ['colspan', 'rowspan', 'colwidth', 'style'],
    th: ['colspan', 'rowspan', 'colwidth', 'style'],
    col: ['span', 'width', 'style'],
    // TipTap task lists: `<ul data-type="taskList">` /
    // `<li data-type="taskItem" data-checked="true"><label><input type=checkbox>`.
    // Without these the checklist markup is stripped and the list degrades to
    // plain bullets on the HTML path.
    ul: ['data-type'],
    li: ['data-type', 'data-checked'],
    input: ['type', 'checked', 'disabled'],
    // TipTap mentions: `<span data-type="mention" data-id data-label>`.
    span: ['data-type', 'data-id', 'data-label', 'data-mention-suggestion-char', 'style'],
    '*': ['class'],
  },
  // Only the inert layout properties the editor actually emits (table column
  // widths, alignment). Anything else in a style attribute is dropped.
  allowedStyles: {
    '*': {
      width: [/^\d+(?:\.\d+)?(?:px|%|em|rem)$/i],
      'min-width': [/^\d+(?:\.\d+)?(?:px|%|em|rem)$/i],
      height: [/^\d+(?:\.\d+)?(?:px|%|em|rem)$/i],
      'text-align': [/^(?:left|right|center|justify)$/i],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Open links safely.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    // `input` exists solely for task-list checkboxes. Pin the type so a client
    // can't smuggle a text/password field into a comment body.
    input: sanitizeHtml.simpleTransform('input', { type: 'checkbox' }, true),
  },
  // Tags dropped together with their text content (rather than unwrapped), so a
  // stripped <script> can't leave its source behind as visible prose.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed', 'noscript'],
}

// Markdown path only. Markdown passes raw inline HTML straight through, so an
// angle-bracket token written in prose rather than in a code span — `<uid>`,
// `Promise<void>` — reaches the sanitizer looking like a tag. Discarding it
// would silently delete text the author typed (the same data loss the block-tag
// fix addressed, one level down), so on this path unrecognized tags are
// **escaped** back into visible text instead.
//
// Note this applies to `<script>` too: in escape mode `nonTextTags` no longer
// removes the content, so a script written in prose shows up as escaped, inert
// text rather than vanishing. That is safe — it is text, not markup, on every
// render path — and it is the honest outcome for what is almost always a code
// example. Nothing executable survives either way.
const MARKDOWN_SANITIZE_OPTS: sanitizeHtml.IOptions = {
  ...SANITIZE_OPTS,
  disallowedTagsMode: 'escape',
}

// Does this string look like an HTML *document* (editor output), as opposed to
// Markdown prose that merely happens to contain an angle-bracket token?
//
// Only BLOCK-level container tags count. The editor always wraps content in one
// of them, while Markdown written by humans and agents routinely contains things
// like `<uid>`, `<clinicId>` or `Promise<void>` — often inside code spans. The
// previous heuristic matched *any* `<word>`, so a single such placeholder flipped
// the whole document to the HTML path: no Markdown was ever parsed, headings /
// lists / tables stayed literal, every newline collapsed to a space, and the
// placeholder itself was silently dropped by the browser as an unknown tag.
//
// Inline tags are deliberately excluded (`<b>`, `<br>`, `<img>`, …): Markdown
// passes raw inline HTML straight through, so those documents get the best of
// both — real Markdown structure *and* their inline tags preserved.
const EDITOR_BLOCK_TAGS = [
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]
const HTML_TAG_RE = new RegExp(`</?(?:${EDITOR_BLOCK_TAGS.join('|')})(?:\\s[^>]*)?/?>`, 'i')

export function toRichTextHtml<T extends string | null | undefined>(input: T): T {
  if (input == null) return input
  let text = String(input)
  if (text.trim() === '') return '' as T

  // Already HTML — don't run it through Markdown. It is still sanitized: the
  // allowlist covers everything the editor emits (task lists, mentions, tables,
  // file-attachment nodes), so a round-trip is lossless, while script/handler
  // markup from a direct API client is stripped here rather than being trusted
  // all the way to the browser. Uploaded-file references are upgraded first so
  // an HTML-sending client gets inline embeds too.
  if (HTML_TAG_RE.test(text)) {
    return sanitizeHtml(upgradeUploadedMedia(text), SANITIZE_OPTS) as unknown as T
  }

  // Markdown / plain text. Tolerate JSON-escaped newlines/tabs (a common agent
  // mistake: sending the literal characters "\n" instead of real line breaks).
  // Unescape when the literal escapes clearly dominate real line breaks — a
  // stray trailing newline (e.g. from --description-file) must not disable it,
  // yet genuinely multi-line Markdown that happens to contain a stray "\n" must
  // not be mangled.
  const literalBreaks = (text.match(/\\r\\n|\\r|\\n/g) || []).length
  const realBreaks = (text.match(/\n/g) || []).length
  if (literalBreaks > realBreaks) {
    text = text.replace(/\\r\\n|\\r|\\n/g, '\n').replace(/\\t/g, '\t')
  }

  let html = marked.parse(text, { async: false, gfm: true, breaks: true }) as string
  html = upgradeUploadedMedia(html)
  return sanitizeHtml(html, MARKDOWN_SANITIZE_OPTS) as unknown as T
}

/* ------------------------- uploaded-media embedding ------------------------- */

// The MIME prefixes that render as inline media (preview / player) rather than a
// download card. This is what FileAttachmentView branches on; exported so
// GET /api/meta can serve the rule live (`media.inline_prefixes`) instead of the
// CLI guide restating it. See lib/limits.ts.
export const INLINE_MEDIA_PREFIXES = ['image/', 'video/', 'audio/'] as const

// Extension → MIME. Used to decide how an uploaded file renders. The prefix
// (image/ video/ audio/) is what the FileAttachmentView branches on; everything
// else becomes a generic download card.
const EXT_MIME: Record<string, string> = {
  // images
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', heic: 'image/heic',
  // video
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v',
  ogv: 'video/ogg', mkv: 'video/x-matroska',
  // audio
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  aac: 'audio/aac', flac: 'audio/flac',
  // common documents / other
  pdf: 'application/pdf', zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json',
}

// True only for URLs that came out of OUR upload pipeline — Vercel Blob in
// production or the /uploads static dir in local dev. We never rewrite arbitrary
// external links into embeds.
export function isUploadedAsset(url: string): boolean {
  if (!url) return false
  if (url.startsWith('/uploads/')) return true
  try {
    const host = new URL(url).hostname
    return host === 'blob.vercel-storage.com' || host.endsWith('.blob.vercel-storage.com')
  } catch {
    return false
  }
}

function extOf(url: string): string {
  const path = url.split(/[?#]/)[0]
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot < 0) return ''
  const ext = base.slice(dot + 1).toLowerCase()
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : ''
}

export function mimeForUrl(url: string): string {
  return EXT_MIME[extOf(url)] || 'application/octet-stream'
}

export function fallbackName(url: string): string {
  const path = url.split(/[?#]/)[0]
  let base = path.slice(path.lastIndexOf('/') + 1)
  try {
    base = decodeURIComponent(base)
  } catch {
    /* keep raw */
  }
  return base || 'file'
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function attachmentNode(url: string, name: string, mime: string): string {
  return renderFileAttachmentHtml(url, name, mime)
}

function imageNode(url: string, alt: string): string {
  return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}">`
}

// Rewrite <a>/<img> tags that point at an uploaded file into the matching TipTap
// node. Safe to run on already-rendered editor HTML: it only touches uploaded
// assets and is a no-op for images that are already images, external links, and
// existing file-attachment nodes.
export function upgradeUploadedMedia(html: string): string {
  // Links: `[name](url)` and GFM autolinks render as <a href="url">name</a>.
  html = html.replace(
    /<a\b[^>]*?\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (whole, href: string, inner: string) => {
      if (!isUploadedAsset(href)) return whole
      const name = inner.replace(/<[^>]+>/g, '').trim() || fallbackName(href)
      const mime = mimeForUrl(href)
      return mime.startsWith('image/') ? imageNode(href, name) : attachmentNode(href, name, mime)
    }
  )
  // Images: `![alt](url)` renders as <img src alt>. A non-image uploaded asset
  // written with image syntax (e.g. a video) is promoted to the right player.
  html = html.replace(/<img\b[^>]*>/gi, (whole) => {
    const src = (whole.match(/\bsrc="([^"]+)"/i) || [])[1] || ''
    if (!isUploadedAsset(src)) return whole
    const mime = mimeForUrl(src)
    if (!mime.startsWith('image/') && mime !== 'application/octet-stream') {
      const alt = (whole.match(/\balt="([^"]*)"/i) || [])[1] || fallbackName(src)
      return attachmentNode(src, alt, mime)
    }
    return whole
  })
  // Native HTML5 media: a client that sends raw <video>/<audio> (e.g. an agent
  // posting HTML) gets the same inline player as a drag-and-drop upload — but
  // only for OUR uploaded assets. The src can be on the tag itself or a nested
  // <source>. External media is left as-is (and the render layer drops it).
  html = html.replace(/<(video|audio)\b[^>]*>([\s\S]*?)<\/\1>/gi, (whole) => {
    const src =
      (whole.match(/<(?:video|audio)\b[^>]*\bsrc="([^"]+)"/i) || [])[1] ||
      (whole.match(/<source\b[^>]*\bsrc="([^"]+)"/i) || [])[1] ||
      ''
    if (!isUploadedAsset(src)) return whole
    return attachmentNode(src, fallbackName(src), mimeForUrl(src))
  })
  return html
}
