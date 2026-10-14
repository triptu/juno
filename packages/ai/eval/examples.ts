/**
 * Invented inputs in the style of the fake-slack fixtures (Maya Chen, Leo Park,
 * Sam Okafor, Priya Raman, Jonas Weber, Dev Patel, Elena Ruiz). Nothing here
 * comes from a real workspace.
 *
 * Each structured example carries `expect`, the judgement a correct model
 * makes, so the eval and the bench can count accuracy. Thresholds are loose on
 * purpose: they test the direction of the call, not calibration.
 */
import type { ChannelId, TopicId, UserId } from '@juno/domain'
import type { AiMessage, Static, StructuredTask, Task, TextTask, TSchema } from '../src/index'
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
  /** The judgement a correct answer makes. Absent for text tasks, which are judged by eye. */
  readonly expect?: (output: never) => boolean
}

const ex = <I, S extends TSchema>(task: StructuredTask<I, S>, label: string, input: I, expect: (output: Static<S>) => boolean): Example => ({
  task: task as Task<never>,
  label,
  input,
  expect: expect as (output: never) => boolean,
})
const text = <I>(task: TextTask<I>, label: string, input: I): Example => ({ task: task as Task<never>, label, input })

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
const onboarding = {
  id: T('t:C0PRODUCT:1728650000.000400'),
  title: 'Onboarding checklist redesign',
  recent: [m('Elena Ruiz', 'Sketches for the onboarding checklist are in Figma. Three steps instead of seven.', 450), m('Maya Chen', 'Nice. Does step two still ask for the company size?', 440)],
}

const people = [
  { id: U('U0MAYA'), name: 'Maya Chen' },
  { id: U('U0LEO'), name: 'Leo Park' },
  { id: U('U0SAM'), name: 'Sam Okafor' },
]
const channels = [
  { id: C('C0ENG'), name: 'eng', kind: 'public' as const },
  { id: C('C0PRODUCT'), name: 'product', kind: 'public' as const },
]
const topicList = [
  { id: pricing.id, title: pricing.title, channel: '#product' },
  { id: postgres.id, title: postgres.title, channel: '#eng' },
]

