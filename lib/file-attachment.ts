// Single source of truth for the `fileAttachment` rich-text node's wire format.
//
// This markup is touched by two independent places that must agree byte-for-byte:
//   1. The SERVER (lib/rich-text.ts) — emits the node from uploaded urls
//      (upgradeUploadedMedia) and allowlists its tag/attrs in the sanitizer.
//   2. The EDITOR (components/rich-text-editor.tsx) — parses + re-renders the
//      node via a TipTap Node, and allowlists its attrs in the render-layer
//      DOMPurify call.
//
// Keeping the tag, the data-type marker, and the attribute names here means the
// two sides can never drift (the old failure mode: rename a data-* attr on one
// side and stored files silently stop rendering).

export const FILE_ATTACHMENT_TYPE = 'file-attachment'
export const FILE_ATTACHMENT_TAG = 'div'

// data-* attribute names carrying the node's state.
export const FA_ATTR = {
  type: 'data-type',
  url: 'data-file-url',
  filename: 'data-filename',
  contentType: 'data-content-type',
} as const

// Every attribute the node carries — for sanitizer/DOMPurify allowlists on both
// sides.
export const FILE_ATTACHMENT_ATTRS = [
  FA_ATTR.type,
  FA_ATTR.url,
  FA_ATTR.filename,
  FA_ATTR.contentType,
] as const

// CSS selector TipTap uses to recognize the node when parsing stored HTML.
export const FILE_ATTACHMENT_SELECTOR = `${FILE_ATTACHMENT_TAG}[${FA_ATTR.type}="${FILE_ATTACHMENT_TYPE}"]`

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Whether rich-text HTML carries anything postable. Plain `strip tags && trim`
// treats attachment-only content as empty (an <img> or file-attachment <div>
// has no text), which would wrongly disable "Comment"/"Reply"/"Save". So we also
// count embedded media: images, file attachments, and raw audio/video tags.
export function richTextHasContent(html: string | null | undefined): boolean {
  if (!html) return false
  if (html.replace(/<[^>]*>/g, '').trim()) return true
  return new RegExp(`<img\\b|<video\\b|<audio\\b|${FA_ATTR.type}="${FILE_ATTACHMENT_TYPE}"`, 'i').test(html)
}

// Serialize a file-attachment to its canonical stored HTML. The server emits
// this; the editor parses it back via FILE_ATTACHMENT_SELECTOR.
export function renderFileAttachmentHtml(url: string, filename: string, contentType: string): string {
  return (
    `<${FILE_ATTACHMENT_TAG} ${FA_ATTR.type}="${FILE_ATTACHMENT_TYPE}"` +
    ` ${FA_ATTR.url}="${escapeAttr(url)}"` +
    ` ${FA_ATTR.filename}="${escapeAttr(filename)}"` +
    ` ${FA_ATTR.contentType}="${escapeAttr(contentType)}"></${FILE_ATTACHMENT_TAG}>`
  )
}
