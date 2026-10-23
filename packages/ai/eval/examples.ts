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
import { INSTRUCTION_NOTIFY_CONFIDENCE, INSTRUCTION_STAY_CONFIDENCE, NEEDS_YOU_THRESHOLD, type Instruction } from '@juno/domain'

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

const applyGrammar = (draft: string, edits: ReadonlyArray<{ start: number; from: string; to: string }>): string => {
  for (const edit of edits.toReversed()) draft = draft.slice(0, edit.start) + edit.to + draft.slice(edit.start + edit.from.length)
  return draft
}

export const examples: ReadonlyArray<Example> = [
  ex(tasks.grammarCheck, "its broken", { draft: "its broken" }, (o) => applyGrammar("its broken", o.edits) === "it's broken"),
  ex(tasks.grammarCheck, "it's owner is here", { draft: "it's owner is here" }, (o) => applyGrammar("it's owner is here", o.edits) === "its owner is here"),
  ex(tasks.grammarCheck, "your welcome", { draft: "your welcome" }, (o) => applyGrammar("your welcome", o.edits) === "you're welcome"),
  ex(tasks.grammarCheck, "you're report is ready", { draft: "you're report is ready" }, (o) => applyGrammar("you're report is ready", o.edits) === "your report is ready"),
  ex(tasks.grammarCheck, "their is a problem", { draft: "their is a problem" }, (o) => applyGrammar("their is a problem", o.edits) === "there is a problem"),
  ex(tasks.grammarCheck, "there ready", { draft: "there ready" }, (o) => applyGrammar("there ready", o.edits) === "they're ready"),
  ex(tasks.grammarCheck, "they're report is ready", { draft: "they're report is ready" }, (o) => applyGrammar("they're report is ready", o.edits) === "their report is ready"),
  ex(tasks.grammarCheck, "this is faster then before", { draft: "this is faster then before" }, (o) => applyGrammar("this is faster then before", o.edits) === "this is faster than before"),
  ex(tasks.grammarCheck, "this will effect the build", { draft: "this will effect the build" }, (o) => applyGrammar("this will effect the build", o.edits) === "this will affect the build"),
  ex(tasks.grammarCheck, "the affect was clear", { draft: "the affect was clear" }, (o) => applyGrammar("the affect was clear", o.edits) === "the effect was clear"),
  ex(tasks.grammarCheck, "we might loose the file", { draft: "we might loose the file" }, (o) => applyGrammar("we might loose the file", o.edits) === "we might lose the file"),
  ex(tasks.grammarCheck, "we could of shipped", { draft: "we could of shipped" }, (o) => applyGrammar("we could of shipped", o.edits) === "we could have shipped"),
  ex(tasks.grammarCheck, "we need send it", { draft: "we need send it" }, (o) => applyGrammar("we need send it", o.edits) === "we need to send it"),
  ex(tasks.grammarCheck, "send the the report", { draft: "send the the report" }, (o) => applyGrammar("send the the report", o.edits) === "send the report"),
  ex(tasks.grammarCheck, "they is ready", { draft: "they is ready" }, (o) => applyGrammar("they is ready", o.edits) === "they are ready"),
  ex(tasks.grammarCheck, "i think so", { draft: "i think so" }, (o) => applyGrammar("i think so", o.edits) === "i think so"),
  ex(tasks.grammarCheck, "i like its colour", { draft: "i like its colour" }, (o) => applyGrammar("i like its colour", o.edits) === "i like its colour"),
  ex(tasks.grammarCheck, "it's ready and you're welcome", { draft: "it's ready and you're welcome" }, (o) => applyGrammar("it's ready and you're welcome", o.edits) === "it's ready and you're welcome"),
  ex(tasks.grammarCheck, "their report is there", { draft: "their report is there" }, (o) => applyGrammar("their report is there", o.edits) === "their report is there"),
  ex(tasks.grammarCheck, "lol brb rn \ud83d\udc4d", { draft: "lol brb rn \ud83d\udc4d" }, (o) => applyGrammar("lol brb rn \ud83d\udc4d", o.edits) === "lol brb rn \ud83d\udc4d"),
  ex(tasks.grammarCheck, "ship when ready...", { draft: "ship when ready..." }, (o) => applyGrammar("ship when ready...", o.edits) === "ship when ready..."),
  ex(tasks.grammarCheck, "`its broken`", { draft: "`its broken`" }, (o) => applyGrammar("`its broken`", o.edits) === "`its broken`"),
  ex(tasks.grammarCheck, "```\nits broken\n```", { draft: "```\nits broken\n```" }, (o) => applyGrammar("```\nits broken\n```", o.edits) === "```\nits broken\n```"),
  ex(tasks.grammarCheck, "https://example.test/its", { draft: "https://example.test/its" }, (o) => applyGrammar("https://example.test/its", o.edits) === "https://example.test/its"),
  ex(tasks.grammarCheck, "@its <@U123> :its:", { draft: "@its <@U123> :its:" }, (o) => applyGrammar("@its <@U123> :its:", o.edits) === "@its <@U123> :its:"),
  ex(tasks.grammarCheck, "> its broken", { draft: "> its broken" }, (o) => applyGrammar("> its broken", o.edits) === "> its broken"),
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


  ...readingExamples(),
  ex(tasks.instructionRule, 'always for one person', { text: 'Always notify me when Maya messages me', people: [people[0]!], channels: [] }, (o) => o.rule?.kind === 'person' && o.rule.id === 'U0MAYA' && o.rule.level === 'always'),
  ex(tasks.instructionRule, 'never for one channel', { text: "Don't notify me about #eng", people: [], channels: [channels[0]!] }, (o) => o.rule?.kind === 'channel' && o.rule.id === 'C0ENG' && o.rule.level === 'never'),
  ex(tasks.instructionRule, 'a subject from one person is not a rule', { text: 'Notify me when Maya asks about the budget', people: [people[0]!], channels: [] }, (o) => o.rule === null),
  ex(tasks.instructionRule, 'a subject is not a rule', { text: 'social plans', people: [], channels: [] }, (o) => o.rule === null),

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

  ex(
    tasks.followUps,
    'a promise with no result yet',
    {
      topicId: postgres.id,
      title: postgres.title,
      channel: '#eng',
      now: NOW,
      messages: [
        { ...m('Dev Patel', 'Can someone send Rina the scorecard before Friday?', 60), id: '1728800000.000100' },
        { ...m('Tushar', "I'll send Rina the scorecard tomorrow.", 50), fromMe: true, id: '1728800000.000200' },
      ],
    },
    (o) => o.followUps.length === 1 && o.followUps[0]?.messageId === '1728800000.000200',
  ),
  ex(
    tasks.followUps,
    'a promise already kept',
    {
      topicId: postgres.id,
      title: postgres.title,
      channel: '#eng',
      now: NOW,
      messages: [
        { ...m('Tushar', "I'll book the staging dry run.", 90), fromMe: true, id: '1728800000.000300' },
        { ...m('Tushar', 'Done, booked for Thursday 2pm.', 30), fromMe: true, id: '1728800000.000400' },
      ],
    },
    (o) => o.followUps.length === 0,
  ),
  ex(
    tasks.homeTitle,
    'someone asked a question',
    {
      itemId: `waiting:${postgres.id}`,
      kind: 'waiting',
      title: postgres.title,
      channel: '#eng',
      newCount: 1,
      messages: [m('Dev Patel', 'Tushar, can you pick the cutover window by Friday?', 10)],
    },
    (o) => o.title.length > 0,
  ),
  ex(
    tasks.automatedChannel,
    'an alerts channel where only an app posts',
    {
      channelId: 'C0CIBUILDS',
      channel: '#ci-builds',
      messages: [
        { ...m('CI', 'main #4812 passed in 9m 12s', 90), fromApp: true },
        { ...m('CI', 'main #4813 failed: 2 tests in api/search', 60), fromApp: true },
        { ...m('CI', 'main #4814 passed in 9m 40s', 30), fromApp: true },
        { ...m('CI', 'release/2.3 #77 passed in 11m 2s', 10), fromApp: true },
      ],
    },
    (o) => o.probability >= 0.85,
  ),
  ex(
    tasks.automatedChannel,
    'people working through the alerts an app posts',
    {
      channelId: 'C0ONCALL',
      channel: '#oncall',
      messages: [
        { ...m('Grafana', '[FIRING] api p95 > 800ms (prod-eu)', 90), fromApp: true },
        m('Jonas Weber', 'Looking. Probably the search index again.', 85),
        m('Dev Patel', 'I rolled back the last deploy, watch the graph.', 70),
        { ...m('Grafana', '[RESOLVED] api p95 > 800ms (prod-eu)', 60), fromApp: true },
        m('Jonas Weber', 'Back to normal. Writing it up in the incident doc.', 55),
      ],
    },
    (o) => o.probability < 0.5,
  ),
  ex(
    tasks.automatedChannel,
    'a project channel where a meeting-notes app posts and people talk',
    {
      channelId: 'C0PROJNOTES',
      channel: '#proj-meeting-notes',
      messages: [
        { ...m('Notetaker', 'Notes from Weekly sync: launch date, pricing page, beta feedback', 120), fromApp: true },
        m('Maya Chen', 'Thanks. I think the launch date slipped to the 28th, not the 21st.', 110),
        m('Dev Patel', 'Right, the 28th. I will fix it in the doc.', 105),
        { ...m('Notetaker', 'Notes from Design review: onboarding flow, empty states', 60), fromApp: true },
        m('Elena Ruiz', 'Can someone share the Figma link from the review?', 50),
        { ...m('Notetaker', 'Notes from Pricing call: annual discount, seat minimums', 20), fromApp: true },
        m('Maya Chen', 'Seat minimum of 5 felt high to me. Let us talk Thursday.', 10),
      ],
    },
    (o) => o.probability <= 0.4,
  ),
]

