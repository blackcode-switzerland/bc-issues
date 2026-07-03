import { describe, it, expect } from 'vitest'
import { getChangelog, getChangelogMarkdown } from './changelog'

describe('changelog', () => {
  const cl = getChangelog()

  it('renders the platform-reference baseline to HTML', () => {
    expect(cl.reference.markdown).toContain('Platform Reference')
    expect(cl.reference.html).toContain('<h1')
    // sanitizer keeps tables + code; strips nothing structural
    expect(cl.reference.html).toContain('<table')
  })

  it('parses dated entries newest-first with a date and title', () => {
    expect(cl.entries.length).toBeGreaterThan(3)
    const first = cl.entries[0]
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(first.title.length).toBeGreaterThan(0)
    // The launch entry should be present and its body rendered.
    const launch = cl.entries.find((e) => e.title.includes('agent-updator'))
    expect(launch).toBeTruthy()
    expect(launch!.html).toContain('/api/changelog')
  })

  it('advertises the CLI versions', () => {
    expect(cl.cli_min_version).toMatch(/^\d+\.\d+\.\d+/)
    expect(cl.cli_latest_version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('produces one combined markdown document (reference first)', () => {
    const md = getChangelogMarkdown()
    expect(md.indexOf('Platform Reference')).toBeLessThan(md.indexOf('# API & CLI Changelog'))
  })
})
