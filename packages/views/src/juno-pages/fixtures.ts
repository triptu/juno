/** Invented page data for the gallery. Times are relative to `NOW`. */
import type { ActivityPage, ConnectionsPage, JunoSettingsPage, MemoryDocsPage, MemoryEntryId, MemoryPage, MemoryPerson, MemoryPersonId, RemembersPage, ScheduledPage } from '@juno/agent-contract'
import type { Person } from '@juno/contract'
import { NOW } from '../juno-chat/fixtures/data'
import { people as slackPeople } from '../fixtures/topics'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const sid = (id: string) => id as ScheduledPage['schedules'][number]['id']
const pid = (id: string) => id as RemembersPage['pins'][number]['id']
const mid = (id: string) => id as NonNullable<RemembersPage['pins'][number]['source']>['messageId']
const rid = (id: string) => id as ActivityPage['runs'][number]['id']
const cid = (id: string) => id as ConnectionsPage['connections'][number]['id']
const hash = (digit: string) => digit.repeat(64) as NonNullable<ConnectionsPage['connections'][number]['tools'][number]['schemaHash']>
const jid = (id: string) => id as NonNullable<JunoSettingsPage['removalPending']>['jobId']

export { NOW }

export const scheduled: ScheduledPage = {
  schedules: [
    { id: sid('s1'), what: 'Catch you up on #eng', when: 'Weekdays at 9:00', nextAt: NOW + DAY - 30 * MINUTE, deliver: 'digest', state: 'active' },
    { id: sid('s2'), what: 'Watch #alerts-prod for pages', when: 'Every 15 minutes', nextAt: NOW + 7 * MINUTE, deliver: 'now', state: 'active' },
    { id: sid('s3'), what: 'Remind me about the offsite room', when: 'Once, 17 Oct at 14:00', nextAt: NOW + 3 * DAY, deliver: 'silent', state: 'active' },
    { id: sid('s4'), what: 'Summarize the pricing thread', when: 'Mondays at 8:30', deliver: 'digest', state: 'paused', selfPaused: true },
  ],
}

export const remembers: RemembersPage = {
  pins: [
    { id: pid('p1'), text: 'The offsite is on the 23rd', source: { messageId: mid('m-1'), at: NOW - 2 * DAY }, at: NOW - 2 * DAY },
    { id: pid('p2'), text: 'Maya owns the Postgres 16 plan', source: { messageId: mid('m-2'), at: NOW - 5 * DAY }, at: NOW - 5 * DAY },
    { id: pid('p3'), text: 'I review PRs on Tuesday and Thursday mornings', at: NOW - 12 * DAY },
    { id: pid('p4'), text: 'Never message #general for me', source: { messageId: mid('m-4'), at: NOW - 20 * DAY }, at: NOW - 20 * DAY, changed: true },
  ],
  usedBytes: 1240,
  budgetBytes: 4096,
}

export const remembersFull: RemembersPage = { ...remembers, usedBytes: 4096 }

const eid = (id: string) => id as MemoryEntryId
const slack = { _tag: 'slack' } as const
const own = { _tag: 'owner' } as const
const littlebird = { _tag: 'connection', name: 'Littlebird' } as const

