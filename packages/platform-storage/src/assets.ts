// "Is this URL one of ours?" — the recognizer, and nothing else.
//
// Two independent subsystems must agree on this question byte-for-byte:
//   1. EMBEDDING — the rich-text layer only upgrades our own upload URLs into
//      inline media; an external link stays a plain link.
//   2. CLEANUP — the reference scanners only count our own URLs, and the GC only
//      ever deletes bytes behind one.
//
// If the two ever disagreed, a file could be embedded and then not seen by the
// scan that protects it. That is the failure this module exists to make
// impossible, which is why it is one function in one place with no dependencies.
//
// It is app-agnostic on purpose: every app uploads into the same Blob store
// (PLATFORM-ARCHITECTURE.md §4.1), so the host test is a platform fact.

// True only for URLs that came out of OUR upload pipeline — Vercel Blob in
// production or the /uploads static dir in local dev.
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

// Matches absolute (blob) URLs and local /uploads paths. The character class
// stops at whitespace and the delimiters that wrap a URL in Markdown/HTML
// (quotes, angle brackets, parentheses, square brackets), so a URL embedded as
// ![](url), <img src="url">, or data-file-url="url" is captured cleanly. Our
// stored URLs only ever contain [A-Za-z0-9._/:-] plus the blob host, so this
// never over-captures.
const URL_RE = /(?:https?:\/\/[^\s"'<>()[\]]+|\/uploads\/[^\s"'<>()[\]]+)/gi

// Pull every distinct our-origin upload URL out of a body of text/HTML.
export function extractUploadedUrls(text: string | null | undefined): string[] {
  if (!text) return []
  const found = new Set<string>()
  const matches = text.match(URL_RE)
  if (matches) {
    for (let m of matches) {
      // Trim trailing prose punctuation that can cling to a bare URL.
      m = m.replace(/[.,;:!?]+$/, '')
      if (isUploadedAsset(m)) found.add(m)
    }
  }
  return [...found]
}
