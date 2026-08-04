// Unit test for invitation-token generation. No database is touched — the
// import needs DATABASE_URL only because lib/db/client.ts builds a pool at
// module load, and a pool is not a connection.
//
// What this guards is a real, live agent-facing failure found in Phase 4:
// base64url includes `-`, so ~1 in 32 tokens began with one, and `bk invite
// accept -Jx…` died in cobra's flag parser before the request was sent. The CLI
// now reads that argument literally, but only from 1.10.0 on. Not minting the
// token is what protects the binaries already installed — the population that
// cannot be upgraded — so this property has to hold at the source.
import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgres://unit:test@example.invalid/unused'

const { generateInvitationToken } = await import('./invitations')

describe('generateInvitationToken', () => {
  // 1 in 32 would slip through per draw, so a handful of samples proves
  // nothing. 2000 draws makes an unfixed generator fail with probability
  // 1 - (31/32)^2000, which is indistinguishable from certainty.
  const tokens = Array.from({ length: 2000 }, () => generateInvitationToken())

  it('never mints a token cobra would read as a flag', () => {
    const offenders = tokens.filter((t) => t.startsWith('-'))
    expect(offenders, `these tokens start with "-": ${offenders.slice(0, 5).join(', ')}`).toEqual([])
  })

  it('still mints full-length base64url tokens', () => {
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })

  it('is still random — rejecting one leading character is not a fixed prefix', () => {
    // If the fix had clamped the first character instead of redrawing, this set
    // would collapse to one value.
    const firstChars = new Set(tokens.map((t) => t[0]))
    expect(firstChars.size).toBeGreaterThan(30)
    expect(new Set(tokens).size).toBe(tokens.length)
  })
})