/** Juno's notes about an invented owner, from their words, Slack and Littlebird. */
export const docs: MemoryDocsPage = {
  docs: [
    { doc: 'you', entries: [
      { id: eid('e1'), text: 'Staff engineer on the sync team. Leads the Postgres 16 migration.', source: slack, outside: true, at: NOW - 2 * DAY },
      { id: eid('e2'), text: 'Works from Lisbon, usually 9:30 to 18:00.', source: own, outside: false, at: NOW - 6 * DAY },
    ] },
    { doc: 'people', entries: [
      { id: eid('e3'), text: 'The platform team reviews PRs on Tuesday and Thursday mornings.', source: slack, outside: true, at: NOW - 2 * DAY },
      { id: eid('e4'), text: 'Design reviews are on Wednesdays with the whole product team.', source: littlebird, outside: true, at: NOW - 2 * DAY },
    ] },
    { doc: 'projects', entries: [
      { id: eid('e6'), text: 'Postgres 16 migration: dual-write window, then a backfill in 200-row batches, then the cutover behind a flag.', source: slack, outside: true, at: NOW - 2 * DAY },
    ] },
    { doc: 'preferences', entries: [] },
    { doc: 'style', entries: [
      { id: eid('e7'), text: 'Short messages, mostly lowercase, no sign-off. Opens with "hey" in DMs and with the point in channels.', source: slack, outside: true, at: NOW - 2 * DAY },
      { id: eid('e8'), text: 'Uses "sgtm" and "will do"; one emoji at most, usually 🙏.', source: slack, outside: true, at: NOW - 2 * DAY },
    ] },
  ],
  people: [],
  changes: [
    { id: 'w7', doc: 'people', person: 'Maya Chen', kind: 'add', by: 'juno', text: 'Short and direct, mostly lowercase. Replies within the hour.', source: slack, outside: true, at: NOW - 3 * HOUR },
    { id: 'w6', doc: 'people', person: 'Priya Raman', kind: 'update', by: 'owner', text: 'Your manager. Weekly 1:1 on Thursdays at 11.', source: own, outside: false, at: NOW - DAY },
    { id: 'w5', doc: 'you', kind: 'update', by: 'owner', text: 'Works from Lisbon, usually 9:30 to 18:00.', source: own, outside: false, at: NOW - 6 * DAY + HOUR },
    { id: 'w4', doc: 'people', kind: 'add', by: 'juno', text: 'Priya Raman: manager. Weekly 1:1 on Thursdays.', source: littlebird, outside: true, at: NOW - 2 * DAY },
    { id: 'w3', doc: 'style', kind: 'add', by: 'juno', text: 'Short messages, mostly lowercase, no sign-off. Opens with "hey" in DMs and with the point in channels.', source: slack, outside: true, at: NOW - 2 * DAY },
    { id: 'w2', doc: 'projects', kind: 'remove', by: 'juno', text: 'Q3 pricing page refresh.', source: slack, outside: true, at: NOW - 3 * DAY, undone: true },
    { id: 'w1', doc: 'people', kind: 'remove', by: 'owner', source: own, outside: false, at: NOW - 4 * DAY },
  ],
}

const person = (id: string) => id as MemoryPersonId

/** Juno's files on the people the invented owner works with, most in touch first. */
export const people: ReadonlyArray<MemoryPerson> = [
  {
    id: person('U0MAYA'), name: 'Maya Chen', relationship: 'peer', relationshipBy: 'juno', revision: 2,
    work: 'Owns the Postgres 16 migration plan and the cutover runbook.',
    entries: [
      { id: eid('e10'), section: 'role', text: 'Head of product. You plan the roadmap together and split the offsite agenda.', source: slack, outside: true, at: NOW - 2 * DAY },
      { id: eid('e11'), section: 'work', text: 'Owns the Postgres 16 migration plan and the cutover runbook.', source: slack, outside: true, at: NOW - 2 * DAY },
      { id: eid('e12'), section: 'work', text: 'Writing the Q4 plan for Thursday\'s review.', source: slack, outside: true, at: NOW - 3 * HOUR },
      { id: eid('e13'), section: 'talk', text: 'Short and direct, mostly lowercase. Replies within the hour.', source: slack, outside: true, at: NOW - 3 * HOUR },
      { id: eid('e14'), section: 'talk', text: 'Prefers one line with the decision first, then the why.', source: own, outside: false, at: NOW - 5 * DAY },
      { id: eid('e15'), section: 'notes', text: 'In San Francisco. Your mornings overlap with her evenings.', source: slack, outside: true, at: NOW - 9 * DAY },
    ],
  },
  {
    id: person('U0PRIYA'), name: 'Priya Raman', relationship: 'manager', relationshipBy: 'owner', revision: 4,
    work: 'Design lead for the sidebar redesign and the early access flow.',
    entries: [
      { id: eid('e16'), section: 'role', text: 'Your manager. Weekly 1:1 on Thursdays at 11.', source: own, outside: false, at: NOW - DAY },
      { id: eid('e17'), section: 'work', text: 'Design lead for the sidebar redesign and the early access flow.', source: littlebird, outside: true, at: NOW - 4 * DAY },
      { id: eid('e18'), section: 'talk', text: 'Full sentences, a greeting first. Likes a short agenda before the 1:1.', source: slack, outside: true, at: NOW - 4 * DAY },
    ],
  },
  {
    id: person('U0LEO'), name: 'Leo Park', relationship: 'crossTeam', relationshipBy: 'juno', revision: 1,
    work: 'Fixes most of the sidebar test flakes and owns the preview environments.',
    entries: [
      { id: eid('e19'), section: 'work', text: 'Fixes most of the sidebar test flakes and owns the preview environments.', source: slack, outside: true, at: NOW - 9 * DAY },
    ],
  },
  // A file Juno just started: no relationship yet, nothing about their work.
  { id: person('U0SAM'), name: 'Sam Okafor', revision: 1, entries: [{ id: eid('e20'), section: 'notes', text: 'Berlin time. Out on Fridays in October.', source: slack, outside: true, at: NOW - 20 * MINUTE }] },
]

