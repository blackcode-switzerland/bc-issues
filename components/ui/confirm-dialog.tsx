'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from './modal'

/**
 * Imperative confirm / prompt dialogs — a professional replacement for the
 * native `window.confirm` / `window.prompt`. Mount <ConfirmProvider> once near
 * the app root, then call the promise-based API from anywhere:
 *
 *   const { confirm, prompt } = useConfirm()
 *   if (await confirm({ title: 'Delete project?', destructive: true })) { … }
 *   const url = await prompt({ title: 'Add link', placeholder: 'https://…' })
 */

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button for irreversible / dangerous actions. */
  destructive?: boolean
}

export interface PromptOptions extends ConfirmOptions {
  /** Field label shown above the input. */
  inputLabel?: string
  placeholder?: string
  defaultValue?: string
  inputType?: 'text' | 'url' | 'email'
  /**
   * If set, the confirm button stays disabled until the typed value matches
   * exactly — for "type the name to delete" confirmations.
   */
  requireMatch?: string
}

type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  prompt: (opts: PromptOptions) => Promise<string | null>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return ctx
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const resolverRef = useRef<Pending | null>(null)

  const settle = useCallback((result: boolean | string | null) => {
    const p = resolverRef.current
    if (!p) return
    if (p.kind === 'confirm') (p.resolve as (v: boolean) => void)(result as boolean)
    else (p.resolve as (v: string | null) => void)(result as string | null)
    resolverRef.current = null
    setPending(null)
    setValue('')
    setBusy(false)
  }, [])

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        const p: Pending = { kind: 'confirm', opts, resolve }
        resolverRef.current = p
        setPending(p)
      }),
    []
  )

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        const p: Pending = { kind: 'prompt', opts, resolve }
        resolverRef.current = p
        setValue(opts.defaultValue ?? '')
        setPending(p)
      }),
    []
  )

  const onCancel = useCallback(() => settle(pending?.kind === 'prompt' ? null : false), [pending, settle])

  function onConfirm() {
    if (!pending) return
    if (pending.kind === 'prompt') settle(value.trim() === '' ? null : value.trim())
    else settle(true)
  }

  const opts = pending?.opts
  const isPrompt = pending?.kind === 'prompt'
  const promptOpts = isPrompt ? (pending!.opts as PromptOptions) : null
  const matchOk =
    !promptOpts?.requireMatch || value.trim() === promptOpts.requireMatch
  const confirmDisabled =
    busy || (isPrompt && (!matchOk || (!!promptOpts?.requireMatch === false && value.trim() === '')))

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}
      <Modal
        open={!!pending}
        onClose={onCancel}
        title={opts?.title}
        description={opts?.description}
        widthClass="max-w-sm"
      >
        {opts ? (
          <div className="space-y-4">
            {isPrompt ? (
              <div>
                {promptOpts?.inputLabel ? (
                  <label className="mb-1.5 block text-xs font-medium">{promptOpts.inputLabel}</label>
                ) : null}
                <input
                  autoFocus
                  type={promptOpts?.inputType ?? 'text'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !confirmDisabled) onConfirm()
                  }}
                  placeholder={promptOpts?.placeholder}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary"
              >
                {opts.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                autoFocus={!isPrompt}
                onClick={onConfirm}
                disabled={confirmDisabled}
                className={
                  opts.destructive
                    ? 'inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50'
                    : 'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50'
                }
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                {opts.confirmLabel ?? (opts.destructive ? 'Delete' : 'Confirm')}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </ConfirmContext.Provider>
  )
}
