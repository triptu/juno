/**
 * Invented inputs in the style of the fake-slack fixtures (Maya Chen, Leo Park,
 * Sam Okafor, Priya Raman, Jonas Weber, Dev Patel, Elena Ruiz). Nothing here
 * comes from a real workspace.
 */
import type { ChannelId, TopicId, UserId } from '@juno/domain'
import type { AiMessage, Task } from '../src/index'
import { tasks } from '../src/index'

const T = (id: string) => id as TopicId
const C = (id: string) => id as ChannelId
const U = (id: string) => id as UserId

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 13, 9, 30 - minutesAgo)).toISOString()
const m = (sender: string, text: string, minutesAgo: number, fromMe = false): AiMessage => ({ sender, text, at: at(minutesAgo), fromMe })
const NOW = at(0)

export interface Example {
  readonly task: Task<never>
  readonly label: string
  readonly input: unknown
}

const ex = <I>(task: Task<I>, label: string, input: I): Example => ({ task: task as Task<never>, label, input })

const stagingBill = {
  id: T('t:C0ENG:1728800000.000100'),
  title: 'Staging bill doubled since August',
  recent: [
    m('Leo Park', 'Staging bill doubled since August. Anyone know what changed?', 90),
    m('Jonas Weber', 'We left the perf cluster running after the load test. I will scale it down.', 80),
    m('Leo Park', 'Thanks. Can we add a budget alert so this does not repeat?', 70),
  ],
}
const postgres = {
  id: T('t:C0ENG:1728700000.000200'),
  title: 'Postgres 16 migration plan',
  recent: [
    m('Dev Patel', 'Draft of the Postgres 16 migration plan is in the doc. Two options for the cutover window.', 300),
    m('Sam Okafor', 'Option two means a Saturday. Who can be on call?', 280),
  ],
}
const pricing = {
  id: T('t:C0PRODUCT:1728600000.000300'),
  title: 'Pricing page copy',
  recent: [m('Maya Chen', 'New pricing page copy is up for review. Mostly the team tier section.', 500), m('Priya Raman', 'Reading it now.', 490)],
}

