import { defineFixtures, fixture } from '@juno/ui'
import { recentConversations as conversations } from './fixtures/newChat'
import type { ProposedInstruction } from './NotificationDetails'
import type { Decision, DecidedBy, Instruction } from './notificationRules'
import { NotificationsPage, type NotificationsPageProps } from './NotificationsPage'

const noop = () => {}
const weekdays = [1, 2, 3, 4, 5] as const
const at = (hour: number, minute: number) => new Date(2026, 9, 23, hour, minute).getTime()

const instructions: ReadonlyArray<Instruction> = [
  { id: 'i1', direction: 'notify', text: 'Anything on the Q4 launch' },
  { id: 'i2', direction: 'stay', text: 'Social plans, lunch and dinner' },
  { id: 'i3', direction: 'notify', text: 'Hiring decisions and offer approvals for the platform team' },
  { id: 'i4', direction: 'stay', text: 'Deploy and CI updates when nothing failed' },
  {
    id: 'i5',
    direction: 'notify',
    text: 'Anything from my reports that needs a decision today, especially when a customer is waiting on it or a deadline moves',
  },
]

type Row = readonly [hour: number, minute: number, sender: string, place: string, text: string, notified: boolean, decidedBy: DecidedBy, reason: string]

/** A day of decisions, newest first: every kind of decided-by. */
const rows: ReadonlyArray<Row> = [
  [17, 52, 'Priya Raman', 'Priya, Sam, Maya', "who's in for dinner friday? tushar you too?", false, 'instruction', "Your instructions: Don't notify: Social plans, lunch and dinner"],
  [17, 40, 'Alex Chen', '', 'got a minute? want to talk about the reorg before my 4pm', true, 'reading', 'Alex asks you something.'],
  [17, 31, 'Alex Chen', '', 'also the doc is here', false, 'burst', 'Alex Chen notified you less than a minute ago.'],
  [17, 3, 'Maya Okafor', '#launch · Ship date', "let's just move it to the 14th then, I'll tell marketing", true, 'instruction', 'Your instructions: Notify me: Anything on the Q4 launch'],
  [16, 48, 'Lena Fischer', '#eng · Release checklist', 'yes, ran it on staging twice, no locks. good to go', true, 'reading', 'Lena answered your question.'],
  [16, 22, 'Jonas Berg', '#incidents', '@here still failing after rollback, customers noticing', true, 'alwaysNotify', 'Mentions always notify.'],
  [16, 10, 'Dev Malhotra', '', 'ping on the contract, legal needs it by 5', true, 'reading', "Dev is following up, and you haven't replied."],
  [15, 58, 'Sam Ortiz', '#launch', 'leaning towards dropping the beta tag, objections?', true, 'reading', 'A decision is being made in #launch.'],
  [15, 44, 'Grafana', '#incidents', 'queue depth > 5k on billing-worker for 10 minutes', true, 'always', '#incidents is set to Always.'],
  [15, 30, 'Maya Okafor', '', 'thanks!', false, 'closer', 'Maya thanked you. Nothing to do.'],
  [15, 12, 'Priya Raman', '', 'ok sounds good, and can you check the deck when you have a sec?', true, 'live', 'You were talking with Priya 2 minutes ago.'],
  [14, 59, 'Ravi Kumar', '#incidents · Billing outage', 'root cause is the cert rotation, you approved the change so looping you in', true, 'reading', "Something serious in #incidents, and you're part of it."],
  [14, 40, 'Sam Ortiz', '', 'hey! how are you doing?', false, 'reading', 'Sam said hello. Nothing asked yet.'],
  [14, 31, 'Priya Raman', '#design · Icon refresh', 'new icon set is uploaded to Figma, no action needed, just fyi', false, 'reading', 'An update with nothing asked of you.'],
  [14, 20, 'Jonas Berg', '#eng', 'anyone know why the linter got so slow this week?', false, 'reading', "Talk you're not part of."],
  [14, 2, 'Deploy bot', '#deploys', 'web-app 4.18.2 deployed to production', false, 'never', 'Deploy bot is set to Never.'],
  [13, 50, 'Jonas Berg', '#random', '@Tushar did you see the eclipse photos?', true, 'directMention', 'Mentions you by name. That gets through Never.'],
  [13, 41, 'Status', '#alerts', '@channel scheduled maintenance tonight at 23:00', false, 'ignored', '#alerts is ignored.'],
  [13, 30, 'Lena Fischer', '#alerts', '@Tushar the pager rotation for next week needs your name', true, 'directMention', 'Mentions you by name. That gets through ignored channels.'],
  [13, 12, 'Maya Okafor', 'Maya Okafor', 'Draft is up. Cross-posting to leadership once you have looked.', true, 'alwaysNotify', 'Direct messages always notify.'],
  [12, 58, 'Ravi Kumar', '#eng · Flaky tests', 'pushed a fix for the flaky checkout test, can you rerun?', true, 'alwaysNotify', 'A reply in a thread you started.'],
  [12, 40, 'Lena Fischer', '#platform · Q4 roadmap', 'I think we should cut the migration work and keep the API', true, 'alwaysNotify', 'A reply in a thread you follow.'],
  [12, 21, 'Dev Malhotra', '#sales · Acme renewal', 'they signed! 3 years', false, 'timeout', "Juno couldn't read this in time."],
  [12, 5, 'Alex Chen', '', 'are you joining the all hands?', true, 'timeout', "Juno couldn't read this in time."],
  [11, 48, 'Sam Ortiz', '#random', 'lunch at the thai place?', false, 'never', '#random is set to Never.'],
  [11, 30, 'Priya Raman', '#design', 'can someone review the onboarding copy by EOD', false, 'aiOff', 'AI assist is off. Only DMs and mentions notify.'],
  [10, 55, 'Jonas Berg', '#eng · Deploy freeze', 'freeze starts friday 6pm, plan accordingly', false, 'reading', 'An update with nothing asked of you.'],
  [9, 40, 'Maya Okafor', '#launch · Press list', 'can you approve the press list before 11?', true, 'reading', 'Maya asks you something.'],
  [8, 12, 'Dev Malhotra', '', 'morning! contract notes are in the doc', false, 'hours', 'Outside your notification hours.'],
  [7, 30, 'Ravi Kumar', '#incidents', 'overnight: 2 alerts, both resolved, details in thread', false, 'hours', 'Outside your notification hours.'],
]

