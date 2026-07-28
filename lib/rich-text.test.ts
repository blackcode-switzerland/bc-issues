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

  it('still parses markdown when it contains only inline HTML', () => {
    // Inline tags must NOT flip the document to the HTML path — Markdown passes
    // raw inline HTML through, so we get both.
    const out = toRichTextHtml('## Heading <b>x</b>')
    expect(out).toContain('<h2')
    expect(out).toContain('<b>x</b>')
  })

  it('strips script and event handlers from client-supplied HTML', () => {
    const out = toRichTextHtml('<p onclick="steal()">hi</p><script>alert(1)</script>')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('<script')
    expect(out).toContain('hi')
  })

  it('strips javascript: hrefs from client-supplied HTML', () => {
    const out = toRichTextHtml('<p><a href="javascript:alert(1)">x</a></p>')
    expect(out).not.toContain('javascript:')
  })
})

describe('toRichTextHtml — angle-bracket placeholders in markdown (regression)', () => {
  // A placeholder like `<clinicId>` used to match the old "any tag" heuristic,
  // which stored the whole document verbatim: no markdown was parsed, newlines
  // collapsed on render, and the placeholder itself was dropped by the browser.
  const md = [
    '## Findings',
    '',
    'The query adds `clinicBranchId != <adminClinicId>` here.',
    '',
    '- first item',
    '- second item',
    '',
    '| Item | State |',
    '| --- | --- |',
    '| #303 | open |',
  ].join('\n')

  it('parses block-level markdown around the placeholder', () => {
    const out = toRichTextHtml(md)
    expect(out).toContain('<h2')
    expect(out).toContain('<ul')
    expect(out).toContain('<table')
  })

  it('keeps the placeholder text visible instead of eating it as a tag', () => {
    const out = toRichTextHtml(md)
    expect(out).toContain('&lt;adminClinicId&gt;')
  })

  it.each(['<uid>', '<clinicId>', '<your-token>', 'Promise<void>'])(
    'is not fooled by %s',
    (placeholder) => {
      expect(toRichTextHtml(`## Title\n\nUse ${placeholder} in the call.`)).toContain('<h2')
    }
  )

  it('keeps an un-backticked placeholder as visible text', () => {
    // Markdown passes raw inline HTML through, so `<void>` outside a code span
    // reaches the sanitizer looking like a tag. It must be escaped, not dropped.
    const out = toRichTextHtml('## Title\n\nReturns Promise<void> always.')
    expect(out).toContain('Promise&lt;void&gt;')
  })

  it('neutralizes active markup on the markdown path (escaped, never live)', () => {
    const out = toRichTextHtml('# Hi\n\n<script>alert(1)</script><iframe src="x"></iframe>')
    // No live tag survives — the markup is escaped to inert text.
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/<iframe/i)
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('<h1')
  })
})

describe('toRichTextHtml — editor HTML survives sanitization losslessly', () => {
  it('keeps task lists (checklists)', () => {
    const html =
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">' +
      '<label><input type="checkbox" checked></label><div><p>done</p></div></li></ul>'
    const out = toRichTextHtml(html)
    expect(out).toContain('data-type="taskList"')
    expect(out).toContain('data-type="taskItem"')
    expect(out).toContain('data-checked="true"')
    expect(out).toContain('<input')
  })

  it('pins task-list inputs to checkboxes', () => {
    const out = toRichTextHtml('<ul data-type="taskList"><li><input type="password"></li></ul>')
    expect(out).not.toContain('password')
    expect(out).toContain('type="checkbox"')
  })

  it('keeps mentions', () => {
    const html = '<p><span data-type="mention" data-id="7" data-label="Ada" class="mention">@Ada</span></p>'
    const out = toRichTextHtml(html)
    expect(out).toContain('data-type="mention"')
    expect(out).toContain('data-id="7"')
    expect(out).toContain('data-label="Ada"')
  })

  it('keeps table column widths', () => {
    const html = '<table><colgroup><col style="width: 120px"></colgroup><tbody><tr><td>x</td></tr></tbody></table>'
    expect(toRichTextHtml(html)).toContain('width')
  })

  it('keeps a file-attachment node', () => {
    const node = `<div data-type="file-attachment" data-file-url="${BLOB}/1-a.pdf" data-filename="a.pdf" data-content-type="application/pdf"></div>`
    const out = toRichTextHtml(node)
    expect(out).toContain('data-type="file-attachment"')
    expect(out).toContain('data-filename="a.pdf"')
    expect(out).toContain(`${BLOB}/1-a.pdf`)
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
