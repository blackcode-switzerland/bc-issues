// The vocabularies, and the one behaviour that matters when they are wrong.
//
// ---------------------------------------------------------------------------
// WHAT THIS IS FOR, AND WHAT IT DELIBERATELY IS NOT
// ---------------------------------------------------------------------------
// §10.3 of the plan asks for unit coverage of `lib/pipeline.ts`. It is easy to
// write that as "every stage has a label and a colour", which is a test that
// restates the table underneath it: it goes red only when someone deletes a
// field, which `tsc` already prevents, and it teaches the next reader to add a
// line here whenever they add a line there.
//
// The property worth holding is the FALLBACK, because that is where the three
// shipped bugs in this family came from — `check_in` rendered raw, "1 deals",
// "3 whatsapps" — all of which passed typecheck, lint and tests.
//
// ---------------------------------------------------------------------------
// AND WHY THERE IS NO GUARD AGAINST RENDERING AN UNKNOWN VOCABULARY
// ---------------------------------------------------------------------------
// One was considered in Phase 11 and rejected. The vocabularies are served live
// by `bk meta` and can gain a value WITHOUT A DEPLOY, so the value that breaks a
// page does not exist when any static check in this repo runs. A scanner would
// confirm every call site uses a label helper and say nothing about the case
// that actually fails.
//
// So the cure is total rather than detective — `labelOf` humanises anything it
// has never heard of — and this file holds that cure in place. The un-humanised
// version returns the raw value, which is a passing string in every assertion
// that only checks "not empty"; the assertions below check the SHAPE.

import { describe, expect, it } from 'vitest'
import {
  CHANNELS,
  MEETING_TYPES,
  OBJECTION_TYPES,
  STAGES,
  channelLabel,
  meetingTypeLabel,
  objectionTypeLabel,
  stageColor,
  stageLabel,
} from './pipeline'

describe('pipeline vocabularies', () => {
  // Assert the inputs. Every assertion below iterates or looks up, and an empty
  // vocabulary would make all of them pass — CLAUDE.md's corollary and the way
  // finding #5 was caught.
  it('the vocabularies are not empty (guards against a vacuous pass)', () => {
    expect(STAGES.length, 'no stages declared').toBeGreaterThan(0)
    expect(CHANNELS.length, 'no channels declared').toBeGreaterThan(0)
    expect(MEETING_TYPES.length, 'no meeting types declared').toBeGreaterThan(0)
    expect(OBJECTION_TYPES.length, 'no objection types declared').toBeGreaterThan(0)
  })

  it('a known value gets its authored label', () => {
    const first = STAGES[0]
    expect(stageLabel(first.value)).toBe(first.label)
    expect(channelLabel(CHANNELS[0].value)).toBe(CHANNELS[0].label)
  })

  describe('an UNKNOWN value — the case `bk meta` can produce without a deploy', () => {
    // Not a value any vocabulary here holds, and named so it stays that way. If
    // one of these is ever added for real, this test starts asserting the wrong
    // thing loudly rather than quietly — the label would come back authored.
    const UNSEEN = 'quarterly_business_review'

    it('is never rendered raw', () => {
      for (const [name, fn] of [
        ['stage', stageLabel],
        ['channel', channelLabel],
        ['meeting type', meetingTypeLabel],
        ['objection type', objectionTypeLabel],
      ] as const) {
        expect(fn(UNSEEN), `${name} rendered the wire value to a human`).not.toBe(UNSEEN)
      }
    })

    it('is humanised: separators gone, first letter up', () => {
      expect(stageLabel(UNSEEN)).toBe('Quarterly business review')
      expect(stageLabel('check_in')).toBe('Check in')
      expect(stageLabel('re-open')).toBe('Re open')
    })

    it('still gets a colour rather than undefined', () => {
      // A missing colour is a chip with no background, which reads as a render
      // bug rather than as an unrecognised value.
      expect(stageColor(UNSEEN)).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })

  it('null and empty are the em dash, not "Null" and not ""', () => {
    expect(stageLabel(null)).toBe('—')
    expect(stageLabel(undefined)).toBe('—')
    expect(stageLabel('')).toBe('—')
  })
})