const senderIds: Record<string, string> = {}
const decisions: ReadonlyArray<Decision> = rows.map(([hour, minute, sender, place, text, notified, decidedBy, reason], index) => {
  senderIds[sender] ??= `U${index}`
  return { id: `d${index}`, at: at(hour, minute), sender, senderId: senderIds[sender] ?? sender, place, text, notified, decidedBy, reason }
})


export const notificationsBase: NotificationsPageProps = {
  notificationHours: { days: weekdays, from: 9 * 60, to: 19 * 60 },
  presenceHours: { days: weekdays, from: 9 * 60, to: 20 * 60 },
  onHoursChange: noop,
  onDayChange: noop,
  slackSchedule: { changedInSlack: false, waitingForHours: false },
  onUseJunoHours: noop,
  aiAssist: true,
  alwaysNotify: { dms: false, groupDms: false, mentions: true, startedThreads: false, followedThreads: false },
  onAlwaysNotifyChange: noop,
  instructions: instructions.slice(0, 2),
  onAdd: noop,
  onEdit: noop,
  onRemove: noop,
  onMakeSetting: noop,
  onKeepInstruction: noop,
  always: [
    { kind: 'channel', id: 'C0INCIDENTS', name: 'incidents', channelKind: 'public' },
    { kind: 'person', id: 'U0MAYA', name: 'Maya Okafor' },
  ],
  never: [
    { kind: 'channel', id: 'C0RANDOM', name: 'random', channelKind: 'public' },
    { kind: 'person', id: 'B0DEPLOY', name: 'Deploy bot' },
  ],
  onRemoveLevel: noop,
  picker: { query: '', onQuery: noop, conversations },
  onPickLevel: noop,
  onOpenIgnored: noop,
  notifiedToday: decisions.filter((decision) => decision.notified).length,
  stayedToday: decisions.filter((decision) => !decision.notified).length,
  decisions,
  proposals: new Map(),
  alwaysFor: new Map([['d1', 'Alex'], ['d12', 'Sam']]),
  onChange: noop,
  onEditInstructions: noop,
  onSuggest: noop,
  onAddInstruction: noop,
  onAlways: noop,
  onSettings: noop,
  huddleRing: true,
  onHuddleRingChange: noop,
  permission: { authorization: 'allowed', badges: 'enabled' },
  onSendTest: noop,
  onOpenSettings: noop,
  onAllow: noop,
}

const manyAlways: NotificationsPageProps['always'] = [
  { kind: 'channel', id: 'C1', name: 'incidents', channelKind: 'public' },
  { kind: 'channel', id: 'C2', name: 'leadership', channelKind: 'private' },
  { kind: 'person', id: 'U1', name: 'Maya Okafor' },
  { kind: 'person', id: 'U2', name: 'Alexandra Konstantinou-Whitfield' },
  { kind: 'thread', id: 'T1', name: 'Q4 launch: ship date and press plan' },
  { kind: 'channel', id: 'C3', name: 'customer-escalations-enterprise', channelKind: 'public' },
  { kind: 'channel', id: 'C4', name: 'Maya, Ravi, Lena', channelKind: 'mpim' },
  { kind: 'person', id: 'U3', name: 'Ravi Kumar' },
]
const manyNever: NotificationsPageProps['never'] = [
  { kind: 'channel', id: 'C5', name: 'random', channelKind: 'public' },
  { kind: 'channel', id: 'C6', name: 'deploys', channelKind: 'public' },
  { kind: 'person', id: 'B1', name: 'Deploy bot' },
  { kind: 'person', id: 'B2', name: 'Grafana' },
  { kind: 'channel', id: 'C7', name: 'design-review', channelKind: 'public' },
  { kind: 'thread', id: 'T2', name: 'Offsite logistics' },
  { kind: 'channel', id: 'C8', name: 'social-sf', channelKind: 'public' },
  { kind: 'channel', id: 'C9', name: 'github-notifications-platform', channelKind: 'private' },
  { kind: 'person', id: 'B3', name: 'Jira' },
]

