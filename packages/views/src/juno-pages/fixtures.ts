/** Invented page data for the gallery. Times are relative to `NOW`. */
import type { ActivityPage, ConnectionsPage, JunoSettingsPage, MemoryPage, RemembersPage, ScheduledPage } from '@juno/agent-contract'
import { NOW } from '../juno-chat/fixtures/data'

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

export const activity: ActivityPage = {
  runs: [
    {
      id: rid('r1'),
      who: 'You',
      at: NOW - 5 * MINUTE,
      outcome: 'replied',
      actions: [
        { id: 'a1', tier: 3, label: 'Send a message to #eng', decision: 'approved', outcome: 'done' },
        { id: 'a2', tier: 2, label: 'Start T3 Code on juno', decision: 'noClick', outcome: 'done' },
        {
          id: 'a7', tier: 3, label: 'Change notion-update-page in Notion', decision: 'noClick', outcome: 'done',
          review: { rule: 'auto', intent: 'explicit', risk: 'reversible', line: 'Ran without asking because you asked for it and it can be undone.' },
        },
      ],
      reads: 'Read 3 topics, looked back 4 times',
      tainted: false,
    },
    {
      id: rid('r2'),
      who: 'Daily catch-up',
      at: NOW - 30 * MINUTE,
      outcome: 'stayedQuiet',
      actions: [],
      reads: 'Read 12 topics',
      tainted: true,
    },
    {
      id: rid('r5'),
      who: 'You',
      at: NOW - 40 * MINUTE,
      outcome: 'replied',
      actions: [],
      reads: 'Ran 1 script: 3 reads, 1 cancelled',
      scriptCalls: [
        { tool: 'slack_search', args: '{"query":"deploy in:#eng"}', outcome: 'done' },
        { tool: 'slack_replies', args: '{"channel":"C0ENG","thread":"1760500000.000001"}', outcome: 'done' },
        { tool: 'connection_read', args: '{"server":"notion","tool":"notion-search","args":{"query":"rollout"}}', outcome: 'cancelled' },
      ],
      tainted: true,
    },
    {
      id: rid('r3'),
      who: 'You',
      at: NOW - 2 * HOUR,
      outcome: 'failed',
      actions: [
        { id: 'a3', tier: 3, label: 'Send a message to Maya Chen', decision: 'approved', outcome: 'failed', failure: { text: 'Slack did not accept the message.', details: 'chat.postMessage: ratelimited (retry-after 30) at 2026-10-14T07:31:02Z, attempt 2 of 2' } },
        { id: 'a4', tier: 3, label: 'Resolve 2 topics', decision: 'dismissed', outcome: 'none' },
        {
          id: 'a8', tier: 3, label: 'Change notion-delete-page in Notion', decision: 'dismissed', outcome: 'none',
          review: { rule: 'auto', intent: 'explicit', risk: 'delete', line: "Asked because deleting can't be undone." },
        },
        { id: 'a5', tier: 1, label: 'Remember "the offsite is on the 23rd"', decision: 'noClick', outcome: 'done' },
      ],
      reads: 'Read 1 topic',
      tainted: false,
    },
    {
      id: rid('r4'),
      who: 'Fix the sidebar flake',
      at: NOW - DAY,
      outcome: 'interrupted',
      actions: [{ id: 'a6', tier: 3, label: 'Answer a question from T3 Code', decision: 'expired', outcome: 'none' }],
      tainted: true,
    },
  ],
  moreAbove: true,
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
