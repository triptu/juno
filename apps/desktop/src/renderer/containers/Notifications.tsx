import { useEffect, useState } from 'react'
import type { Hours, NotificationPermission, NotifyTag } from '@juno/contract'
import { getNotificationPermission, notificationDecisionsAtom, notificationSettingsAtom, notificationsPageAtom, openNotificationSettings, registry, requestNotificationPermission, sendTestNotification, setHours, setHoursDay, setHuddleRing, useJunoHours } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { NotificationsPage as NotificationsPageView, type HoursKind } from '@juno/views'
import { setNotifyLevel } from './notifyActions'

function changeHours(which: HoursKind, hours: Partial<Hours>): void {
  setHours(registry, which, hours)
}

/** Until the page is rebuilt for Notifications v2 (SPEC 14), its schedule switch only offers Use Juno's hours. */
function changeSlackSchedule(): void {
  useJunoHours(registry)
}

function changeHuddleRing(enabled: boolean): void {
  setHuddleRing(registry, enabled)
}

/** A tag's x: back to Auto, with Undo. */
function remove(tag: NotifyTag): void {
  setNotifyLevel({ kind: tag.kind, id: tag.id }, 'auto', tag.kind === 'channel' && tag.channelKind !== 'im' && tag.channelKind !== 'mpim' ? `#${tag.name}` : tag.name)
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
  const decisions = useAtomValue(notificationDecisionsAtom)
  const [permission, allow] = useNotificationPermission()
  if (settings._tag !== 'Success' || permission === undefined) return null
  const lists = page._tag === 'Success' ? page.value : { always: [], never: [], notified: 0, stayed: 0, slackSchedule: undefined }
  const today = decisions._tag === 'Success' ? decisions.value.decisions.filter((row) => row.outcome === 'notify') : []
  return (
    <NotificationsPageView
      notificationHours={settings.value.notificationHours}
      presenceHours={settings.value.presenceHours}
      matters=""
      aiAssist={settings.value.aiAssist}
      every={lists.always}
      never={lists.never}
      interrupted={lists.notified}
      held={lists.stayed}
      today={today}
      onHoursChange={changeHours}
      onDayChange={(which, day, enabled) => setHoursDay(registry, which, day, enabled)}
      slack={{ schedule: lists.slackSchedule, onChange: changeSlackSchedule, onRestore: () => {} }}
      onMattersSave={() => {}}
      onRemove={remove}
      huddleRing={settings.value.huddleRing}
      onHuddleRingChange={changeHuddleRing}
      permission={permission}
      onSendTest={sendTestNotification}
      onOpenSettings={openNotificationSettings}
      onAllow={allow}
    />
  )
}
