'use client'

import { motion, AnimatePresence, type Variants } from 'framer-motion'
import { type ReactNode } from 'react'

// ── Shimmer skeleton ──────────────────────────────────────────────────────────

function SkeletonShine() {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(90deg, transparent 0%, oklch(0.5 0 0 / 0.1) 50%, transparent 100%)',
        animation: 'shimmer 1.6s ease-in-out infinite',
      }}
    />
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden rounded bg-secondary/60 ${className ?? ''}`}
    >
      <SkeletonShine />
    </div>
  )
}

// ── Preset skeleton rows ──────────────────────────────────────────────────────

export function IssueSkeletonRow({ i }: { i: number }) {
  const titleW = ['w-56', 'w-48', 'w-64', 'w-52', 'w-44', 'w-60'][i % 6]
  return (
    <div className="flex h-11 items-center gap-2.5 border-b border-border/50 px-3 pl-2">
      <Skeleton className="size-3.5 shrink-0 rounded-sm" />
      <Skeleton className="size-3.5 shrink-0 rounded-sm" />
      <Skeleton className="h-2.5 w-16 shrink-0" />
      <Skeleton className="size-3.5 shrink-0 rounded-sm" />
      <Skeleton className={`h-2.5 flex-1 ${titleW}`} />
      <Skeleton className="size-5 shrink-0 rounded-full" />
      <Skeleton className="h-2.5 w-10 shrink-0" />
    </div>
  )
}

export function MilestoneSkeletonRow({ i }: { i: number }) {
  const titleW = ['w-40', 'w-52', 'w-32', 'w-44', 'w-36', 'w-48'][i % 6]
  return (
    <div className="flex h-12 items-center gap-3 border-b border-border/50 px-6">
      <Skeleton className="size-3.5 shrink-0 rounded-sm" />
      <Skeleton className="size-4 shrink-0 rounded-sm" />
      <Skeleton className={`h-2.5 flex-1 ${titleW}`} />
      <Skeleton className="h-2.5 w-20 shrink-0" />
      <Skeleton className="h-2.5 w-16 shrink-0" />
      <Skeleton className="h-2.5 w-8 shrink-0" />
      <Skeleton className="h-2.5 w-16 shrink-0" />
    </div>
  )
}

export function ProjectSkeletonRow({ i }: { i: number }) {
  const titleW = ['w-40', 'w-52', 'w-36', 'w-44', 'w-48', 'w-32'][i % 6]
  return (
    <div className="flex h-12 items-center gap-3 border-b border-border/50 px-3 pl-2">
      <Skeleton className="size-3.5 shrink-0 rounded-sm" />
      <Skeleton className="size-6 shrink-0 rounded-md" />
      <Skeleton className={`h-2.5 flex-1 ${titleW}`} />
      <Skeleton className="h-2.5 w-20 shrink-0" />
      <Skeleton className="h-2.5 w-20 shrink-0" />
      <Skeleton className="h-2.5 w-16 shrink-0" />
      <Skeleton className="h-2.5 w-16 shrink-0" />
    </div>
  )
}

export function LabelSkeletonRow({ i }: { i: number }) {
  const descW = ['w-40', 'w-56', 'w-32', 'w-48'][i % 4]
  return (
    <div className="flex h-11 items-center gap-3 border-b border-border/50 px-6">
      <Skeleton className="size-3.5 shrink-0 rounded-full" />
      <Skeleton className="h-2.5 w-16 shrink-0" />
      <Skeleton className={`h-2.5 flex-1 ${descW}`} />
      <Skeleton className="h-2.5 w-12 shrink-0" />
    </div>
  )
}

export function TrashSkeletonRow() {
  return (
    <div className="flex h-[62px] items-center gap-3 rounded-lg border border-border px-3">
      <Skeleton className="size-3.5 shrink-0 rounded-sm" />
      <Skeleton className="size-4 shrink-0 rounded-sm" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-2.5 w-48" />
        <Skeleton className="h-2 w-32" />
      </div>
      <Skeleton className="h-7 w-20 shrink-0 rounded-md" />
    </div>
  )
}

// ── Detail page skeleton ──────────────────────────────────────────────────────

export function DetailPageSkeleton({ hasIcon = false }: { hasIcon?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="mx-auto max-w-3xl space-y-4 p-10"
    >
      {hasIcon && <Skeleton className="size-10 rounded-lg" />}
      <Skeleton className="h-8 w-2/3" />
      <div className="space-y-2 pt-1">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
      <div className="space-y-3 pt-4">
        {[['w-20', 'w-32'], ['w-20', 'w-28'], ['w-20', 'w-24']].map(([a, b], i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className={`h-3 ${a}`} />
            <Skeleton className={`h-3 ${b}`} />
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
}: {
  icon: ReactNode
  title: string
  description?: string
  action?: { label: ReactNode; onClick: () => void; loading?: boolean }
  secondaryAction?: { label: string; onClick: () => void }
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="flex select-none flex-col items-center justify-center py-24 text-center"
    >
      <div className="mb-4 rounded-xl border border-border bg-secondary/40 p-4 text-muted-foreground">
        {icon}
      </div>
      <p className="mb-1 text-[15px] font-semibold text-foreground/80">{title}</p>
      {description && (
        <p className="mb-5 max-w-xs text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-1 flex items-center gap-2">
          {action && (
            <button
              onClick={action.onClick}
              disabled={action.loading}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}

// ── Simple fade-in wrapper ────────────────────────────────────────────────────

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut', delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Staggered list variants ───────────────────────────────────────────────────

export const listContainerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.025 } },
}

export const listItemVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
}

export { motion, AnimatePresence }
