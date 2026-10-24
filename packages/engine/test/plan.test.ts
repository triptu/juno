// Every live query statement reads through an index (performance 6): its plan may not scan messages,
// topic_index, reactions or topic_overlay, which grow with the workspace. Which index each one picks is
// the planner's business; only a full scan fails. The list names the statements of every live query:
// the sidebar and its counts, the dock badge, All topics, the topic view, who reacted, a channel's
// threads, the New chat pickers, the ignore list, the @ and # suggestions, Home and ⌘K's local search.
import { countsStatement } from '../src/sidebarUnread'
import { badgeStatement, badgePolicy } from '../src/dockBadge'
import { defaultNotificationSettings } from '@juno/domain'
import { expect } from 'bun:test'
import { itEffect } from '@juno/testing/effect'
import { Effect, Layer } from 'effect'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Store, StoreReader, workspacePathsFromDir, type StoreError } from '@juno/store'
import { messagesByTsStatement, reactionsStatement, rootStatement, threadsStatements, firstRepliesStatement, windowStatements, type WindowTarget } from '../src/messages/window'
import { missedHuddleStatement } from '../src/home/huddles'
import { broadcastTitlesStatement } from '../src/messages/broadcastTitles'
import { messageUsersStatement } from '../src/messages/query'
import { whoReactedStatements } from '../src/messages/reactors'
import { homeStatements } from '../src/home/query'
import { suggestedStatements } from '../src/home/suggested'
import { staleStatement } from '../src/home/job'
import { automatedStatements } from '../src/automatedView'
import { movesStatements } from '../src/home/moves'
import { activityStatement, frequentConversationsStatement, frequentSendsStatement, pickerStatements } from '../src/newchat/query'
import { mentionStatements } from '../src/mentions/query'
import { ignorableStatement } from '../src/topics/ignored'
import { searchStatements } from '../src/search/query'
import { countsStatement as allTopicsCountsStatement, orderStatement, placesStatement } from '../src/topics/allTopics'
import { listStatements, type ListFilter } from '../src/topics/query'

interface Statement {
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
}

const tempDir = Effect.acquireRelease(
  Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), 'juno-plan-'))),
  (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
)
const freshStore: Layer.Layer<Layer.Success<ReturnType<typeof Store.layer>>, StoreError> = Layer.unwrap(
  Effect.map(tempDir, (dir) => Store.layer(workspacePathsFromDir(dir))),
)

/** Table aliases the statements use, back to the tables the rule names. */
const ALIASES: Record<string, string> = { i: 'topic_index', t: 'topic_index', ti: 'topic_index', o: 'topic_overlay', ov: 'topic_overlay', m: 'messages', r: 'messages', root: 'messages' }
const GUARDED = new Set(['messages', 'topic_index', 'reactions', 'topic_overlay'])

const plan = (sql: string, params: ReadonlyArray<unknown>) =>
  Effect.gen(function* () {
    const reader = yield* StoreReader
    const rows = yield* reader.unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)
    return rows.map((r) => r.detail)
  })

const scans = (lines: ReadonlyArray<string>) =>
  lines.filter((line) => {
    const match = /^SCAN (\S+)/.exec(line)
    if (match === null) return false
    const table = ALIASES[match[1]!] ?? match[1]!
    return GUARDED.has(table)
  })

const filters: ReadonlyArray<ListFilter> = [
  { kind: 'all', unreadOnly: false },
  { kind: 'channels', unreadOnly: false },
  { kind: 'dms', unreadOnly: true },
  { kind: 'all', unreadOnly: false, scope: 'C0ENG' },
  { kind: 'all', unreadOnly: true, scope: 'C0ENG' },
  { kind: 'all', unreadOnly: false, view: 'vbots' },
  { kind: 'all', unreadOnly: true, view: 'vbots' },
]

const cutoff = '1700000000.000000'
const thread = { kind: 'thread', channel: 'C0ENG', threadTs: '1700000000.000100' } as const
const narrowings = [{ kind: 'all' }, { kind: 'channels' }, { kind: 'dms', scope: 'D0MAYA' }, { kind: 'all', query: 'postgres plan' }] as const

