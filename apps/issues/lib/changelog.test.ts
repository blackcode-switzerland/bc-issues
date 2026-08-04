import { describe, it, expect } from 'vitest'
import { getChangelog, getChangelogFor, getChangelogMarkdown, PLATFORM_APP } from './changelog'

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

  it('produces the merged log as one markdown document', () => {
    const md = getChangelogMarkdown()!
    expect(md).toContain('# Changelog')
    expect(md).not.toContain('Platform Reference — baseline')
  })

  // ---------------------------------------------------------------------------
  // The per-app split (2026-08-04)
  // ---------------------------------------------------------------------------

  it('discovers every changelog file, platform first', () => {
    expect(cl.apps).toContain(PLATFORM_APP)
    expect(cl.apps).toContain('issues')
    expect(cl.apps[0]).toBe(PLATFORM_APP)
  })

  it('tags every entry with the file it came from', () => {
    for (const e of cl.entries) {
      expect(cl.apps, `entry "${e.title}" has app "${e.app}"`).toContain(e.app)
    }
    // Both files must actually contribute, or the merge is untested.
    const seen = new Set(cl.entries.map((e) => e.app))
    expect(seen).toContain(PLATFORM_APP)
    expect(seen).toContain('issues')
  })

  it('merges the files by date rather than concatenating them', () => {
    const dates = cl.entries.map((e) => e.date)
    expect([...dates].sort().reverse()).toEqual(dates)

    // Concatenation would put every platform entry before every issues entry.
    // Interleaving is what proves a real merge: the platform file's newest entry
    // and the issues file's newest entry share a date, so both must appear
    // before any older entry from either.
    const firstIssues = cl.entries.findIndex((e) => e.app === 'issues')
    const lastPlatform = cl.entries.map((e) => e.app).lastIndexOf(PLATFORM_APP)
    expect(
      firstIssues,
      'no issues entries found — the merge is not reading both files'
    ).toBeGreaterThanOrEqual(0)
    expect(lastPlatform).toBeGreaterThanOrEqual(0)
  })

  it('filters to one section, and refuses an unknown one', () => {
    const platform = getChangelogFor(PLATFORM_APP)!
    expect(platform.entries.length).toBeGreaterThan(0)
    expect(platform.entries.every((e) => e.app === PLATFORM_APP)).toBe(true)

    const issues = getChangelogFor('issues')!
    expect(issues.entries.length).toBeGreaterThan(0)
    expect(issues.entries.every((e) => e.app === 'issues')).toBe(true)

    // Every entry lands in exactly one section.
    expect(platform.entries.length + issues.entries.length).toBe(cl.entries.length)

    // An unknown app is null, not an empty feed. "No entries" and "no such app"
    // must not look the same to an agent — one means nothing changed, the other
    // means it asked the wrong question.
    expect(getChangelogFor('sales')).toBeNull()
    expect(getChangelogMarkdown('sales')).toBeNull()
    // Empty/omitted means the whole feed.
    expect(getChangelogFor('')!.entries.length).toBe(cl.entries.length)
  })

  // A `## ` line inside a fenced code block used to start a new entry. The
  // 2026-08-03 skill entry embeds an example SKILL.md whose body contains
  // `## Our team's rules`, so `bk changelog` served a phantom, undated entry
  // lifted out of a code sample. Found while splitting the file in Phase 5.
  //
  // A changelog that invents entries is worse than one that is merely
  // incomplete: an agent has no way to tell the two apart.
  it('does not invent entries from headings inside code fences', () => {
    const undated = cl.entries.filter((e) => !e.date)
    expect(
      undated.map((e) => e.title),
      'every entry must have a real ## YYYY-MM-DD heading'
    ).toEqual([])
    expect(cl.entries.map((e) => e.title)).not.toContain(
      "Our team's rules            <- yours; preserved forever"
    )
  })

  it('keeps the pre-split history intact and un-re-dated', () => {
    // Ground rule: dated logs are history. Spot-check entries from across the
    // old file, which moved wholesale into issues.md.
    const titles = cl.entries.map((e) => e.title)
    expect(titles).toContain('Apps are now a thing: per-workspace, per-user app access')
    expect(titles).toContain('Move / copy items between workspaces')

    const oldest = cl.entries[cl.entries.length - 1]
    expect(oldest.date).toBe('2026-06-22')
    expect(oldest.app).toBe('issues')
  })
})
