/**
 * The huddle's entries in the seams that load with the app: the sidebar
 * bar's slot, the Main header's control and the row glyph. They read only
 * small atoms, so nothing re-renders while no huddle runs; the bar, the
 * header control and the tab are lazy chunks.
 */
import { Suspense } from 'react'
import { useAtomValue } from '@juno/state/react'
import type { TopicDetail, TopicRow } from '@juno/contract'
import { HuddleIndicator, huddleIndicatorLabel } from '@juno/huddle-views'
import { huddleCallValueAtom, huddleCountAtom } from '@juno/state'
import { chunk, usePreloaded } from '../chunks'
import type { RowAccessory } from '../rowAccessories'

const bar = chunk(() => import('./Bar'))
const LazyBar = bar.component((module) => module.default)
const header = chunk(() => import('./Header'))
const LazyHeader = header.component((module) => module.default)

/** The bar, from Join or Start until the user is out of the huddle. */
export function HuddleBarSlot() {
  const call = useAtomValue(huddleCallValueAtom)
  const active = call !== undefined && (call.phase === 'joining' || call.phase === 'joined')
  usePreloaded(bar, active)
  if (!active) return null
  return (
    <Suspense fallback={null}>
      <LazyBar call={call} />
    </Suspense>
  )
}

/** Loads the header control's chunk; the app root calls it after the first paint. */
export const preloadHuddleHeader = (): void => void header.load()

/** Start, Join, Switch or In huddle, first in a Main's right island. Nothing shows until its chunk is here. */
export function HuddleHeaderAction({ detail }: { readonly detail: TopicDetail }) {
  const ready = usePreloaded(header, true)
  return ready ? <LazyHeader detail={detail} /> : null
}

/** The green headphones after a Main row's title while a huddle runs there. */
export function useHuddleAccessory(row: TopicRow | undefined): RowAccessory | undefined {
  const count = useAtomValue(huddleCountAtom(row?.kind === 'main' ? row.channel.id : ''))
  return count === undefined || count === 0 ? undefined : accessoryFor(count)
}

const accessories = new Map<number, RowAccessory>()
/** One object per count, so a memoized row keeps its props. */
function accessoryFor(count: number): RowAccessory {
  let accessory = accessories.get(count)
  if (accessory === undefined) {
    accessory = { node: <HuddleIndicator count={count} />, label: huddleIndicatorLabel(count) }
    accessories.set(count, accessory)
  }
  return accessory
}
