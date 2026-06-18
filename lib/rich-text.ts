// Rich-text normalization for stored content (issue/comment/project descriptions,
// project-update bodies).
//
// The app stores rich text as HTML (TipTap) and the display layer sanitizes it
// with DOMPurify on render. But clients other than the web editor — AI agents,
// the CLI, raw API calls — naturally send **Markdown** (or plain text), which
// would otherwise be stored verbatim and render as a literal "## ..." blob.
//
// toRichTextHtml() makes any client "just work":
//   - already HTML (web editor, or a client that sent tags) → passed through
//     unchanged (don't re-sanitize: that could strip TipTap-specific markup like
//     task lists / mentions; the render layer's DOMPurify already protects it).
//   - Markdown / plain text → converted to HTML and sanitized (marked output is
//     predictable, so a generous allowlist is safe).
//   - tolerates agents that JSON-escaped newlines, i.e. sent the two characters
//     "\n" instead of real line breaks.
//
// null/undefined are preserved so callers can distinguish "clear the field" from
// "leave untouched".

import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'blockquote',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'sub', 'sup',
    'code', 'pre',
    'ul', 'ol', 'li',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
    '*': ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Open links safely.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
}

// A string already looks like HTML if it contains an opening tag.
const HTML_TAG_RE = /<[a-z][a-z0-9-]*(\s[^>]*)?\/?>/i

export function toRichTextHtml<T extends string | null | undefined>(input: T): T {
  if (input == null) return input
  let text = String(input)
  if (text.trim() === '') return '' as T

  // Already HTML — trust it; the display layer sanitizes on render.
  if (HTML_TAG_RE.test(text)) return text as unknown as T

  // Markdown / plain text. Tolerate JSON-escaped newlines/tabs (a common agent
  // mistake: sending the literal characters "\n" instead of real line breaks).
  if (!text.includes('\n') && /\\[nrt]/.test(text)) {
    text = text.replace(/\\r\\n|\\r|\\n/g, '\n').replace(/\\t/g, '\t')
  }

  const html = marked.parse(text, { async: false, gfm: true, breaks: true }) as string
  return sanitizeHtml(html, SANITIZE_OPTS) as unknown as T
}