const proposal: ProposedInstruction = { direction: 'stay', text: 'Updates in #design with nothing asked of me' }

/** Scrolled to a part, as the menu and the why open it. */
const tall = { width: 1000, height: 900 }

export default defineFixtures(
  NotificationsPage,
  {
    Page: {
      default: fixture(notificationsBase),
      'same-hours': fixture({ ...notificationsBase, notificationHours: { days: weekdays, from: 540, to: 1140 }, presenceHours: { days: weekdays, from: 540, to: 1140 } }),
      'how-auto': fixture({ ...notificationsBase, anchor: 'how-auto', anchorKey: 1 }, tall),
    },
    'Always notify': {
      'threads-you-follow': fixture({ ...notificationsBase, alwaysNotify: { dms: true, groupDms: false, mentions: true, startedThreads: false, followedThreads: true } }),
      'all-on': fixture({ ...notificationsBase, alwaysNotify: { dms: true, groupDms: true, mentions: true, startedThreads: true, followedThreads: true } }),
    },
    Instructions: {
      many: fixture({ ...notificationsBase, instructions, anchor: 'instructions', anchorKey: 1 }, tall),
      empty: fixture({ ...notificationsBase, instructions: [], anchor: 'instructions', anchorKey: 1 }, tall),
      'direction-chosen': fixture({ ...notificationsBase, initialDirection: 'notify', anchor: 'instructions', anchorKey: 1 }, tall),
      checking: fixture({ ...notificationsBase, instructions: [...instructions.slice(0, 2), { id: 'i9', direction: 'notify', text: 'Always notify me when Alex messages me' }], ruleCheck: { instructionId: 'i9' }, anchor: 'instructions', anchorKey: 1 }, tall),
      'found-rule': fixture(
        {
          ...notificationsBase,
          instructions: [...instructions.slice(0, 2), { id: 'i9', direction: 'notify', text: 'Always notify me when Alex messages me' }],
          ruleCheck: { instructionId: 'i9', found: { name: 'Alex Chen', level: 'always' } },
          anchor: 'instructions',
          anchorKey: 1,
        },
        tall,
      ),
      'ai-off': fixture({ ...notificationsBase, aiAssist: false, anchor: 'instructions', anchorKey: 1 }, tall),
    },
    Levels: {
      many: fixture({ ...notificationsBase, always: manyAlways, never: manyNever, anchor: 'instructions', anchorKey: 1 }, tall),
      empty: fixture({ ...notificationsBase, always: [], never: [], anchor: 'instructions', anchorKey: 1 }, tall),
    },
    Details: {
      all: fixture({ ...notificationsBase, details: {} }, tall),
      notified: fixture({ ...notificationsBase, details: { filter: 'notified' } }, tall),
      stayed: fixture({ ...notificationsBase, details: { filter: 'stayed' } }, tall),
      'why-reading': fixture({ ...notificationsBase, details: { open: 'd1' } }, tall),
      'why-setting': fixture({ ...notificationsBase, details: { open: 'd8' } }, tall),
      'why-instruction': fixture({ ...notificationsBase, details: { open: 'd0' } }, tall),
      'why-proposal': fixture({ ...notificationsBase, proposals: new Map([['d13', proposal]]), details: { open: 'd13' } }, tall),
      loading: fixture({ ...notificationsBase, decisions: undefined, details: {} }, tall),
      nothing: fixture({ ...notificationsBase, notifiedToday: 0, stayedToday: 0, decisions: [] }),
    },
    'Slack schedule': {
      'changed-in-slack': fixture({ ...notificationsBase, slackSchedule: { changedInSlack: true, waitingForHours: false } }),
      'waiting-for-hours': fixture({ ...notificationsBase, slackSchedule: { changedInSlack: false, waitingForHours: true } }),
    },
    Permission: {
      'badges-off': fixture({ ...notificationsBase, permission: { authorization: 'allowed', badges: 'disabled' } }),
      denied: fixture({ ...notificationsBase, permission: { authorization: 'denied', badges: 'disabled' } }),
      'not-determined': fixture({ ...notificationsBase, permission: { authorization: 'notDetermined', badges: 'unknown' } }),
      unknown: fixture({ ...notificationsBase, permission: { authorization: 'unknown', badges: 'unknown' } }),
    },
  },
  { width: 1000, height: 900 },
)
