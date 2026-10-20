/**
 * The renderer's side of OS notifications (architecture 11): it tells main
 * which topic is on screen while the window has focus, so the engine does
 * not notify about it, and opens what a clicked notification points at.
 * Also the why popover, which the message menu opens: Change for a
 * setting's call, Tell Juno for Juno's.
 */
import { useEffect } from 'react'
import type { NotificationTarget } from '@juno/contract'
import { activeTab, currentPlace, notificationContentShown, junoAvailableAtom, notificationSettingsAtom, onNotificationOpen, setViewing, tabsAtom, tabTopic, whyPopoverAtom } from '@juno/state'
import { useAtomMount, useAtomValue } from '@juno/state/react'
import { WhyPopover } from '@juno/views'
import { openHuddle, openTopicAt } from './navigation'
import { tellJunoAbout } from './juno/actions'
import { messageQuote } from './juno/topicContext'
import { changeFromWhy, closeWhy } from './notifyActions'

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

/** Tell Juno: the Juno chat beside the topic with the message quoted, read before the popover closes. */
function tellJuno(topicId: string, ts: string): void {
  const quote = messageQuote(ts)
  closeWhy()
  tellJunoAbout(topicId, quote)
}

/** The why popover, over everything, where the message menu opened. Tell Juno shows only while AI assist is on. */
export function WhyLayer() {
  const popover = useAtomValue(whyPopoverAtom)
  const junoAvailable = useAtomValue(junoAvailableAtom)
  if (popover === undefined) return null
  const { why, at, topicId, ts } = popover
  const action =
    why.action.kind === 'change' || why.action.kind === 'hours'
      ? { label: 'Change' as const, onAction: () => void changeFromWhy(why, at) }
      : why.action.kind === 'juno' && junoAvailable
        ? { label: 'Tell Juno' as const, onAction: () => tellJuno(topicId, ts) }
        : undefined
  return <WhyPopover at={at} title={why.title} reason={why.reason} {...(action === undefined ? {} : { action })} onClose={closeWhy} />
}

