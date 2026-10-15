import type { Hours, NotifyTag } from '@juno/contract'
import { notificationSettingsAtom, notificationsPageAtom, registry, setHours, setMatters } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { NotificationsPage as NotificationsPageView, type HoursKind } from '@juno/views'
import { setNotifyLevel } from './notifyActions'

function changeHours(which: HoursKind, hours: Hours): void {
  setHours(registry, which, hours)
}

function saveMatters(text: string): void {
  setMatters(registry, text)
}

/** A tag's x: back to When it matters, with Undo. */
function remove(tag: NotifyTag): void {
  setNotifyLevel({ kind: tag.kind, id: tag.id }, 'matters', tag.kind === 'channel' && tag.channelKind !== 'im' && tag.channelKind !== 'mpim' ? `#${tag.name}` : tag.name)
}

/**
 * The Notifications page (SPEC 14): the settings and the page's lists and
 * today from the engine. Nothing shows until the settings arrive, which
 * are local and come at once.
 */
export function NotificationsPage() {
  const settings = useAtomValue(notificationSettingsAtom)
  const page = useAtomValue(notificationsPageAtom)
  if (settings._tag !== 'Success') return null
  const lists = page._tag === 'Success' ? page.value : { every: [], never: [], interrupted: 0, held: 0, today: [] }
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
      onMattersSave={saveMatters}
      onRemove={remove}
    />
  )
}
