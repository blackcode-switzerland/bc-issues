// Pure helpers only.
//
// The components are deliberately NOT re-exported from here. Every one of them
// carries 'use client', and a barrel that pulls all of them in would drag the
// whole design system into any server component that touched it. Import them by
// subpath instead — `@blackcode/platform-ui/ui/button` — which maps 1:1 to the
// old `@/components/ui/button` and keeps the RSC boundary where it was.
export * from './file-attachment'
export * from './utils'
