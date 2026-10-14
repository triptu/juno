/**
 * Invented chat data for the gallery: places, topics, every card kind in
 * every status, and the items of a transcript. Nothing here comes from a
 * workspace. Times are relative to `NOW` so the labels never drift.
 */
import type {
  Card,
  CardId,
  CardStatus,
  ChatItem,
  ChatMessageId,
  Delivery,
  Ending,
  GroupPosition,
  JobId,
  JunoInline,
  JunoMessageItem,
  OpId,
  OpenTarget,
  Origin,
  OwnerMessageItem,
  Place,
  ProposedMessageId,
  QuestionOptionId,
  RunId,
  ScheduleId,
  SendResult,
  TopicLink,
} from '@juno/agent-contract'

export const NOW = Date.UTC(2026, 9, 14, 9, 30)
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const cardId = (id: string) => id as CardId
export const messageId = (id: string) => id as ChatMessageId
export const opId = (id: string) => id as OpId
export const runId = (id: string) => id as RunId
export const jobId = (id: string) => id as JobId
export const scheduleId = (id: string) => id as ScheduleId
export const proposedId = (id: string) => id as ProposedMessageId
export const optionId = (id: string) => id as QuestionOptionId

export const places = {
  eng: { channelId: 'C0ENG', name: 'eng', kindLabel: 'Public channel', tint: 'public' } satisfies Place,
  hiring: { channelId: 'C0HIRING', name: 'hiring', kindLabel: 'Private channel', tint: 'private' } satisfies Place,
  maya: { channelId: 'D0MAYA', name: 'Maya Chen', kindLabel: 'Direct message', tint: 'dm' } satisfies Place,
  group: { channelId: 'G0MAYALEO', name: 'Maya, Leo', kindLabel: 'Group message', tint: 'dm' } satisfies Place,
} as const

export const topics = {
  postgres: { topicId: 't:C0ENG:1', title: 'Postgres 16 migration plan', where: '#eng', tint: 'public' } satisfies TopicLink,
  offsite: { topicId: 't:D0MAYA:2', title: 'Offsite agenda', where: 'Maya Chen', tint: 'dm' } satisfies TopicLink,
  hiring: { topicId: 'm:C0HIRING', title: '#hiring · Main', where: '#hiring', tint: 'private' } satisfies TopicLink,
  flake: { topicId: 't:C0ENG:3', title: 'Sidebar test flake on CI', where: '#eng', tint: 'public' } satisfies TopicLink,
  pricing: { topicId: 't:C0SALES:4', title: 'Pricing page copy', where: '#sales', tint: 'public' } satisfies TopicLink,
} as const

/* Items ------------------------------------------------------------------- */

export const owner = (id: string, text: string, group: GroupPosition = 'single', delivery: Delivery = { _tag: 'sent' }, at = NOW - 4 * MINUTE): OwnerMessageItem => ({
  _tag: 'owner',
  opId: opId(`op-${id}`),
  id: messageId(id),
  text,
  at,
  delivery,
  group,
})

export const text = (value: string): JunoInline => ({ _tag: 'text', text: value })
export const cite = (value: string, id: string): JunoInline => ({ _tag: 'cite', text: value, messageId: messageId(id) })

export interface JunoOptions {
  readonly group?: GroupPosition
  readonly cards?: ReadonlyArray<Card>
  readonly ending?: Ending
  readonly origin?: Origin
  readonly streaming?: boolean
  readonly unread?: boolean
  readonly at?: number
}

export const juno = (id: string, body: ReadonlyArray<JunoInline> | string, options: JunoOptions = {}): JunoMessageItem => ({
  _tag: 'juno',
  id: messageId(id),
  runId: runId(`run-${id}`),
  body: typeof body === 'string' ? (body.length === 0 ? [] : [text(body)]) : body,
  at: options.at ?? NOW - 3 * MINUTE,
  origin: options.origin ?? { _tag: 'owner' },
  streaming: options.streaming ?? false,
  ending: options.ending ?? { _tag: 'complete' },
  cards: options.cards ?? [],
  group: options.group ?? 'single',
  unread: options.unread ?? false,
})

export const status = (id: string, statusText?: string): ChatItem => ({ _tag: 'status', runId: runId(`run-${id}`), ...(statusText === undefined ? {} : { text: statusText }) })

