import { defineFixtures, fixture } from '@juno/ui'
import { NotificationDetails, type NotificationDetailsProps, type ProposedInstruction } from './NotificationDetails'
import { notificationsBase } from './NotificationsPage.fixtures'

const noop = () => {}
const proposal: ProposedInstruction = { direction: 'stay', text: 'Updates in #design with nothing asked of me' }

/** Thirty decisions of every decided-by kind, from the page's fixtures. */
const base: NotificationDetailsProps = {
  ...notificationsBase,
  decisions: notificationsBase.decisions,
  onClose: noop,
}

/** The sheet as it sits in the window: a panel over a dim, its height the window's. */
const frame = { width: 760, height: 860, padded: true, surface: 'subtle' } as const

export default defineFixtures(NotificationDetails, {
  Filter: {
    all: fixture(base, frame),
    notified: fixture({ ...base, initialFilter: 'notified' }, frame),
    stayed: fixture({ ...base, initialFilter: 'stayed' }, frame),
    loading: fixture({ ...base, decisions: undefined }, frame),
    'nothing-notified': fixture({ ...base, initialFilter: 'notified', decisions: (base.decisions ?? []).filter((decision) => !decision.notified) }, frame),
  },
  Why: {
    reading: fixture({ ...base, initialOpen: 'd1' }, frame),
    setting: fixture({ ...base, initialOpen: 'd8' }, frame),
    instruction: fixture({ ...base, initialOpen: 'd0' }, frame),
    proposal: fixture({ ...base, proposals: new Map([['d13', proposal]]), initialOpen: 'd13' }, frame),
    timeout: fixture({ ...base, initialOpen: 'd22' }, frame),
  },
})
