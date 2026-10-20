/**
 * The huddle's entries in the seams that load with the app: the sidebar
 * bar's slot, the share sheet's place over the window, the topic header's
 * control and the row glyph. They read only small atoms, so nothing
 * re-renders while no huddle runs; the bar, the share sheet, the header
 * control and the tab are lazy chunks.
 */
import { Suspense, useEffect, useSyncExternalStore } from 'react'
import { useAtomValue } from '@juno/state/react'
import type { HuddleCall, TopicDetail, TopicRow } from '@juno/contract'
import { HuddleIndicator, huddleIndicatorLabel } from '@juno/huddle-views'
import { huddleCallValueAtom, huddleCountAtom } from '@juno/state'
import { SheetLayer } from '@juno/views'
import { chunk, usePreloaded } from '../chunks'
import type { RowAccessory } from '../rowAccessories'
import { closeSharePicker, sharePickerOpen, subscribeSharePicker } from './shareSheet'

const bar = chunk(() => import('./Bar'))
const LazyBar = bar.component((module) => module.default)
const picker = chunk(() => import('./SharePicker'))
const LazyPicker = picker.component((module) => module.default)
const header = chunk(() => import('./Header'))
const LazyHeader = header.component((module) => module.default)

const inCall = (call: HuddleCall | undefined): call is HuddleCall => call !== undefined && (call.phase === 'joining' || call.phase === 'joined')

/** The bar, from Join or Start until the user is out of the huddle. */
export function HuddleBarSlot() {
  const call = useAtomValue(huddleCallValueAtom)
  const active = inCall(call)
  usePreloaded(bar, active)
  if (!active) return null
  return (
    <Suspense fallback={null}>
      <LazyBar call={call} />
    </Suspense>
  )
}

/** The share sheet over the window, while it is open in a call. It closes with the call. */
export function HuddleSharePicker() {
  const active = inCall(useAtomValue(huddleCallValueAtom))
  useEffect(() => {
    if (!active) closeSharePicker()
  }, [active])
  return active ? <SharePickerLayer /> : null
}

function SharePickerLayer() {
  const open = useSyncExternalStore(subscribeSharePicker, sharePickerOpen)
  const ready = usePreloaded(picker, open)
  if (!open || !ready) return null
  return (
    <SheetLayer onClose={closeSharePicker}>
      <LazyPicker />
    </SheetLayer>
  )
}

/** Loads the header control's chunk; the app root calls it after the first paint. */
export const preloadHuddleHeader = (): void => void header.load()

/** The huddle control first in a topic header's right island (Header.tsx decides which). Nothing shows until its chunk is here. */
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
