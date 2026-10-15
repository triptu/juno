import { defineFixtures, fixture } from '@juno/ui'
import { NotificationsPage, type NotificationsPageProps } from './NotificationsPage'

const noop = () => {}
const weekdays = [1, 2, 3, 4, 5] as const
const at = (hour: number, minute: number) => new Date(2026, 9, 15, hour, minute).getTime()

export const notificationsBase: NotificationsPageProps = {
  notificationHours: { days: weekdays, from: 9 * 60, to: 18 * 60 },
  presenceHours: { days: weekdays, from: 9 * 60, to: 20 * 60 },
  matters: 'The launch and hiring. Anything from my reports that needs a decision today. Production incidents.',
  aiAssist: true,
  every: [
    { kind: 'channel', id: 'C0INCIDENTS', name: 'incidents', channelKind: 'public' },
    { kind: 'person', id: 'U0MAYA', name: 'Maya Chen' },
  ],
  never: [
    { kind: 'channel', id: 'C0DESIGN', name: 'design-review', channelKind: 'public' },
    { kind: 'channel', id: 'C0RANDOM', name: 'random', channelKind: 'public' },
  ],
  interrupted: 4,
  held: 23,
  today: [
    { id: 4, at: at(13, 42), place: '#eng', sender: 'Dev', text: 'needs a release approval before 2pm', reason: 'Juno: asks you to approve the release before 2pm' },
    { id: 3, at: at(13, 30), place: '#incidents', sender: 'Grafana', text: 'queue depth > 5k on billing', reason: '#incidents is set to Every message' },
    { id: 2, at: at(13, 12), place: 'Maya Chen', sender: 'Maya Chen', text: 'Draft is up. Cross-posting to leadership once you have looked.', reason: 'Maya Chen is set to Every message' },
  ],
  onHoursChange: noop,
  onMattersSave: noop,
  onRemove: noop,
}

export default defineFixtures(
  NotificationsPage,
  {
    Page: {
      default: fixture(notificationsBase),
      'show-why': fixture({ ...notificationsBase, showWhy: true }),
      'same-hours': fixture({ ...notificationsBase, notificationHours: { days: weekdays, from: 540, to: 1140 }, presenceHours: { days: weekdays, from: 540, to: 1140 } }),
    },
    Empty: {
      'nothing-set': fixture({ ...notificationsBase, matters: '', every: [], never: [], interrupted: 0, held: 0, today: [] }),
      'ai-off': fixture({ ...notificationsBase, aiAssist: false }),
    },
  },
  { width: 1000, height: 900 },
)
