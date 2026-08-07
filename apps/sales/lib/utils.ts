// `cn` — the class merger every shadcn-generated component imports from
// `@/lib/utils` (see components.json's aliases).
//
// Re-exported from `@blackcode/platform-ui` rather than reimplemented: the
// package's own primitives already use that copy, and two `cn`s in one bundle is
// two `tailwind-merge` configurations that can disagree about which of two
// conflicting classes wins.
export { cn } from '@blackcode/platform-ui/utils'
