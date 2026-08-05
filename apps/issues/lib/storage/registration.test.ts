// This app must actually register its scanner.
//
// The registry fails closed, so a missing registration shows up as refused
// deletes rather than lost files — but "storage cleanup silently stopped
// working" is still a production defect, and the failure mode is an import that
// nobody noticed was needed. This is the test that notices.
//
// It imports `@/lib/storage` exactly the way a route does; the registration is
// that module's import side effect.

import { describe, it, expect } from 'vitest'
import { registeredScannerApps } from '@blackcode/platform-storage'
import { APP_SLUG } from '@/lib/app'
import '@/lib/storage'

describe('storage scanner registration', () => {
  it('registers this app on import of @/lib/storage', () => {
    expect(registeredScannerApps()).toContain(APP_SLUG)
  })
})
