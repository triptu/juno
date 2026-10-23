/**
 * Opening Settings › Notifications at one of its parts (SPEC 14): How Auto
 * decides… in the Notify me menu and Notification settings in a why open
 * it at How Auto decides; Edit instructions at Your instructions. The page
 * scrolls there once for each open, also when it is already showing.
 */
import { useSyncExternalStore } from 'react'
import type { NotificationsAnchor } from '@juno/views'
import { openSettings } from './navigation'

let current: { readonly anchor: NotificationsAnchor; readonly key: number } | undefined
/** The last ask the page has scrolled for, so opening the page again later starts at the top. */
let shown = 0
const listeners = new Set<() => void>()
const tell = () => {
  for (const listener of listeners) listener()
}

export function openNotificationsAt(anchor: NotificationsAnchor): void {
  current = { anchor, key: (current?.key ?? 0) + 1 }
  tell()
  openSettings('notifications')
}

/** The part the page was asked to show and has not shown yet, with a key that changes on each ask. */
export function useNotificationsAnchor(): typeof current {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => (current !== undefined && current.key > shown ? current : undefined),
  )
}

/** The page has scrolled to the ask with this key. */
export function notificationsAnchorShown(key: number): void {
  if (key <= shown) return
  shown = key
  tell()
}