/** Their Slack profiles, for the avatars: three with photos, Priya with initials. */
export const faces: Readonly<Record<string, Person>> = { U0MAYA: slackPeople.maya, U0PRIYA: slackPeople.priya, U0LEO: slackPeople.leo, U0SAM: slackPeople.sam }

/** The page with person files and the general People notes after them. */
export const docsWithPeople: MemoryDocsPage = { ...docs, people }

export const docsEmpty: MemoryDocsPage = { docs: docs.docs.map((section) => ({ doc: section.doc, entries: [] })), people: [], changes: [] }

export const memory: MemoryPage = {
  lines: [
    { _tag: 'line', id: 'l1', from: NOW - 40 * DAY, to: NOW - 21 * DAY, text: 'You set up the daily #eng catch-up and asked Juno to keep the offsite date. The Postgres 16 plan started; Maya owns it.' },
    { _tag: 'masked', id: 'l2', from: NOW - 20 * DAY, to: NOW - 14 * DAY },
    { _tag: 'line', id: 'l3', from: NOW - 13 * DAY, to: NOW - 7 * DAY, text: 'The sidebar test flake came back twice. Leo has a fix in a branch. You asked Juno not to message #general for you.' },
    { _tag: 'line', id: 'l4', from: NOW - 6 * DAY, to: NOW - 2 * DAY, text: 'The offsite moved to the 23rd. The pricing thread settled on monthly with the annual price under it.' },
    { _tag: 'line', id: 'l5', from: NOW - DAY, to: NOW - DAY, text: 'You started a T3 Code session on the flake. It opened PR 412.' },
  ],
  coveredThrough: NOW - DAY,
}

type Run = ActivityPage['runs'][number]

const run = (id: string, at: number, fields: Partial<Omit<Run, 'id' | 'at'>> & Pick<Run, 'trigger'>): Run => ({
  id: rid(id), at, outcome: 'replied', actions: [], sources: [], steps: [], tainted: false, model: 'Claude Sonnet 5.5', costUsd: 0.004, ...fields,
})
const said = (words: string) => ({ _tag: 'message' as const, words, files: 0 })

