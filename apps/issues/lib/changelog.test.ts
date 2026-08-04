import { describe, it, expect } from 'vitest'
import { getChangelog, getChangelogMarkdown } from './changelog'

describe('changelog', () => {
  const cl = getChangelog()

  it('parses dated entries newest-first with a date and title', () => {
    expect(cl.entries.length).toBeGreaterThan(3)
    const first = cl.entries[0]
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(first.title.length).toBeGreaterThan(0)
  })

  it('renders entry bodies to sanitized HTML', () => {
    const withBody = cl.entries.find((e) => e.markdown.length > 0)
    expect(withBody).toBeTruthy()
    expect(withBody!.html).toContain('<')
    expect(withBody!.html).not.toContain('<script')
  })

  it('advertises the CLI versions', () => {
    expect(cl.cli_min_version).toMatch(/^\d+\.\d+\.\d+/)
    expect(cl.cli_latest_version).toMatch(/^\d+\.\d+\.\d+/)
  })

  // The retired Platform Reference must not come back as a hand-maintained copy
  // of the surface — that is exactly what drifted. It is `bk guide` now, and the
  // payload says so instead of leaving an old client with `undefined`.
  it('no longer serves a platform-reference baseline', () => {
    expect(cl).not.toHaveProperty('reference')
    expect(cl.reference_moved_to).toContain('bk guide')
  })

  it('produces the dated log as one markdown document', () => {
    const md = getChangelogMarkdown()
    expect(md).toContain('# API & CLI Changelog')
    expect(md).not.toContain('Platform Reference — baseline')
  })
})