export const examples: ReadonlyArray<Example> = [
  ex(tasks.routeCheck, 'reply typed into Main', { draft: 'Jonas scaled it down this morning, the bill should drop next week', channel: '#eng', topics: [stagingBill, postgres] }, (o) => o.replyTo === stagingBill.id),
  ex(tasks.routeCheck, 'new subject in Main', { draft: 'Heads up, I am out tomorrow afternoon for a dentist appointment', channel: '#eng', topics: [stagingBill, postgres] }, (o) => o.replyTo === null),
  ex(tasks.routeCheck, 'short agreement that fits one topic', { draft: 'Option two works for me, I can be on call', channel: '#eng', topics: [stagingBill, postgres] }, (o) => o.replyTo === postgres.id),
  ex(tasks.routeCheck, 'question that continues a topic', { draft: 'Did the team tier section get the new numbers from finance?', channel: '#product', topics: [pricing, onboarding] }, (o) => o.replyTo === pricing.id),
  ex(tasks.routeCheck, 'general announcement', { draft: 'Reminder: standup moves to 10:15 from Monday', channel: '#product', topics: [pricing, onboarding] }, (o) => o.replyTo === null),
  ex(tasks.routeCheck, 'could fit either topic, so Main', { draft: 'Can someone take a look when they have a minute?', channel: '#eng', topics: [stagingBill, postgres] }, (o) => o.replyTo === null),

  ex(
    tasks.settledScore,
    'closed with thanks',
    { topicId: stagingBill.id, title: stagingBill.title, channel: '#eng', now: NOW, messages: [...stagingBill.recent, m('Jonas Weber', 'Alert added at 80% of last month. Scaled down too.', 60), m('Leo Park', 'Perfect, thanks!', 55)] },
    (o) => o.score >= 0.6,
  ),
  ex(tasks.settledScore, 'open question waiting', { topicId: postgres.id, title: postgres.title, channel: '#eng', now: NOW, messages: postgres.recent }, (o) => o.score <= 0.4),
  ex(
    tasks.settledScore,
    'will do, no confirmation yet',
    { topicId: pricing.id, title: pricing.title, channel: '#product', now: NOW, messages: [...pricing.recent, m('Priya Raman', 'Left three comments, mostly on the team tier. Will fix the typos myself.', 400)] },
    (o) => o.score <= 0.5,
  ),
  ex(
    tasks.settledScore,
    'decision taken and confirmed',
    {
      topicId: postgres.id,
      title: postgres.title,
      channel: '#eng',
      now: NOW,
      messages: [...postgres.recent, m('Leo Park', 'I can take the Saturday. Let us go with option two.', 270), m('Dev Patel', 'Agreed. Booked the window and sent the invite.', 260), m('Sam Okafor', 'Great, thanks both.', 250)],
    },
    (o) => o.score >= 0.6,
  ),
  ex(
    tasks.settledScore,
    'my question nobody answered',
    {
      topicId: onboarding.id,
      title: onboarding.title,
      channel: '#product',
      now: NOW,
      messages: [...onboarding.recent, m('Tushar', 'Do we still need the company size for the pricing suggestion? If not I would drop it.', 430, true)],
    },
    (o) => o.score <= 0.3,
  ),
  ex(
    tasks.settledScore,
    'merged and shipped',
    {
      topicId: T('t:C0PLATFORM:1728300000.000600'),
      title: 'Retry on connect for the e2e server',
      channel: '#platform',
      now: NOW,
      messages: [m('Sam Okafor', 'PR for the retry on connect is up.', 120), m('Dev Patel', 'Reviewed, one nit, otherwise good.', 100), m('Sam Okafor', 'Fixed the nit. Merged and shipped in the nightly.', 90), m('Dev Patel', 'Ship it. Thanks!', 85)],
    },
    (o) => o.score >= 0.7,
  ),

  ex(
    tasks.groupRun,
    'a question and its answers among noise',
    {
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
    },
    (o) => {
      if (o.group === null) return false
      const ts = new Set(o.group.messageTs)
      return ['1728811500.000200', '1728811620.000300', '1728811800.000500'].every((t) => ts.has(t)) && !ts.has('1728811680.000400') && !ts.has('1728811200.000100')
    },
  ),
  ex(
    tasks.groupRun,
    'unrelated messages',
    {
      channelId: C('C0SOCIAL'),
      channel: '#social',
      messages: [
        { ...m('Priya Raman', 'Lunch at 12:30?', 50), ts: '1728810600.000100' },
        { ...m('Elena Ruiz', 'New coffee beans in the kitchen', 45), ts: '1728810900.000200' },
        { ...m('Jonas Weber', 'Anyone going to the meetup on Thursday?', 40), ts: '1728811200.000300' },
      ],
    },
    (o) => o.group === null,
  ),
  ex(
    tasks.groupRun,
    'a back and forth with a bot post in the middle',
    {
      channelId: C('C0HIRING'),
      channel: '#hiring',
      messages: [
        { ...m('Maya Chen', 'The backend candidate from Tuesday: do we move to the onsite loop?', 60), ts: '1728810000.000100' },
        { ...m('Leo Park', 'Yes from me. Strong on systems, a bit quiet on product questions.', 55), ts: '1728810300.000200' },
        { ...m('Greenhouse', 'New application: Senior Backend Engineer', 52), ts: '1728810480.000300' },
        { ...m('Sam Okafor', 'Yes from me too. I can do the systems interview Thursday.', 50), ts: '1728810600.000400' },
        { ...m('Maya Chen', 'Great, I will schedule the loop for Thursday.', 48), ts: '1728810720.000500' },
      ],
    },
    (o) => {
      if (o.group === null) return false
      const ts = new Set(o.group.messageTs)
      return ts.size >= 3 && ts.has('1728810000.000100') && ts.has('1728810300.000200') && !ts.has('1728810480.000300')
    },
  ),
  ex(
    tasks.groupRun,
    'two exchanges, each too short to group',
    {
      channelId: C('C0ENG'),
      channel: '#eng',
      messages: [
        { ...m('Dev Patel', 'Is the staging deploy done?', 30), ts: '1728811800.000100' },
        { ...m('Jonas Weber', 'Yes, ten minutes ago.', 28), ts: '1728811920.000200' },
        { ...m('Elena Ruiz', 'Who owns the design tokens package now?', 20), ts: '1728812400.000300' },
        { ...m('Priya Raman', 'Leo, since September.', 18), ts: '1728812520.000400' },
      ],
    },
    (o) => o.group === null,
  ),

  ex(
    tasks.urgencyGate,
    'incident in a channel',
    { messageTs: '1728812000.000100', channel: '#incidents', channelKind: 'public', sender: 'Jonas Weber', text: 'Checkout is returning 500s for about 20% of requests since 09:05. Looking now, could use a second pair of eyes.', mentionsMe: false, now: NOW },
    (o) => o.urgent >= 0.6 && o.chatter <= 0.3,
  ),
  ex(
    tasks.urgencyGate,
    'question to me in a DM with a deadline',
    { messageTs: '1728812100.000100', channel: 'Maya Chen', channelKind: 'im', sender: 'Maya Chen', text: 'Can you review the pricing page copy before the 2pm call?', mentionsMe: false, now: NOW },
    (o) => o.urgent >= 0.5 && o.chatter <= 0.3,
  ),
  ex(
    tasks.urgencyGate,
    'chatter with a mention',
    { messageTs: '1728812200.000100', channel: '#social', channelKind: 'public', sender: 'Priya Raman', text: 'haha thanks @tushar, the cake was great', mentionsMe: true, now: NOW },
    (o) => o.chatter >= 0.6 && o.urgent <= 0.3,
  ),
  ex(
    tasks.urgencyGate,
    'status update',
    { messageTs: '1728812300.000100', channel: '#platform', channelKind: 'public', sender: 'Dev Patel', text: 'FYI the nightly backup job moved to 02:00 UTC. No action needed.', mentionsMe: false, now: NOW },
    (o) => o.urgent <= 0.3,
  ),
  ex(
    tasks.urgencyGate,
    'blocked person waiting on me',
    { messageTs: '1728812400.000100', channel: '#eng', channelKind: 'public', sender: 'Sam Okafor', text: '@tushar I cannot merge the schema PR until you approve it, and the release cut is at 15:00.', mentionsMe: true, now: NOW },
    (o) => o.urgent >= 0.6 && o.chatter <= 0.3,
  ),
  ex(
    tasks.urgencyGate,
    'bot deploy notice',
    { messageTs: '1728812500.000100', channel: '#deploys', channelKind: 'public', sender: 'Deploy Bot', text: 'web v3.12.0 deployed to production (no changes to migrations)', mentionsMe: false, now: NOW },
    (o) => o.urgent <= 0.3,
  ),
  ex(
    tasks.urgencyGate,
    'meeting starting now',
    { messageTs: '1728812600.000100', channel: '#design', channelKind: 'public', sender: 'Elena Ruiz', text: '@tushar design review is starting now in room 4, we are waiting for you', mentionsMe: true, now: NOW },
    (o) => o.urgent >= 0.6 && o.chatter <= 0.3,
  ),
  ex(
    tasks.urgencyGate,
    'lunch plans in a DM',
    { messageTs: '1728812700.000100', channel: 'Leo Park', channelKind: 'im', sender: 'Leo Park', text: 'ramen place at 1?', mentionsMe: false, now: NOW },
    (o) => o.chatter >= 0.5 && o.urgent <= 0.3,
  ),

  ex(
    tasks.parseCommand,
    'send with unusual phrasing',
    { text: 'let maya know the wednesday slot works', people, channels, topics: topicList },
    (o) => o.command?.kind === 'send_dm' && o.command.userId === 'U0MAYA' && /wednesday slot works/i.test(o.command.text),
  ),
  ex(tasks.parseCommand, 'resolve with a synonym', { text: 'close the pricing thread', people, channels, topics: topicList }, (o) => o.command?.kind === 'resolve' && o.command.topicId === pricing.id),
  ex(tasks.parseCommand, 'plain search, not a command', { text: 'postgres', people, channels, topics: topicList }, (o) => o.command === null),
  ex(tasks.parseCommand, 'unknown person', { text: 'tell gabriel the build is green', people, channels, topics: [] }, (o) => o.command === null),
  ex(
    tasks.parseCommand,
    'post in a channel',
    { text: 'put in eng that deploys are frozen until monday', people, channels, topics: topicList },
    (o) => o.command?.kind === 'post' && o.command.channelId === 'C0ENG' && /deploys are frozen/i.test(o.command.text),
  ),
  ex(tasks.parseCommand, 'open a conversation by full name', { text: 'leo park', people, channels, topics: topicList }, (o) => o.command?.kind === 'open_dm' && o.command.userId === 'U0LEO'),
  ex(tasks.parseCommand, 'ask for a catch-up', { text: 'what did I miss in eng this morning', people, channels, topics: topicList }, (o) => o.command?.kind === 'ask'),
  ex(tasks.parseCommand, 'resolve with no matching topic', { text: 'close the hiring thread', people, channels, topics: topicList }, (o) => o.command === null),

  text(tasks.titleTopic, 'new thread', {
    topicId: T('t:C0ENG:1728900000.000100'),
    channel: '#eng',
    messages: [
      m('Sam Okafor', 'Our Sentry quota runs out around the 20th every month. Should we sample errors or raise the plan?', 10),
      m('Leo Park', 'Sampling first. Most of the volume is one noisy warning.', 8),
    ],
  }),
  text(tasks.topicArt, 'thread: a migration plan', {
    kind: 'thread',
    topicId: postgres.id,
    title: 'Postgres 16 migration plan',
    channel: '#eng',
    first: 'Draft of the Postgres 16 migration plan is in the doc. Two options for the cutover window.',
    last: 'Booked 2 to 4pm Wednesday. Will post results here.',
  }),
  text(tasks.topicArt, 'thread: a bill', {
    kind: 'thread',
    topicId: stagingBill.id,
    title: stagingBill.title,
    channel: '#eng',
    first: stagingBill.recent[0]!.text,
    last: stagingBill.recent[1]!.text,
  }),
  text(tasks.topicArt, 'thread: an offsite slot', {
    kind: 'thread',
    topicId: T('t:D0MAYA:1728500000.000400'),
    title: 'Offsite: Wednesday afternoon slot',
    channel: 'Maya Chen',
    first: 'Can eng take the Wednesday afternoon slot at the offsite? 90 minutes on the sync roadmap.',
    last: 'Perfect. Send me a one-line description when you have it.',
  }),
  text(tasks.topicArt, 'main: a channel with a purpose', {
    kind: 'main',
    topicId: T('m:C0HIRING'),
    channel: '#hiring',
    topic: 'Open roles and candidates',
    recent: ['Rina finished the onsite. Panel notes are in the scorecard.', "Marco's references came back. All positive, one note on delegation."],
  }),
  text(tasks.topicArt, 'thread: nothing to draw', {
    kind: 'thread',
    topicId: T('t:C0SOCIAL:1728500000.000900'),
    title: 'hmm',
    channel: '#social',
    first: 'hmm',
    last: 'yeah',
  }),
  text(tasks.catchUp, 'three new messages', {
    topicId: stagingBill.id,
    title: stagingBill.title,
    channel: '#eng',
    before: stagingBill.recent.slice(0, 1),
    unread: [...stagingBill.recent.slice(1), m('Jonas Weber', 'Alert added at 80% of last month. Scaled down too.', 60)],
  }),
]

/** The structured examples, which carry an expectation. */
export const decisionExamples: ReadonlyArray<Example & { readonly expect: (output: never) => boolean }> = examples.filter(
  (e): e is Example & { readonly expect: (output: never) => boolean } => e.expect !== undefined,
)