/** The structured examples, which carry an expectation. */
export const decisionExamples: ReadonlyArray<Example & { readonly expect: (output: never) => boolean }> = examples.filter(
  (e): e is Example & { readonly expect: (output: never) => boolean } => e.expect !== undefined,
)

type ReadingInput = Parameters<typeof tasks.notificationReading.render>[0]
type ReadingOutput = Static<typeof tasks.notificationReading.output>

/** Whether a reading notifies, with the thresholds `decideNotification` applies. */
function notifies(o: ReadingOutput, instructions: ReadonlyArray<Instruction>): boolean {
  const chosen = instructions.find((item) => item.id === o.instruction?.id)
  if (chosen !== undefined && o.instruction !== null) {
    if (chosen.direction === 'notify' && o.instruction.confidence >= INSTRUCTION_NOTIFY_CONFIDENCE) return true
    if (chosen.direction === 'stay' && o.instruction.confidence >= INSTRUCTION_STAY_CONFIDENCE) return false
  }
  const p = o.probabilities
  return (p['ask'] ?? 0) + (p['answer'] ?? 0) + (p['follow_up'] ?? 0) + (p['decision'] ?? 0) + (p['serious'] ?? 0) >= NEEDS_YOU_THRESHOLD
}

function readingExamples(): ReadonlyArray<Example> {
  const noFacts = { ownerWroteLast: false, ownerStartedThread: false, senderWroteSinceOwner: false, exchangesLast30Days: 0 }
  const greetings: Instruction = { id: 'i1', direction: 'stay', text: 'greetings' }
  const social: Instruction = { id: 'i2', direction: 'stay', text: 'social plans' }
  const contracts: Instruction = { id: 'i3', direction: 'notify', text: 'anything about the contract renewal' }
  let n = 0
  const reading = (label: string, input: Partial<ReadingInput> & Pick<ReadingInput, 'sender' | 'text'>, notify: boolean): Example => {
    const full: ReadingInput = { messageTs: `1728812${String(n++).padStart(3, '0')}.000100`, where: input.sender, kind: 'dm', mentionsMe: false, now: NOW, before: [], facts: noFacts, instructions: [], ...input }
    return ex(tasks.notificationReading, label, full, (o) => notifies(o, full.instructions) === notify)
  }
  return [
    reading('incident in a channel', { where: '#incidents', kind: 'channel', sender: 'Jonas Weber', text: 'Checkout is returning 500s for about 20% of requests since 09:05. @tushar could use a second pair of eyes.', mentionsMe: true }, true),
    reading('question in a DM with a deadline', { sender: 'Maya Chen', text: 'Can you review the pricing page copy before the 2pm call?' }, true),
    reading('a mixed greeting and ask, with a greetings instruction', { sender: 'Sam Okafor', text: 'hey! can you approve the contract by 3?', instructions: [greetings] }, true),
    reading('a bare greeting, with a greetings instruction', { sender: 'Sam Okafor', text: 'hey, morning!', instructions: [greetings] }, false),
    reading('a cold greeting', { sender: 'Priya Raman', text: 'hi Tushar 👋' }, false),
    reading('lunch plans, with a social plans instruction', { sender: 'Leo Park', text: 'lunch at the ramen place at 1? Elena is in too', instructions: [social, greetings] }, false),
    reading('an answer to my question', { sender: 'Elena Ruiz', text: 'Yes, the Figma file has the final version.', before: [m('Tushar', 'Is the Figma file final?', 20, true)] }, true),
    reading('a follow-up I did not answer', { sender: 'Dev Patel', text: 'Any thoughts on the migration window? Need to book it today.', before: [m('Dev Patel', 'Can you pick a migration window?', 120)], facts: { ...noFacts, senderWroteSinceOwner: true } }, true),
    reading('status update in a channel', { where: '#platform', kind: 'channel', sender: 'Dev Patel', text: 'FYI the nightly backup job moved to 02:00 UTC. No action needed.', mentionsMe: true }, false),
    reading('chatter in a thread', { where: '#social', kind: 'thread', sender: 'Priya Raman', text: 'haha the cake was great', threadRoot: m('Elena Ruiz', 'Cake in the kitchen!', 30) }, false),
    reading('a contract update, with a contract instruction', { where: '#legal', kind: 'channel', sender: 'Maya Chen', text: 'Contract renewal draft from Acme just came in, redlines attached.', instructions: [contracts, greetings] }, true),
    reading('a blocked person in a thread I started', { where: '#eng', kind: 'thread', sender: 'Sam Okafor', text: 'I cannot merge the schema PR until you approve it, and the release cut is at 15:00.', threadRoot: m('Tushar', 'Schema PR for the billing tables', 60, true), facts: { ...noFacts, ownerStartedThread: true } }, true),
  ]
}