/** A realistic three days: many runs a day, your messages beside schedules, jobs and card answers. */
export const activity: ActivityPage = {
  runs: [
    run('r1', NOW - 5 * MINUTE, {
      trigger: said('Catch me up on #eng and draft a reply to Maya about the Postgres 16 plan'),
      sources: ['#eng', 'Postgres 16 migration plan'],
      tainted: true,
      costUsd: 0.018,
      steps: [
        { label: 'Read #eng', result: '24 messages', outcome: 'done' },
        { label: 'Read a thread in #eng', result: '9 messages', outcome: 'done' },
        { label: 'Searched Slack', input: 'postgres 16 from:@maya', result: '3 messages', outcome: 'done' },
        { label: 'Drafted a message', result: 'Proposed a Send message card.', outcome: 'done' },
      ],
      actions: [{ id: 'a1', tier: 3, label: 'Message to Maya Chen', decision: 'approved', outcome: 'done' }],
    }),
    run('r2', NOW - 22 * MINUTE, {
      trigger: { _tag: 'schedule', name: 'Watch #alerts-prod for pages' },
      outcome: 'stayedQuiet',
      sources: ['#alerts-prod'],
      tainted: true,
      model: 'Claude Haiku 5.5',
      costUsd: 0.0006,
      steps: [{ label: 'Read #alerts-prod', result: '0 messages', outcome: 'done' }],
    }),
    run('r3', NOW - 41 * MINUTE, {
      trigger: said('what did Leo decide about the pricing page copy?'),
      sources: ['Slack', 'Littlebird'],
      tainted: true,
      costUsd: 0.011,
      reads: 'Ran 1 script: 3 reads, 1 cancelled',
      scriptCalls: [
        { tool: 'slack_search', args: '{"query":"pricing from:@leo"}', outcome: 'done' },
        { tool: 'slack_replies', args: '{"channel":"C0ENG","thread":"1760500000.000001"}', outcome: 'done' },
        { tool: 'connection_read', args: '{"server":"littlebird","tool":"search","args":{"query":"pricing copy"}}', outcome: 'cancelled' },
      ],
      steps: [{ label: 'Ran a script', result: 'Ran 3 reads.', outcome: 'done' }],
    }),
    run('r4', NOW - 58 * MINUTE, {
      trigger: { _tag: 'job', name: 'Fix the sidebar flake' },
      sources: ['the report from Fix the sidebar flake'],
      tainted: true,
      costUsd: 0.007,
      steps: [{ label: 'Used T3 Code: t3_thread_read', input: '{"threadId":"t-412"}', outcome: 'done' }],
    }),
    run('r5', NOW - 1.5 * HOUR, {
      trigger: { _tag: 'answer', question: 'Which branch should the fix start from?' },
      costUsd: 0.003,
      steps: [{ label: 'Proposed a T3 Code session', input: 'Fix the sidebar flake', result: 'Proposed a Proposed task card.', outcome: 'done' }],
      actions: [{ id: 'a2', tier: 2, label: 'Start Fix the sidebar flake', decision: 'approved', outcome: 'done' }],
    }),
    run('r6', NOW - 2 * HOUR, {
      trigger: said('remember that the offsite is on the 23rd'),
      costUsd: 0.002,
      steps: [{ label: 'Remembered a line', result: 'Remembered.', outcome: 'done' }],
      actions: [{ id: 'a3', tier: 1, label: 'Remember "the offsite is on the 23rd"', decision: 'noClick', outcome: 'done' }],
    }),
    run('r7', NOW - 2.5 * HOUR, {
      trigger: said('post the rollout note in #deploys and close the two old deploy threads'),
      outcome: 'failed',
      sources: ['#deploys'],
      tainted: true,
      costUsd: 0.009,
      steps: [
        { label: 'Read #deploys', result: '12 messages', outcome: 'done' },
        { label: 'Drafted a message', result: 'Proposed a Send message card.', outcome: 'done' },
        { label: 'Proposed resolving topics', result: 'Proposed a Resolve card.', outcome: 'done' },
        { label: 'Used Notion: notion-update-page', input: '{"page":"Rollout","status":"Shipped"}', result: 'The connection could not complete this request.', outcome: 'failed' },
      ],
      actions: [
        { id: 'a4', tier: 3, label: 'Message to #deploys', decision: 'approved', outcome: 'failed', failure: { text: 'It did not go through.', details: 'chat.postMessage: ratelimited (retry-after 30), attempt 2 of 2' } },
        { id: 'a5', tier: 3, label: 'Resolve 2 topics', decision: 'dismissed', outcome: 'none' },
        {
          id: 'a6', tier: 3, label: 'Change notion-update-page in Notion', decision: 'approved', outcome: 'done',
          review: { rule: 'auto', intent: 'implied', risk: 'reversible', line: "Asked because you didn't ask for exactly this." },
        },
      ],
    }),
    run('r8', NOW - 3 * HOUR, {
      trigger: { _tag: 'reaction', emoji: '🎉' },
      outcome: 'stayedQuiet',
      costUsd: 0.001,
    }),
    run('r9', NOW - 4 * HOUR, {
      trigger: { _tag: 'schedule', name: 'Catch you up on #eng' },
      sources: ['#eng', '#design-review', '#incidents'],
      tainted: true,
      costUsd: 0.021,
      steps: [
        { label: 'Read #eng', result: '31 messages', outcome: 'done' },
        { label: 'Read #design-review', result: '8 messages', outcome: 'done' },
        { label: 'Read #incidents', result: '2 messages', outcome: 'done' },
      ],
    }),
    ...Array.from({ length: 6 }, (_, n) =>
      run(`r1${n}`, NOW - DAY - n * 70 * MINUTE, {
        trigger: n % 3 === 2 ? { _tag: 'schedule', name: 'Watch #alerts-prod for pages' } : said(['is the hiring loop for Leo still on?', 'summarize #design-review since Monday', 'who owns the incident follow-ups?', 'draft a note to Priya about the launch'][n % 4]!),
        outcome: n % 3 === 2 ? 'stayedQuiet' : 'replied',
        sources: n % 3 === 2 ? ['#alerts-prod'] : n % 2 === 0 ? ['#hiring'] : ['#design-review', 'Notion'],
        tainted: true,
        model: n % 3 === 2 ? 'Claude Haiku 5.5' : 'Claude Sonnet 5.5',
        costUsd: n % 3 === 2 ? 0.0005 : 0.006 + n / 1000,
        steps: [{ label: n % 3 === 2 ? 'Read #alerts-prod' : 'Searched Slack', result: `${4 + n} messages`, outcome: 'done' }],
      }),
    ),
    run('r20', NOW - 3 * DAY, {
      trigger: said('stop'),
      outcome: 'interrupted',
      costUsd: 0.001,
    }),
    // A message since removed, from a run that made no request.
    { id: rid('r21'), at: NOW - 3 * DAY - HOUR, trigger: said(''), outcome: 'interrupted', actions: [], sources: [], steps: [], tainted: false },
  ],
  moreAbove: true,
}

