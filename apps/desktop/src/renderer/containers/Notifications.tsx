import { useEffect, useState } from 'react'
import type { Hours, NotificationPermission, NotifyTag } from '@juno/contract'
import { getNotificationPermission, notificationSettingsAtom, notificationsPageAtom, openNotificationSettings, registry, requestNotificationPermission, restoreSlackSchedule, sendTestNotification, setHours, setHoursDay, setMatters, setSlackSchedule } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { NotificationsPage as NotificationsPageView, type HoursKind } from '@juno/views'
import { setNotifyLevel } from './notifyActions'

function changeHours(which: HoursKind, hours: Partial<Hours>): void {
  setHours(registry, which, hours)
}

function changeSlackSchedule(enabled: boolean): void {
  setSlackSchedule(registry, enabled)
}

function restoreSlack(): void {
  void restoreSlackSchedule(registry)
}

function saveMatters(text: string): void {
  setMatters(registry, text)
}

/** A tag's x: back to When it matters, with Undo. */
function remove(tag: NotifyTag): void {
  setNotifyLevel({ kind: tag.kind, id: tag.id }, 'matters', tag.kind === 'channel' && tag.channelKind !== 'im' && tag.channelKind !== 'mpim' ? `#${tag.name}` : tag.name)
}

/** The last answer, so the page opens again with it and nothing moves while main answers. */
let lastPermission: NotificationPermission | undefined

/**
 * Whether macOS lets Juno notify, asked when the page opens and again each
 * time the window regains focus, so the line goes once the owner turns
 * notifications on in System Settings and comes back.
 */
function useNotificationPermission(): readonly [NotificationPermission | undefined, () => void] {
  const [permission, setPermission] = useState(lastPermission)
  useEffect(() => {
    let live = true
    const read = () =>
      void getNotificationPermission().then((next) => {
        lastPermission = next
        if (live) setPermission(next)
      })
    read()
    window.addEventListener('focus', read)
    return () => {
      live = false
      window.removeEventListener('focus', read)
    }
  }, [])
  // macOS shows its prompt once. When it does not (an unsigned build), System Settings is the way left.
  const allow = () =>
    void requestNotificationPermission().then((next) => {
      lastPermission = next
      setPermission(next)
      if (next.authorization === 'notDetermined') openNotificationSettings()
    })
  return [permission, allow]
}

/**
 * The Notifications page (SPEC 14): the settings and the page's lists and
 * today from the engine, and macOS's permission from main. Nothing shows
 * until the settings and the permission arrive, which are local and come
 * at once.
 */
export function NotificationsPage() {
  const settings = useAtomValue(notificationSettingsAtom)
  const page = useAtomValue(notificationsPageAtom)
  const [permission, allow] = useNotificationPermission()
  if (settings._tag !== 'Success' || permission === undefined) return null
  const lists = page._tag === 'Success' ? page.value : { every: [], never: [], interrupted: 0, held: 0, today: [], slackSchedule: undefined }
  return (
    <NotificationsPageView
      notificationHours={settings.value.notificationHours}
      presenceHours={settings.value.presenceHours}
      matters={settings.value.matters}
      aiAssist={settings.value.aiAssist}
      every={lists.every}
      never={lists.never}
      interrupted={lists.interrupted}
      held={lists.held}
      today={lists.today}
      onHoursChange={changeHours}
      onDayChange={(which, day, enabled) => setHoursDay(registry, which, day, enabled)}
      slack={{ schedule: lists.slackSchedule, onChange: changeSlackSchedule, onRestore: restoreSlack }}
      onMattersSave={saveMatters}
      onRemove={remove}
      permission={permission}
      onSendTest={sendTestNotification}
      onOpenSettings={openNotificationSettings}
      onAllow={allow}
    />
  )
}
