import { describe, expect, it } from 'vitest'
import { parseResolutions, parseSelection } from './parse'

// Unit tests for the trash route body parser — pure, no DB.

describe('parseSelection', () => {
  it('accepts a batch_id', () => {
    expect(parseSelection({ batch_id: 7 })).toEqual({ batchId: 7, items: [], numbered: [] })
  })

  it('accepts an items array', () => {
    const out = parseSelection({ items: [{ type: 'issue', id: 1 }, { type: 'project', id: 2 }] })
    expect(out.batchId).toBeNull()
    expect(out.items).toEqual([
      { type: 'issue', id: 1 },
      { type: 'project', id: 2 },
    ])
  })

  it('rejects an empty selection', () => {
    expect(() => parseSelection({})).toThrow()
    expect(() => parseSelection({ items: [] })).toThrow()
  })

  it('rejects a non-object body', () => {
    expect(() => parseSelection(null)).toThrow()
    expect(() => parseSelection('nope')).toThrow()
  })

  it('rejects an invalid item type', () => {
    expect(() => parseSelection({ items: [{ type: 'widget', id: 1 }] })).toThrow()
  })

  it('rejects a non-integer id', () => {
    expect(() => parseSelection({ items: [{ type: 'issue', id: 'x' }] })).toThrow()
  })

  it('rejects a non-integer batch_id', () => {
    expect(() => parseSelection({ batch_id: 'x' })).toThrow()
  })
})

describe('parseResolutions', () => {
  it('keeps only valid resolution values', () => {
    const out = parseResolutions({
      resolutions: {
        'issue:1': 'restore_parent',
        'issue:2': 'standalone',
        'issue:3': 'garbage',
      },
    })
    expect(out).toEqual({ 'issue:1': 'restore_parent', 'issue:2': 'standalone' })
  })

  it('returns empty for missing/invalid input', () => {
    expect(parseResolutions({})).toEqual({})
    expect(parseResolutions(null)).toEqual({})
    expect(parseResolutions({ resolutions: 'nope' })).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// #number vs row id (1.12.0)
// ---------------------------------------------------------------------------
// The two spellings share one array, and this is the purge path. Every test here
// is about the two never being confused for each other — because the failure is
// not an error, it is deleting a different row than the caller named.
describe('parseSelection — #number vs row id', () => {
  it('routes `number` to numbered and `id` to items, never mixing them up', () => {
    const out = parseSelection({
      items: [
        { type: 'issue', number: 42 },
        { type: 'project', id: 905 },
      ],
    })
    expect(out.numbered).toEqual([{ type: 'issue', number: 42 }])
    expect(out.items).toEqual([{ type: 'project', id: 905 }])
  })

  it('keeps a pre-1.12.0 body working exactly as before', () => {
    // The regression that would have been catastrophic: an installed binary
    // sends row ids, and a server that read them as #numbers would purge
    // whatever happens to be #905. `id` must still mean the row id, forever.
    const out = parseSelection({ items: [{ type: 'issue', id: 905 }] })
    expect(out.items).toEqual([{ type: 'issue', id: 905 }])
    expect(out.numbered).toEqual([])
  })

  it('rejects an item carrying BOTH spellings rather than guessing', () => {
    expect(() => parseSelection({ items: [{ type: 'issue', id: 905, number: 42 }] })).toThrow()
  })

  it('rejects an item carrying neither', () => {
    expect(() => parseSelection({ items: [{ type: 'issue' }] })).toThrow()
  })

  it('rejects a non-positive #number', () => {
    // #numbers start at 1. A 0 or a negative is a client bug, and silently
    // resolving it to nothing would look like "already purged".
    expect(() => parseSelection({ items: [{ type: 'issue', number: 0 }] })).toThrow()
    expect(() => parseSelection({ items: [{ type: 'issue', number: -1 }] })).toThrow()
  })

  it('still rejects a bad type before looking at either spelling', () => {
    expect(() => parseSelection({ items: [{ type: 'comment', number: 1 }] })).toThrow()
  })

  it('accepts a mixed body — a client may address items either way', () => {
    const out = parseSelection({
      items: [
        { type: 'issue', number: 1 },
        { type: 'issue', id: 2 },
        { type: 'task', number: 3 },
      ],
    })
    expect(out.numbered).toHaveLength(2)
    expect(out.items).toHaveLength(1)
  })
})
