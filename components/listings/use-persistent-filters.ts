'use client'

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

// Module-scoped, in-memory store. It survives client-side navigation (the module
// stays loaded in the SPA) but is wiped on a full page reload (the module is
// re-evaluated). That's exactly the desired lifetime for listing filters:
// keep them when you open a detail page and come back, reset them on refresh.
const store = new Map<string, unknown>()

function read<T>(key: string, fallback: T): T {
  return store.has(key) ? (store.get(key) as T) : fallback
}

/**
 * Drop-in replacement for useState whose value is remembered across navigation
 * (until a hard reload), keyed by `key`. When `key` changes (e.g. switching
 * workspace) the value re-syncs to that key's stored value, or the initial.
 */
export function usePersistentState<T>(
  key: string,
  initial: T
): [T, Dispatch<SetStateAction<T>>] {
  const initialRef = useRef(initial)
  const [value, setValue] = useState<T>(() => read(key, initialRef.current))
  const keyRef = useRef(key)

  useEffect(() => {
    if (keyRef.current === key) return
    keyRef.current = key
    setValue(read(key, initialRef.current))
  }, [key])

  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValue((prev) => {
        const resolved =
          typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        store.set(keyRef.current, resolved)
        return resolved
      })
    },
    []
  )

  return [value, set]
}
