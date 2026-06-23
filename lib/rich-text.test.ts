import { describe, it, expect } from 'vitest'
import { toRichTextHtml, upgradeUploadedMedia } from './rich-text'

const BLOB = 'https://abc123.public.blob.vercel-storage.com'

describe('toRichTextHtml — markdown → html', () => {
  it('passes through real HTML unchanged (minus media upgrade)', () => {
    const html = '<p>hi <strong>there</strong></p>'
    expect(toRichTextHtml(html)).toBe(html)
  })

  it('converts markdown to html', () => {
    expect(toRichTextHtml('## Title')).toContain('<h2')
  })

  it('preserves null / undefined / empty', () => {
    expect(toRichTextHtml(null)).toBeNull()
    expect(toRichTextHtml(undefined)).toBeUndefined()
    expect(toRichTextHtml('')).toBe('')
  })

  it('unescapes JSON-escaped newlines when they dominate', () => {
    const out = toRichTextHtml('line one\\nline two')
    expect(out).not.toContain('\\n')
  })
})

describe('upgradeUploadedMedia — uploaded files render inline', () => {
  it('keeps an uploaded image as an <img>', () => {
    const out = upgradeUploadedMedia(`<img src="${BLOB}/1-pic.png" alt="pic">`)
    expect(out).toContain('<img')
    expect(out).toContain(`${BLOB}/1-pic.png`)
  })

  it('promotes an uploaded video link to a file-attachment node', () => {
    const out = upgradeUploadedMedia(`<a href="${BLOB}/1-clip.mp4">clip.mp4</a>`)
    expect(out).toContain('data-type="file-attachment"')
    expect(out).toContain('data-content-type="video/mp4"')
    expect(out).toContain('data-filename="clip.mp4"')
  })

  it('promotes an uploaded video written with image syntax to a player', () => {
    const out = upgradeUploadedMedia(`<img src="${BLOB}/1-clip.mp4" alt="demo">`)
    expect(out).toContain('data-type="file-attachment"')
    expect(out).toContain('data-content-type="video/mp4"')
  })

  it('turns an uploaded pdf link into a download card', () => {
    const out = upgradeUploadedMedia(`<a href="${BLOB}/1-spec.pdf">spec.pdf</a>`)
    expect(out).toContain('data-type="file-attachment"')
    expect(out).toContain('data-content-type="application/pdf"')
  })

  it('handles local-dev /uploads URLs', () => {
    const out = upgradeUploadedMedia('<a href="/uploads/1-doc-ab12cd34.pdf">doc.pdf</a>')
    expect(out).toContain('data-type="file-attachment"')
    expect(out).toContain('application/pdf')
  })

  it('leaves external links untouched', () => {
    const link = '<a href="https://example.com/x.pdf">docs</a>'
    expect(upgradeUploadedMedia(link)).toBe(link)
  })

  it('leaves external images untouched', () => {
    const img = '<img src="https://example.com/a.png" alt="a">'
    expect(upgradeUploadedMedia(img)).toBe(img)
  })
})

describe('toRichTextHtml — end to end embedding', () => {
  it('renders an uploaded image from markdown image syntax', () => {
    const out = toRichTextHtml(`Here: ![diagram](${BLOB}/1-diagram.png)`)
    expect(out).toContain('<img')
    expect(out).toContain(`${BLOB}/1-diagram.png`)
  })

  it('renders an uploaded pdf from a markdown link, alongside prose', () => {
    const out = toRichTextHtml(`See the spec:\n\n[spec.pdf](${BLOB}/1-spec.pdf)`)
    expect(out).toContain('data-type="file-attachment"')
    expect(out).toContain('application/pdf')
    expect(out).toContain('See the spec')
  })

  it('renders an uploaded video from a bare URL (gfm autolink)', () => {
    const out = toRichTextHtml(`${BLOB}/1-demo.mp4`)
    expect(out).toContain('data-type="file-attachment"')
    expect(out).toContain('video/mp4')
  })
})
