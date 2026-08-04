import { describe, expect, it } from 'vitest'
import { parseResolutions, parseSelection } from './parse'

// Unit tests for the trash route body parser — pure, no DB.

describe('parseSelection', () => {
  it('accepts a batch_id', () => {
    expect(parseSelection({ batch_id: 7 })).toEqual({ batchId: 7, items: [] })
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
