// The issues app's Drizzle client.
//
// The connection wiring — Neon vs local driver selection, pooling, the dev-mode
// global cache — lives in @blackcode/platform-db and is identical for every app.
// What is app-specific is the schema: the platform tables plus this app's own,
// which `./schema` already composes.

import { createDb } from '@blackcode/platform-db'
import * as schema from './schema'

export const db = createDb(schema)

export { schema }
