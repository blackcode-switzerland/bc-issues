// Which workspace does an upload belong to? — this app's binding.
//
// The logic moved to `@blackcode/platform-storage` on 2026-08-06 with
// `/api/upload` (docs/sales-app-plan.md Phase 1b-C). It reads
// `platform.workspaces` and `platform.workspace_members` and there was never
// anything about an issue tracker in it; both upload paths in every app need the
// same answer.
//
// Kept as a binding rather than deleted: attribution is the thing that decides
// which workspace's Storage page a file appears on, and the next person looking
// for it will look under `lib/storage/`.

import { db } from '@/lib/db/client'
import {
  attributeUpload as platformAttributeUpload,
  type UploadAttribution,
} from '@blackcode/platform-storage'
import type { User } from '@/lib/db/schema'

export type { UploadAttribution }

export function attributeUpload(
  user: User,
  explicit?: string | null
): Promise<UploadAttribution> {
  return platformAttributeUpload(db, user, explicit)
}