/** 500 runs over two weeks, for the page's budget and its long scroll. */
export const activityLong: ActivityPage = {
  runs: Array.from({ length: 500 }, (_, n) => ({ ...activity.runs[n % 9]!, id: rid(`long-${n}`), at: NOW - n * 40 * MINUTE })),
  moreAbove: false,
}

export const connections: ConnectionsPage = {
  connections: [
    {
      id: cid('notion'),
      label: 'Notion',
      state: 'ready',
      address: 'https://mcp.notion.com/mcp',
      tools: [
        { name: 'notion-search', read: true, schemaHash: hash('1'), hint: 'Search pages and databases in the workspace', enabled: true, review: 'auto' },
        { name: 'notion-fetch', read: true, schemaHash: hash('2'), hint: 'Fetch a page by its id or URL', enabled: true, review: 'auto' },
        { name: 'notion-create-pages', read: false, schemaHash: hash('7'), hint: 'Create one or more pages in the workspace', enabled: true, review: 'auto' },
        { name: 'notion-update-page', read: false, schemaHash: hash('3'), hint: 'Change the content of a page', enabled: true, review: 'auto' },
        { name: 'notion-move-pages', read: false, schemaHash: hash('8'), hint: 'Move pages under another parent page or database', enabled: true, review: 'always' },
        { name: 'notion-duplicate-page', read: false, schemaHash: hash('9'), hint: 'Duplicate a page and its content', enabled: true, review: 'never' },
        { name: 'notion-create-comment', read: false, schemaHash: hash('a'), hint: 'Add a comment to a page or a discussion', enabled: true, review: 'auto' },
        { name: 'notion-delete-page', read: false, schemaHash: hash('b'), hint: 'Move a page to the trash', enabled: false, review: 'auto', locked: 'delete' },
        { name: 'notion-get-users', read: false, schemaHash: hash('c'), hint: 'List the people in the workspace', enabled: true, review: 'auto', changed: true },
        { name: 'notion-get-teams', read: false, readOnly: true, schemaHash: hash('d'), hint: 'List the teams in the workspace', enabled: true, review: 'auto', added: true },
      ],
      enabled: true,
      review: 'auto',
    },
    { id: cid('littlebird'), label: 'Littlebird', state: 'off', address: 'https://mcp.littlebird.ai/mcp', tools: [], enabled: false, review: 'auto' },
    {
      id: cid('t3'),
      label: 'T3 Code',
      state: 'needsSignIn',
      detail: 'The sign-in expired. Sessions keep running.',
      address: 'http://localhost:3773/mcp',
      t3: { url: 'http://localhost:3773/mcp', allowNetwork: false },
      tools: [
        { name: 't3_thread_read', read: true, schemaHash: hash('4'), hint: 'Reads a thread', enabled: true, review: 'auto' },
        { name: 't3_thread_fork', read: false, schemaHash: hash('5'), hint: 'Starts a new session from a thread', enabled: true, review: 'auto', changed: true },
      ],
      enabled: true,
      review: 'auto',
    },
    {
      id: cid('server-docs'),
      label: 'Team docs',
      state: 'degraded',
      detail: 'The connection is unavailable. Juno will reconnect.',
      address: 'https://docs.example.com/mcp',
      tools: [
        { name: 'search_docs', read: false, schemaHash: hash('6'), enabled: true, review: 'auto' },
        { name: 'publish_docs', read: false, schemaHash: hash('e'), hint: 'Publish the site', enabled: true, review: 'auto', added: true },
        { name: 'merge_branch', read: false, schemaHash: hash('f'), hint: 'Merge a branch into main', enabled: true, review: 'auto', locked: 'forbidden' },
      ],
      enabled: true,
      review: 'never',
      removable: true,
    },
  ],
}

