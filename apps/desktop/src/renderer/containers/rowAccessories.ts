import type { ReactNode } from 'react'
import type { TopicRow } from '@juno/contract'

/** A mark after a Main row's title, and what it says in the row's description. */
export interface RowAccessory {
  readonly node: ReactNode
  readonly label: string
}

/**
 * The marks features add after a Main row's title (the TopicRow view's
 * `accessory` slot). Each is a hook that every sidebar row calls on every
 * render, in this order; the list never changes at runtime. A hook reads
 * its own per-channel atom and returns undefined, or the same object while
 * nothing changes, so the row stays memoized. The first mark present shows.
 * The huddle glyph goes here.
 */
const rowAccessories: ReadonlyArray<(row: TopicRow | undefined) => RowAccessory | undefined> = []

export function useRowAccessory(row: TopicRow | undefined): RowAccessory | undefined {
  let shown: RowAccessory | undefined
  // Every hook runs on every render, so the hook order holds.
  for (const useAccessory of rowAccessories) {
    const accessory = useAccessory(row)
    if (shown === undefined) shown = accessory
  }
  return shown
}