export const day = (daysAgo: number): ChatItem => ({ _tag: 'day', at: NOW - daysAgo * DAY - (NOW % DAY) })

export const scheduleOrigin: Origin = { _tag: 'schedule', scheduleId: scheduleId('s1'), name: 'Daily catch-up' }
export const jobOrigin: Origin = { _tag: 'job', jobs: [{ jobId: jobId('j1'), title: 'Fix the sidebar flake' }] }
export const twoJobsOrigin: Origin = {
  _tag: 'job',
  jobs: [
    { jobId: jobId('j1'), title: 'Fix the sidebar flake' },
    { jobId: jobId('j2'), title: 'Bump Electron to 44' },
  ],
}

/* Statuses ---------------------------------------------------------------- */

export const open: CardStatus = { _tag: 'open' }
export const working: CardStatus = { _tag: 'working' }
export const mayHaveHappened: CardStatus = { _tag: 'open', mayHaveHappened: true }
export const dismissed: CardStatus = { _tag: 'dismissed' }
export const expired: CardStatus = { _tag: 'expired' }
export const done = (line: string, extra: { readonly undo?: true; readonly open?: OpenTarget } = {}): CardStatus => ({ _tag: 'done', line, ...extra })
export const failed = (line: string, retry = true, mayDuplicate?: true): CardStatus => ({ _tag: 'failed', line, ...(retry ? { retry: true as const } : {}), ...(mayDuplicate ? { mayDuplicate } : {}) })

/* Cards ------------------------------------------------------------------- */

const result = {
  pending: { _tag: 'pending' } satisfies SendResult,
  sending: { _tag: 'sending' } satisfies SendResult,
  sent: { _tag: 'sent', open: { _tag: 'topic', topicId: topics.postgres.topicId } } satisfies SendResult,
  notSent: { _tag: 'notSent' } satisfies SendResult,
  unknown: { _tag: 'unknown', check: { _tag: 'topic', topicId: topics.postgres.topicId } } satisfies SendResult,
} as const

const proposed = (id: string, target: Place, textValue: string, r: SendResult = result.pending, inTopic?: TopicLink) => ({
  id: proposedId(id),
  target,
  text: textValue,
  result: r,
  ...(inTopic === undefined ? {} : { inTopic }),
})

export const sendMessage = (id: string, cardStatus: CardStatus = open, results: ReadonlyArray<SendResult> = [result.pending], extra: { readonly because?: string } = {}): Card => ({
  _tag: 'sendMessage',
  id: cardId(id),
  status: cardStatus,
  ...extra,
  messages: [
    proposed(`${id}-1`, places.eng, 'The migration plan is in the thread. I can take the index rebuild on Thursday if that helps.', results[0] ?? result.pending, topics.postgres),
    ...(results.length > 1 ? [proposed(`${id}-2`, places.maya, 'Thanks for the agenda. Wednesday at 2 works for me.', results[1] ?? result.pending)] : []),
    ...(results.length > 2 ? [proposed(`${id}-3`, places.hiring, 'Leaning yes on the backend candidate. Happy to do the follow-up call.', results[2] ?? result.pending)] : []),
  ],
})

export const resolve = (id: string, cardStatus: CardStatus = open, count: 1 | 2 | 3 = 2): Card => ({
  _tag: 'resolve',
  id: cardId(id),
  status: cardStatus,
  topics: [topics.pricing, topics.offsite, topics.flake].slice(0, count),
})

export const topicsCard = (id: string): Card => ({ _tag: 'topics', id: cardId(id), status: open, links: [topics.postgres, topics.offsite, topics.hiring] })

export const task = (id: string, phase: Extract<Card, { _tag: 'task' }>['phase'], extra: Partial<Pick<Extract<Card, { _tag: 'task' }>, 'state' | 'open' | 'because' | 'kind' | 'title' | 'where'>> = {}): Card => ({
  _tag: 'task',
  id: cardId(id),
  jobId: jobId(`job-${id}`),
  kind: 't3',
  title: 'Fix the sidebar flake',
  where: 'juno',
  phase,
  ...extra,
})

export const proposedTask = (id: string, cardStatus: CardStatus = open): Card => ({
  _tag: 'proposedTask',
  id: cardId(id),
  status: cardStatus,
  kind: 't3',
  title: 'Fix the sidebar flake',
  where: 'juno',
  because: 'a message from #eng was in this reply',
})