const models = (selected: string, provider: 'openrouter' | 'codex' = 'openrouter') => [
  { family: 'Claude Sonnet', resolved: 'Claude Sonnet 5.5', provider, price: '$3 in, $15 out per million tokens', selected: selected === 'Claude Sonnet' },
  { family: 'Claude Opus', resolved: 'Claude Opus 5.5', provider, price: '$15 in, $75 out per million tokens', selected: selected === 'Claude Opus' },
  { family: 'Muse', resolved: 'Muse 2', provider, price: '$2 in, $8 out per million tokens', selected: selected === 'Muse' },
  { family: 'GPT Sol', provider, selected: false },
  { family: 'Grok', resolved: 'Grok 5', provider, price: '$3 in, $15 out per million tokens', selected: selected === 'Grok' },
]

export const settings: JunoSettingsPage = {
  chatModels: models('Claude Sonnet'),
  compactionModels: models('Muse'),
  fallbackModels: [...models(''), { family: 'Gemini Flash', resolved: 'Gemini 3.8 Flash', provider: 'openrouter', price: '$0.75 in, $3.75 out per million tokens', selected: true }],
  spentTodayUsd: 0.35,
  capUsd: 2,
  limitTodayUsd: 2,
  backgroundTodayUsd: 0.1,
  backgroundLimitUsd: 1,
  codex: { _tag: 'ready', version: '0.42.1' },
  openRouterKey: 'set',
  rules: [
    { id: 'u1', text: 'Always ask before sending anything to #general' },
    { id: 'u2', text: 'Never start a session on the release branch' },
  ],
  paused: false,
  backupFolder: '~/Library/Application Support/Juno/backup',
  lastBackupAt: NOW - 3 * HOUR,
  ownership: { _tag: 'active', epoch: 3 },
  recoveryPhraseExportedAt: NOW - 20 * DAY,
}

export const settingsTrouble: JunoSettingsPage = {
  ...settings,
  codex: { _tag: 'signedOut' },
  openRouterKey: 'rejected',
  paused: true,
  lastBackupAt: undefined,
  recoveryPhraseExportedAt: undefined,
  removalPending: { copies: 1, jobId: jid('j1') },
}

export const settingsRecovery: JunoSettingsPage = { ...settings, ownership: { _tag: 'recovery', pending: 2 } }
export const settingsReleased: JunoSettingsPage = { ...settings, ownership: { _tag: 'released', epoch: 3 } }