export const examples: ReadonlyArray<Example> = [
  ex(tasks.routeCheck, 'reply typed into Main', {
    draft: 'Jonas scaled it down this morning, the bill should drop next week',
    channel: '#eng',
    topics: [stagingBill, postgres],
  }),
  ex(tasks.routeCheck, 'new subject in Main', {
    draft: 'Heads up, I am out tomorrow afternoon for a dentist appointment',
    channel: '#eng',
    topics: [stagingBill, postgres],
  }),
  ex(tasks.routeCheck, 'short agreement that fits one topic', {
    draft: 'Option two works for me, I can be on call',
    channel: '#eng',
    topics: [stagingBill, postgres],
  }),

  ex(tasks.settledScore, 'closed with thanks', {
    topicId: stagingBill.id,
    title: stagingBill.title,
    channel: '#eng',
    now: NOW,
    messages: [...stagingBill.recent, m('Jonas Weber', 'Alert added at 80% of last month. Scaled down too.', 60), m('Leo Park', 'Perfect, thanks!', 55)],
  }),
  ex(tasks.settledScore, 'open question waiting', {
    topicId: postgres.id,
    title: postgres.title,
    channel: '#eng',
    now: NOW,
    messages: postgres.recent,
  }),
  ex(tasks.settledScore, 'will do, no confirmation yet', {
    topicId: pricing.id,
    title: pricing.title,
    channel: '#product',
    now: NOW,
    messages: [...pricing.recent, m('Priya Raman', 'Left three comments, mostly on the team tier. Will fix the typos myself.', 400)],
  }),

  ex(tasks.groupRun, 'a question and its answers among noise', {
    channelId: C('C0ENG'),
    channel: '#eng',
    messages: [
      { ...m('Deploy Bot', 'api v2.41.0 deployed to production', 40), ts: '1728811200.000100' },
      { ...m('Sam Okafor', 'Is anyone else seeing slow queries on the reports page since the deploy?', 35), ts: '1728811500.000200' },
      { ...m('Dev Patel', 'Yes, reports page is slow for me too. p95 went from 300ms to 2s.', 33), ts: '1728811620.000300' },
      { ...m('Priya Raman', 'Lunch at 12:30?', 32), ts: '1728811680.000400' },
      { ...m('Leo Park', 'The deploy dropped an index on reports.created_at. Re-adding it now.', 30), ts: '1728811800.000500' },
      { ...m('Sam Okafor', 'Reports page is fast again, thanks Leo.', 20), ts: '1728812400.000600' },
    ],
  }),
  ex(tasks.groupRun, 'unrelated messages', {
    channelId: C('C0SOCIAL'),
    channel: '#social',
    messages: [
      { ...m('Priya Raman', 'Lunch at 12:30?', 50), ts: '1728810600.000100' },
      { ...m('Elena Ruiz', 'New coffee beans in the kitchen', 45), ts: '1728810900.000200' },
      { ...m('Jonas Weber', 'Anyone going to the meetup on Thursday?', 40), ts: '1728811200.000300' },
    ],
  }),

  ex(tasks.urgencyGate, 'incident in a channel', {
    messageTs: '1728812000.000100',
    channel: '#incidents',
    channelKind: 'public',
    sender: 'Jonas Weber',
    text: 'Checkout is returning 500s for about 20% of requests since 09:05. Looking now, could use a second pair of eyes.',
    mentionsMe: false,
    now: NOW,
  }),
  ex(tasks.urgencyGate, 'question to me in a DM', {
    messageTs: '1728812100.000100',
    channel: 'Maya Chen',
    channelKind: 'im',
    sender: 'Maya Chen',
    text: 'Can you review the pricing page copy before the 2pm call?',
    mentionsMe: false,
    now: NOW,
  }),
  ex(tasks.urgencyGate, 'chatter with a mention', {
    messageTs: '1728812200.000100',
    channel: '#social',
    channelKind: 'public',
    sender: 'Priya Raman',
    text: 'haha thanks @tushar, the cake was great',
    mentionsMe: true,
    now: NOW,
  }),
  ex(tasks.urgencyGate, 'status update', {
    messageTs: '1728812300.000100',
    channel: '#platform',
    channelKind: 'public',
    sender: 'Dev Patel',
    text: 'FYI the nightly backup job moved to 02:00 UTC. No action needed.',
    mentionsMe: false,
    now: NOW,
  }),

  ex(tasks.parseCommand, 'send with unusual phrasing', {
    text: 'let maya know the wednesday slot works',
    people: [
      { id: U('U0MAYA'), name: 'Maya Chen' },
      { id: U('U0LEO'), name: 'Leo Park' },
    ],
    channels: [{ id: C('C0ENG'), name: 'eng', kind: 'public' }],
    topics: [{ id: pricing.id, title: pricing.title, channel: '#product' }],
  }),
  ex(tasks.parseCommand, 'resolve with a synonym', {
    text: 'close the pricing thread',
    people: [{ id: U('U0MAYA'), name: 'Maya Chen' }],
    channels: [{ id: C('C0ENG'), name: 'eng', kind: 'public' }],
    topics: [
      { id: pricing.id, title: pricing.title, channel: '#product' },
      { id: postgres.id, title: postgres.title, channel: '#eng' },
    ],
  }),
  ex(tasks.parseCommand, 'plain search, not a command', {
    text: 'postgres',
    people: [{ id: U('U0MAYA'), name: 'Maya Chen' }],
    channels: [{ id: C('C0ENG'), name: 'eng', kind: 'public' }],
    topics: [{ id: postgres.id, title: postgres.title, channel: '#eng' }],
  }),
  ex(tasks.parseCommand, 'unknown person', {
    text: 'tell gabriel the build is green',
    people: [{ id: U('U0MAYA'), name: 'Maya Chen' }],
    channels: [],
    topics: [],
  }),

  ex(tasks.forYou, 'a morning of topics', {
    me: 'Tushar',
    now: NOW,
    topics: [
      { id: postgres.id, title: postgres.title, channel: '#eng', unread: 1, messages: postgres.recent },
      {
        id: stagingBill.id,
        title: stagingBill.title,
        channel: '#eng',
        unread: 0,
        messages: [...stagingBill.recent, m('Jonas Weber', 'Alert added. Scaled down too.', 60), m('Leo Park', 'Perfect, thanks!', 55)],
      },
      {
        id: T('t:D0MAYA:1728500000.000400'),
        title: 'Offsite dates',
        channel: 'Maya Chen',
        unread: 0,
        messages: [m('Maya Chen', 'Can you send the offsite dates to the team today?', 700), m('Tushar', 'Yes, I will send them this afternoon.', 690, true)],
      },
      {
        id: T('t:C0PLATFORM:1728400000.000500'),
        title: 'Flaky e2e on CI',
        channel: '#platform',
        unread: 3,
        messages: [
          m('Dev Patel', 'The sign-in e2e fails about one run in five on CI, always on the cookie step.', 200),
          m('Sam Okafor', 'Looks like a race between the fake server start and the first request. A retry on connect would fix it.', 190),
          m('Dev Patel', 'Agreed, want to pair on it?', 185),
        ],
      },
    ],
  }),

  ex(tasks.titleTopic, 'new thread', {
    topicId: T('t:C0ENG:1728900000.000100'),
    channel: '#eng',
    messages: [
      m('Sam Okafor', 'Our Sentry quota runs out around the 20th every month. Should we sample errors or raise the plan?', 10),
      m('Leo Park', 'Sampling first. Most of the volume is one noisy warning.', 8),
    ],
  }),
  ex(tasks.catchUp, 'three new messages', {
    topicId: stagingBill.id,
    title: stagingBill.title,
    channel: '#eng',
    before: stagingBill.recent.slice(0, 1),
    unread: [...stagingBill.recent.slice(1), m('Jonas Weber', 'Alert added at 80% of last month. Scaled down too.', 60)],
  }),
]