export const question = (id: string, asks: 'juno' | 't3', freeText: boolean, cardStatus: CardStatus = open): Card => ({
  _tag: 'question',
  id: cardId(id),
  status: cardStatus,
  asks: asks === 'juno' ? { _tag: 'juno' } : { _tag: 't3', job: { jobId: jobId('j1'), title: 'Fix the sidebar flake' } },
  prompt: asks === 'juno' ? 'Two topics look like the same offsite thread. Keep both, or merge them?' : 'The flake comes from a shared fixture. Should I split the fixture per test, or add a retry?',
  options: asks === 'juno' ? [{ id: optionId('keep'), label: 'Keep both' }, { id: optionId('merge'), label: 'Merge them' }] : [{ id: optionId('split'), label: 'Split the fixture per test' }, { id: optionId('retry'), label: 'Add a retry' }, { id: optionId('skip'), label: 'Skip the test for now' }],
  freeText,
})

export const schedule = (id: string, cardStatus: CardStatus = open): Card => ({
  _tag: 'schedule',
  id: cardId(id),
  status: cardStatus,
  scheduleId: scheduleId(`s-${id}`),
  what: 'Catch you up on #eng',
  when: 'Weekdays at 9:00',
  deliver: 'digest',
})

export const proposedSchedule = (id: string, cardStatus: CardStatus = open): Card => ({
  _tag: 'proposedSchedule',
  id: cardId(id),
  status: cardStatus,
  what: 'Watch #alerts-prod for pages',
  when: 'Every 15 minutes',
  deliver: 'now',
  prompt: 'Read #alerts-prod since the last run. If a page fired and nobody has replied within 10 minutes, tell me who is on call and what the alert says. Say nothing if there is nothing new.',
  because: 'a message from #alerts-prod was in this reply',
})

export const connect = (id: string, cardStatus: CardStatus = open): Card => ({
  _tag: 'connect',
  id: cardId(id),
  status: cardStatus,
  server: 'Notion',
  scopes: ['Read pages', 'Write pages', 'Search'],
  leaves: 'Page titles and the text Juno writes go to Notion. Nothing from Slack goes there unless you approve a card.',
})

export const change = (id: string, cardStatus: CardStatus = open, long = false): Card => ({
  _tag: 'change',
  id: cardId(id),
  status: cardStatus,
  server: 'Notion',
  target: 'Offsite agenda',
  fields: [
    { name: 'Date', before: 'Wednesday 22 Oct', after: 'Thursday 23 Oct' },
    { name: 'Owner', after: 'Maya Chen' },
    ...(long
      ? [
          {
            name: 'Notes',
            before: 'Morning: roadmap. Afternoon: open.',
            after:
              'Morning: roadmap review with the whole team, one slide per area, ten minutes each.\nLate morning: the Postgres 16 plan and the index rebuild window.\nLunch at the usual place.\nAfternoon: hiring loop retro, then open time for pairing.\nEnd of day: decide the pricing page copy and who owns the follow-up.\nEvening: dinner, optional.\nNext morning: write-up and owners for every decision.',
            long: true as const,
          },
        ]
      : []),
  ],
  caption: 'Moves the offsite a day later, as you asked Maya.',
})

export const remove = (id: string, cardStatus: CardStatus = open): Card => ({
  _tag: 'remove',
  id: cardId(id),
  status: cardStatus,
  messages: [
    { messageId: messageId('m-40'), preview: 'The offsite is on the 22nd, book the room by Friday', at: NOW - 2 * DAY },
    { messageId: messageId('m-41'), preview: 'Actually make that the 23rd', at: NOW - 2 * DAY + 5 * MINUTE },
  ],
  offerReply: messageId('m-42'),
})

export const budget = (id: string, cardStatus: CardStatus = open): Card => ({ _tag: 'budget', id: cardId(id), status: cardStatus, spentTodayUsd: 2, capUsd: 2 })

export const provider = (id: string, cardStatus: CardStatus = open): Card => ({
  _tag: 'provider',
  id: cardId(id),
  status: cardStatus,
  options: [
    { id: 'openrouter', label: 'OpenRouter', note: 'Needs an API key' },
    { id: 'codex', label: 'Codex', note: 'Uses your ChatGPT plan on this Mac' },
  ],
})

