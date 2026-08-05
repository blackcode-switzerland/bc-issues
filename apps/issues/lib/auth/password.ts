// Moved to @blackcode/platform-auth in Phase 6 — hashing and the validators are
// identical for every app, and letting each one pick its own cost factor would
// mean the weakest app sets the real floor for one shared `platform.users`.
//
// Re-exported here so every existing `@/lib/auth/password` import keeps working;
// there is no second implementation, only a second name for the same one.
export {
  hashPassword,
  verifyPassword,
  validatePassword,
  validateEmail,
} from '@blackcode/platform-auth'
