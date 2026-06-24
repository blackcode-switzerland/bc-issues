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

  it('promotes a raw <video> tag (uploaded asset) to a file-attachment node', () => {
    const out = upgradeUploadedMedia(`<video src="${BLOB}/1-clip.mp4" controls></video>`)
    expect(out).toContain('data-type="file-attachment"')
    expect(out).toContain('data-content-type="video/mp4"')
  })

  it('promotes a <audio> tag with a nested <source> (uploaded asset)', () => {
    const out = upgradeUploadedMedia(
      `<audio controls><source src="${BLOB}/1-song.mp3" type="audio/mpeg"></audio>`
    )
    expect(out).toContain('data-type="file-attachment"')
    expect(out).toContain('data-content-type="audio/mpeg"')
  })

  it('leaves an external <video> untouched', () => {
    const v = '<video src="https://example.com/x.mp4" controls></video>'
    expect(upgradeUploadedMedia(v)).toBe(v)
  })
})

describe('toRichTextHtml — tables', () => {
  it('converts a GFM Markdown table into table HTML', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    const out = toRichTextHtml(md)
    expect(out).toContain('<table')
    expect(out).toContain('<thead')
    expect(out).toContain('<td')
    expect(out).toContain('<th')
  })

  it('keeps editor table HTML (colgroup/col, colspan/rowspan) intact', () => {
    // The web editor / an HTML-sending client posts table markup directly; it
    // takes the HTML pass-through path, so the geometry must survive untouched.
    const html =
      '<table><colgroup><col style="width: 120px"></colgroup><tbody>' +
      '<tr><th colspan="2">Head</th></tr><tr><td rowspan="2">x</td><td>y</td></tr>' +
      '</tbody></table>'
    const out = toRichTextHtml(html)
    expect(out).toContain('colspan="2"')
    expect(out).toContain('rowspan="2"')
    expect(out).toContain('<colgroup')
  })
})

describe('toRichTextHtml — HTML input (direct-API agents sending HTML)', () => {
  it('upgrades an uploaded-asset <a> link inside HTML to a file-attachment node', () => {
    const out = toRichTextHtml(`<p>clip: <a href="${BLOB}/1-demo.mp4">demo</a></p>`)
    expect(out).toContain('data-type="file-attachment"')
    expect(out).toContain('video/mp4')
  })

  it('keeps an uploaded <img> in HTML as an image', () => {
    const out = toRichTextHtml(`<p><img src="${BLOB}/1-pic.png"></p>`)
    expect(out).toContain('<img')
    expect(out).toContain(`${BLOB}/1-pic.png`)
  })

  it('passes a hand-authored file-attachment node through unchanged', () => {
    const node = `<div data-type="file-attachment" data-file-url="${BLOB}/1-a.pdf" data-filename="a.pdf" data-content-type="application/pdf"></div>`
    expect(toRichTextHtml(node)).toBe(node)
  })

  it('treats markdown-with-a-stray-HTML-tag as HTML (no markdown conversion)', () => {
    // A single tag flips the whole string to the HTML path: the "##" stays literal.
    const out = toRichTextHtml('## Heading <b>x</b>')
    expect(out).toContain('## Heading')
    expect(out).not.toContain('<h2')
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