export const unknownCard = (id: string): Card => ({ _tag: 'unknown', id: cardId(id), kind: 'calendarHold' })

export const results = result

/* Transcripts ------------------------------------------------------------- */

/** The mock's transcript: two owner bubbles, a reply with a citation, a Send card, a remembered line, a Task card. */
export const conversation: ReadonlyArray<ChatItem> = [
  day(0),
  owner('m-1', 'What did I miss in #eng this morning?', 'first', { _tag: 'sent' }, NOW - 12 * MINUTE),
  owner('m-2', 'And remind me when the offsite is', 'last', { _tag: 'sent' }, NOW - 11 * MINUTE),
  juno(
    'm-3',
    [
      text('Two things in #eng: Maya posted the Postgres 16 migration plan and asked for a reviewer, and the CI flake on the sidebar test is back. The offsite is on the 23rd. '),
      cite('On 2 Oct you said', 'm-40'),
      text(' you wanted the room booked by the Friday before.'),
    ],
    { group: 'first', at: NOW - 10 * MINUTE },
  ),
  juno('m-4', 'I can tell Maya you will review the plan. Here is what I would send.', { group: 'last', at: NOW - 10 * MINUTE, cards: [sendMessage('c-1')] }),
  { _tag: 'note', id: messageId('m-5'), kind: 'remembered', text: 'The offsite is on the 23rd', undo: true },
  owner('m-6', 'Start a session to fix the flake', 'single', { _tag: 'sent' }, NOW - 6 * MINUTE),
  juno('m-7', 'Started T3 Code on juno. I will say when it needs you or when there is a PR.', { at: NOW - 5 * MINUTE, cards: [task('c-2', 'running', { state: 'Tests running, 2 of 5', open: { _tag: 'url', url: 'https://t3.example/thread/1', label: 'Open' } })] }),
]

const paragraph =
  'Here is the long version. The migration plan has three phases: a dual-write window where both schemas get every write, a backfill that runs in 200-row batches so the sync never blocks, and a cutover that flips the read path behind a flag. Maya wants a reviewer for the backfill, because the index rebuild takes about forty minutes on the large workspace and the plan has it running inside the dual-write window. The flake on the sidebar test is unrelated: the fake server sometimes answers the second page before the first, and the test asserts on the order. Leo has a fix in a branch but has not opened the PR. Nothing else needs you today.'

/** A very long reply, a long owner message, a long status line and a long card. */
export const longText: ReadonlyArray<ChatItem> = [
  day(0),
  owner('m-10', `Can you give me the long version of what happened in #eng this week? I want every thread, who asked for what, what is blocked and what is just waiting, and anything I promised someone and have not done. Skip the alerts channel unless something paged. ${'Also include the hiring loop. '.repeat(6)}`, 'single', { _tag: 'sent' }, NOW - 20 * MINUTE),
  juno('m-11', `${paragraph}\n\n${paragraph}`, { at: NOW - 18 * MINUTE, cards: [sendMessage('c-10', open, [result.pending, result.pending, result.pending])] }),
  status('m-12', 'Looking back through March, April and the first half of May for anything about the offsite room booking'),
]

const rtlOwner = 'מה פספסתי ב-#eng הבוקר? ותזכיר לי מתי היום של הצוות'
const rtlJuno = 'שני דברים ב-#eng: מאיה פרסמה את תוכנית המעבר ל-Postgres 16 וביקשה סוקר, והבדיקה הרעועה של הסרגל הצדדי חזרה. היום של הצוות הוא ב-23.'

/** Right-to-left text in both bubbles, in a card and in the status line. */
export const rightToLeft: ReadonlyArray<ChatItem> = [
  day(0),
  owner('m-20', rtlOwner, 'single', { _tag: 'sent' }, NOW - 9 * MINUTE),
  juno('m-21', rtlJuno, {
    at: NOW - 8 * MINUTE,
    cards: [
      {
        _tag: 'question',
        id: cardId('c-20'),
        status: open,
        asks: { _tag: 'juno' },
        prompt: 'שני נושאים נראים כמו אותו שרשור. לשמור את שניהם, או למזג?',
        options: [
          { id: optionId('keep'), label: 'לשמור את שניהם' },
          { id: optionId('merge'), label: 'למזג אותם' },
        ],
        freeText: true,
      },
    ],
  }),
  status('m-22', 'קורא 3 נושאים'),
]

