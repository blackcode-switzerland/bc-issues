'use client'

// Vocabulary chips — stage, channel, meeting type, objection, next action.
//
// ── THE COLOUR ARRIVES AS A PROP FROM `lib/pipeline.ts`, ALWAYS ─────────────
// Every chip is the same component with a different lookup, and each lookup is
// one of the `…Color()` helpers. That is the whole design: there is exactly one
// place in this app that knows what colour `negotiation` is, and a component
// that wanted to name a hex would have to go through here to do it.
//
// The hex reaches the DOM as an inline `style`, and that is deliberate rather
// than a shortcut around Tailwind. These are DATA values — the vocabulary is
// served live by `bk meta` and can gain a stage without a deploy — so a utility
// class per value would be a class that has to exist before the value does.
// Tailwind cannot generate `bg-[#e08658]` for a string it has never seen; the
// token utilities in `globals.css` cover the CHROME, and this covers the data.
//
// The fill is the colour at low alpha with the colour itself as text, so one hex
// drives both and the chip stays legible in either theme without a second value
// being chosen for dark mode.

import {
  channelColor,
  channelLabel,
  documentKindColor,
  documentKindLabel,
  meetingTypeColor,
  meetingTypeLabel,
  nextActionTypeColor,
  nextActionTypeLabel,
  objectionStatusColor,
  objectionStatusLabel,
  objectionTypeColor,
  objectionTypeLabel,
  productCategoryColor,
  productCategoryLabel,
  stageColor,
  stageLabel,
  templateCategoryColor,
  templateCategoryLabel,
} from '@/lib/pipeline'

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {label}
    </span>
  )
}

/** A bare dot, for a row too dense for a chip. */
export function VocabDot({ color, title }: { color: string; title?: string }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      title={title}
      aria-hidden={title ? undefined : true}
    />
  )
}

export const StageChip = ({ value }: { value: string }) => (
  <Chip label={stageLabel(value)} color={stageColor(value)} />
)

export const ChannelChip = ({ value }: { value: string }) => (
  <Chip label={channelLabel(value)} color={channelColor(value)} />
)

export const MeetingTypeChip = ({ value }: { value: string }) => (
  <Chip label={meetingTypeLabel(value)} color={meetingTypeColor(value)} />
)

export const NextActionChip = ({ value }: { value: string }) => (
  <Chip label={nextActionTypeLabel(value)} color={nextActionTypeColor(value)} />
)

export const ObjectionTypeChip = ({ value }: { value: string }) => (
  <Chip label={objectionTypeLabel(value)} color={objectionTypeColor(value)} />
)

export const ObjectionStatusChip = ({ value }: { value: string }) => (
  <Chip label={objectionStatusLabel(value)} color={objectionStatusColor(value)} />
)

export const ProductCategoryChip = ({ value }: { value: string }) => (
  <Chip label={productCategoryLabel(value)} color={productCategoryColor(value)} />
)

export const TemplateCategoryChip = ({ value }: { value: string }) => (
  <Chip label={templateCategoryLabel(value)} color={templateCategoryColor(value)} />
)

export const DocumentKindChip = ({ value }: { value: string }) => (
  <Chip label={documentKindLabel(value)} color={documentKindColor(value)} />
)