/** Every live query statement, by name, with the parameters it is run with. */
function statements(): ReadonlyArray<readonly [string, Statement]> {
  const named = (name: string, list: ReadonlyArray<Statement>) => list.map((statement, i) => [`${name} #${i}`, statement] as const)
  const windows = ([{ kind: 'main', channel: 'C0ENG' }, thread] satisfies ReadonlyArray<WindowTarget>).flatMap((target) =>
    [undefined, '1700000000.000200'].flatMap((anchor) => named(`messages.list ${target.kind} window, anchor ${anchor}`, windowStatements(target, { anchor, before: 50, limit: 300 }))))
  const recent = threadsStatements('C0ENG', cutoff, 100)
  const all = threadsStatements('C0ENG', undefined, 100)
  const who = whoReactedStatements('C0ENG', '1700000000.000100')
  return [
    ...filters.flatMap((filter) => named(`topics.list ${JSON.stringify(filter)}`, listStatements(filter, cutoff, 300))),
    ...[undefined, 'C0ENG'].map((scope) => [`topics.counts ${scope}`, countsStatement(scope)] as const),
    ['dock badge', badgeStatement(badgePolicy(defaultNotificationSettings, { aiAssist: false, at: { weekday: 1, minutes: 600 } }), 'U0SELF')],
    ...narrowings.flatMap((narrowing) => [
      ...(['all', 'quiet'] as const).flatMap((status) => (['recent', 'oldest', 'messages'] as const).map((sort) =>
        [`allTopics.list ${JSON.stringify(narrowing)} ${status} ${sort}`, orderStatement({ ...narrowing, status, sort }, cutoff, 200, 200)] as const)),
      [`allTopics.summary ${JSON.stringify(narrowing)}`, allTopicsCountsStatement(narrowing, cutoff)] as const,
      [`allTopics places ${narrowing.kind}`, placesStatement(narrowing.kind)] as const,
    ]),
    ...windows,
    ['broadcast titles', broadcastTitlesStatement(['t:C0ENG:1700000000.000100'])],
    ['thread root', rootStatement(thread)],
    ['reactions', reactionsStatement('C0ENG', ['1700000000.000100', '1700000000.000200'])],
    ['first replies', firstRepliesStatement('C0ENG', ['1700000000.000100'])],
    ['messages by ts', messagesByTsStatement('C0ENG', ['1700000000.000100', '1700000000.000200'])],
    ['reactions.who message', who.message],
    ['reactions.who reactions', who.reactions],
    ...[recent.list, recent.count, all.list, all.count].map((statement, i) => [`channel.threads #${i}`, statement] as const),
    ['New chat frequent conversations', { sql: frequentConversationsStatement, params: [] }],
    ['New chat frequent sends', frequentSendsStatement('U0SELF', 1_800_000_000_000)],
    ['New chat activity', activityStatement(['C0ENG', 'D0MAYA'])],
    ['New chat recent', pickerStatements(cutoff).recent],
    ['ignore list', { sql: ignorableStatement, params: [] }],
    ['@ thread posters', mentionStatements.threadPosters('C0ENG', '1700000000.000100')],
    ['@ channel posters', mentionStatements.channelPosters('C0ENG')],
    ['@ recent contacts', mentionStatements.recentContacts(cutoff)],
    ['# your channels', mentionStatements.yourChannels(cutoff)],
    ...named('Home', [
      homeStatements.unread(cutoff),
      homeStatements.topics(['t:C0ENG:1700000000.000100', 'm:D0MAYA']),
      homeStatements.threadAfter('C0ENG', '1700000000.000100', cutoff),
      homeStatements.mainAfter('D0MAYA', cutoff),
      staleStatement('settledScore', cutoff, '1800000000.000000', 12),
      homeStatements.automated(),
      homeStatements.askedWhy('C0ALERTS'),
      suggestedStatements.ignoredMentions(cutoff),
      suggestedStatements.unreadChannels(cutoff),
      suggestedStatements.mentionChannels(cutoff),
      suggestedStatements.firstThreadUnread('C0ENG', '1700000000.000100', '1700000000.000100', 'U0ME'),
      homeStatements.kept(['t:C0ENG:1700000000.000100', 'm:D0MAYA']),
      automatedStatements.candidates(),
      automatedStatements.sample('C0ALERTS'),
      automatedStatements.moved(),
      movesStatements.unseen(),
      homeStatements.mains(['C0ALERTS', 'C0DEPLOYS']),
      missedHuddleStatement(Date.now()),
    ]),
  ]
}

itEffect('no live query statement scans a table that grows with the workspace', () =>
  Effect.gen(function* () {
    const reader = yield* StoreReader
    const search = Object.entries(searchStatements(reader, '"roll"*', 50)).map(([name, statement]) => {
      const [sql, params] = statement.compile()
      return [`⌘K search ${name}`, { sql, params }] as const
    })
    const scanning: Array<string> = []
    for (const [name, statement] of [...statements(), ...search]) {
      const lines = yield* plan(statement.sql, statement.params)
      if (scans(lines).length > 0) scanning.push(`${name}\n  ${lines.join('\n  ')}`)
    }
    // An app's or a deactivated person's DM is found through the DM index, not by reading every conversation.
    const dms = messageUsersStatement(['U0GRAFANA', 'U0MAYA'])
    const dmLines = yield* plan(dms.sql, dms.params)
    if (dmLines.some((line) => /^SCAN (d|conversations)\b/.test(line))) scanning.push(`DM by user\n  ${dmLines.join('\n  ')}`)
    expect(scanning).toEqual([])
  }).pipe(Effect.provide(freshStore)),
)
