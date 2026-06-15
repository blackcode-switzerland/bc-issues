'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  /** max-width tailwind class, e.g. "max-w-md" (default) or "max-w-lg" */
  widthClass?: string
  /** When false, hides the close button and ignores Escape / overlay click. */
  dismissible?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  widthClass = 'max-w-md',
  dismissible = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (dismissible && e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Lock scroll while open
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose, dismissible])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10 backdrop-blur-sm duration-150 animate-in fade-in"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className={`w-full ${widthClass} rounded-xl border border-border bg-popover shadow-2xl shadow-black/20 duration-150 animate-in fade-in zoom-in-95`}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? (
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{title}</h2>
              {description ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
              ) : null}
            </div>
            {dismissible ? (
              <button
                onClick={onClose}
                className="-mr-1 -mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
