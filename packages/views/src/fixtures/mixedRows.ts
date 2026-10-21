import type { TopicRow } from '@juno/contract'
import { art, channels, people, row, rows } from './topics'

/**
 * A sidebar as people use it, to judge how calm the rows read as a list:
 * channel Mains, DM and group DM Mains and threads, read and unread, short
 * and long titles. Most rows are read, as in a real list.
 */
const productMain = row({
  id: 'C0PRODUCT:main',
  kind: 'main',
  title: '#product',
  titleSource: 'channel',
  sender: 'You',
  text: 'Moved the launch checklist into the canvas so we stop losing it',
  channel: channels.product,
  messageCount: 40,
  tags: ['main'],
  art: art.calendar,
  pinned: true,
  section: 'pinned',
  ago: 2 * 60,
})

const groupMain: TopicRow = { ...rows.lunch, id: 'G0MAYALEO:main:pinned', section: 'pinned', pinned: true, preview: { sender: 'Leo', text: 'Sure' } }

const mayaMain: TopicRow = { ...rows.mayaMain, id: 'm:D0MAYA:mixed', preview: { sender: '', text: 'When I share my screen during a huddle the toolbar covers the slide notes' } }

const exportRequest = row({
  id: 'C0VENDORS:1759990000.001600',
  title: 'Full data export request for the analytics workspace',
  sender: 'Sam',
  text: 'Sent it to the vendor, waiting on their legal team',
  channel: channels.vendors,
  ago: 22,
})

const engMain = row({
  id: 'C0ENG:main:mixed',
  kind: 'main',
  title: '#eng',
  titleSource: 'channel',
  sender: 'Dev',
  text: 'When the agent drafts several actions at once, only the first one shows a preview',
  channel: channels.eng,
  tags: ['main'],
  art: art.database,
  ago: 23,
})

const designMain = row({
  id: 'C0DESIGNREV:main',
  kind: 'main',
  title: '#design-review',
  titleSource: 'channel',
  sender: 'Priya',
  text: 'New icon set is in Figma, page two has the sidebar options',
  channel: channels.design,
  participants: [people.priya, people.jonas],
  unreadCount: 4,
  tags: ['main'],
  art: art.bell,
  ago: 41,
})

const devMain: TopicRow = { ...rows.mayaMain, id: 'm:D0DEV:mixed', title: 'Dev Patel', channel: channels.dev, preview: { sender: '', text: 'Ok. Will drive' }, lastActivityAt: rows.mayaMain.lastActivityAt - 60 * 60_000 }

const latency = row({
  id: 'C0ENG:1759990000.001700',
  title: 'Default agent latency after the inference provider spike',
  titleSource: 'ai',
  sender: 'Leo',
  text: 'PR is up with the timeout change and a dashboard link',
  channel: channels.eng,
  art: art.coins,
  ago: 65,
})

export const mixedRows: ReadonlyArray<TopicRow> = [
  productMain,
  groupMain,
  rows.alertsMain,
  rows.postgres,
  rows.hiring,
  mayaMain,
  exportRequest,
  engMain,
  rows.roadmap,
  designMain,
  latency,
  devMain,
]

export const mixedPinnedIds: ReadonlyArray<string> = [productMain.id, groupMain.id]
export const mixedRecentIds: ReadonlyArray<string> = mixedRows.slice(2).map((entry) => entry.id)
export const mixedSelectedId = mayaMain.id