/** One Juno message carrying every card kind at once. */
export const manyCards: ReadonlyArray<ChatItem> = [
  day(0),
  owner('m-30', 'Do everything at once', 'single', { _tag: 'sent' }, NOW - 9 * MINUTE),
  juno('m-31', 'Here is everything, one card each.', {
    at: NOW - 8 * MINUTE,
    cards: [
      sendMessage('c-30', open, [result.pending, result.pending, result.pending]),
      resolve('c-31'),
      topicsCard('c-32'),
      task('c-33', 'running', { state: 'Tests running, 2 of 5' }),
      proposedTask('c-34'),
      question('c-35', 't3', true),
      schedule('c-36'),
      proposedSchedule('c-37'),
      connect('c-38'),
      change('c-39', open, true),
      remove('c-40'),
      budget('c-41'),
      provider('c-42'),
      unknownCard('c-43'),
    ],
  }),
]

/** A Send message card where one row failed and one may have landed. */
export const failedSend: ReadonlyArray<ChatItem> = [
  day(0),
  owner('m-50', 'Send the three replies', 'single', { _tag: 'sent' }, NOW - 9 * MINUTE),
  juno('m-52', 'Sent one. The DM did not go through, and I cannot tell about #hiring.', {
    at: NOW - 8 * MINUTE,
    cards: [sendMessage('c-50', done('Sent 1 of 3'), [result.sent, result.notSent, result.unknown])],
  }),
]

/** A run the owner stopped while a job it started runs on. */
export const stoppedRun: ReadonlyArray<ChatItem> = [
  day(0),
  owner('m-60', 'Fix the flake and then tidy up the old threads', 'single', { _tag: 'sent' }, NOW - 9 * MINUTE),
  juno('m-61', 'Started T3 Code on juno. Now looking at the threads from last', {
    at: NOW - 8 * MINUTE,
    ending: { _tag: 'stopped' },
    cards: [task('c-60', 'running', { state: 'Reading the test', open: { _tag: 'url', url: 'https://t3.example/thread/1', label: 'Open' } })],
  }),
]

/** A proactive group from a schedule, with the label and its quiet action. */
export const scheduled: ReadonlyArray<ChatItem> = [
  day(0),
  { _tag: 'groupLabel', id: 'g-1', origin: scheduleOrigin, text: 'Scheduled · Daily catch-up' },
  juno('m-70', 'Quiet night in #eng. One thing: the Postgres 16 plan got two more comments, both about the index rebuild window.', { origin: scheduleOrigin, at: NOW - 30 * MINUTE, unread: true, cards: [topicsCard('c-70')] }),
]

/** A proactive group from two jobs that reported together. */
export const jobs: ReadonlyArray<ChatItem> = [
  day(0),
  { _tag: 'groupLabel', id: 'g-2', origin: twoJobsOrigin, text: 'T3 Code · 2 jobs' },
  juno('m-80', 'Two updates. The flake fix has a PR. The Electron bump failed on the native module build.', {
    origin: twoJobsOrigin,
    at: NOW - 15 * MINUTE,
    unread: true,
    cards: [task('c-80', 'done', { open: { _tag: 'url', url: 'https://github.com/example/juno/pull/412', label: 'Open PR 412' } }), task('c-81', 'failed', { title: 'Bump Electron to 44' })],
  }),
]

/** Yesterday, then the New divider, then today's unread reply. */
export const withNewDivider: ReadonlyArray<ChatItem> = [
  day(1),
  owner('m-90', 'Summarize the pricing thread', 'single', { _tag: 'sent' }, NOW - DAY - 3 * HOUR),
  juno('m-91', 'Three people want the monthly price on the page, one wants the annual only. No decision yet.', { at: NOW - DAY - 3 * HOUR + MINUTE }),
  { _tag: 'newDivider', count: 1 },
  day(0),
  { _tag: 'groupLabel', id: 'g-3', origin: scheduleOrigin, text: 'Scheduled · Daily catch-up' },
  juno('m-92', 'The pricing thread settled on monthly, with the annual price under it. Leo owns the copy.', { origin: scheduleOrigin, at: NOW - 30 * MINUTE, unread: true }),
]
