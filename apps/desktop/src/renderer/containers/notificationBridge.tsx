/**
 * The renderer's side of OS notifications (architecture 11): it tells main
 * which topic is on screen while the window has focus, so the engine does
 * not notify about it, and opens what a clicked notification points at.
 */
import { useEffect } from 'react'
import type { NotificationTarget } from '@juno/contract'
import { activeTab, currentPlace, notificationContentShown, notificationSettingsAtom, onNotificationOpen, setViewing, tabsAtom, tabTopic } from '@juno/state'
import { useAtomMount, useAtomValue } from '@juno/state/react'
import { openHuddle, openTopicAt } from './navigation'

/**
 * A clicked notification: the topic at its message, which flashes, also in a
 * tab that already shows it; or an incoming huddle's tab.
 */
function open(target: NotificationTarget): void {
  if (target._tag === 'huddle') return openHuddle(target.channelId)
  const source = target.source
  openTopicAt(source.topicId, source.ts, { flash: true })
}

/**
 * Keeps the settings subscribed while signed in, so a menu reads the
 * current Notify me choice without waiting, and reports the topic on screen.
 */
export function useNotificationBridge(): void {
  useAtomMount(notificationSettingsAtom)
  const shown = useAtomValue(tabsAtom, (tabs) => {
    const tab = activeTab(tabs)
    return tab === undefined ? undefined : tabTopic(tab)
  })

  const content = useAtomValue(tabsAtom, (tabs) => {
    const tab = activeTab(tabs)
    const kind = tab === undefined ? undefined : currentPlace(tab).kind
    return kind === 'home' || kind === 'topic'
  })
  useEffect(() => { if (content) notificationContentShown() }, [content])
  useEffect(() => onNotificationOpen(open), [])

  useEffect(() => {
    let focused = document.hasFocus()
    let last: string | null | undefined
    const report = () => {
      const next = focused && document.visibilityState === 'visible' ? (shown ?? null) : null
      if (next === last) return
      last = next
      setViewing(next)
    }
    const onFocus = () => {
      focused = true
      report()
    }
    const onBlur = () => {
      focused = false
      report()
    }
    report()
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', report)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', report)
    }
  }, [shown])
}
