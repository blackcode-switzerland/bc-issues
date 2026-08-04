#!/usr/bin/env node
/**
 * postbuild migration gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * `postbuild` used to be a bare `drizzle-kit migrate`. That made `npm run build`
 * write to whatever `DATABASE_URL` happened to resolve to — so the command the
 * migration plan uses as a *verification gate* was in fact a database mutation,
 * and it failed (exit 1) whenever the local Postgres was simply not running.
 * Both were observed on 2026-08-04; see docs/migration/baseline.md §2.
 *
 * So migrations are now opt-in: they run only where `RUN_MIGRATIONS` is set.
 *
 *   Vercel Production  → RUN_MIGRATIONS=1   (migrations run on deploy, as before)
 *   Local / CI / preview → unset            (`npm run build` is a pure build)
 *
 * DO NOT "simplify" this away by deleting the postbuild hook. `devops/release.sh`
 * does not run migrations, so postbuild is the only thing that applies them to
 * production. Removing it stops production migrations silently — which is far
 * worse than the problem this file solves.
 *
 * To run migrations by hand:  npm run db:migrate --workspace=issues
 */
import { spawnSync } from 'node:child_process'

const flag = process.env.RUN_MIGRATIONS

// Explicit opt-out values, so `RUN_MIGRATIONS=0` in a dashboard means what it looks like.
const enabled = flag !== undefined && !['', '0', 'false', 'no', 'off'].includes(flag.toLowerCase())

if (!enabled) {
  console.log(
    '• postbuild: skipping migrations (RUN_MIGRATIONS is not set).\n' +
      '  This is expected for local builds, CI and preview deploys.\n' +
      '  Production sets RUN_MIGRATIONS=1. To migrate by hand: npm run db:migrate --workspace=issues'
  )
  process.exit(0)
}

console.log(`• postbuild: RUN_MIGRATIONS=${flag} — applying Drizzle migrations…`)

const result = spawnSync('npx', ['drizzle-kit', 'migrate'], { stdio: 'inherit', shell: false })

if (result.error) {
  console.error(`✗ postbuild: could not start drizzle-kit — ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  console.error(`✗ postbuild: drizzle-kit migrate failed (exit ${result.status}).`)
  process.exit(result.status ?? 1)
}

console.log('✓ postbuild: migrations applied.')
