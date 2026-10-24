/**
 * The agent's `host.slack.search`: the Search tab's parser, resolution, local
 * index, Slack search and merge, with one Slack page at most per call. A page
 * holds only matches both sources have covered, so a later page never adds a
 * row above one already returned. When Slack fails it holds the local matches
 * and says so. The cursor is short-lived and bound to the account and query.
 */
import { randomUUID } from 'node:crypto'
import { Clock, Effect } from 'effect'
import { HostChannelId, HostCursor, HostMessageTs, HostUserId, type HostSearchOptions, type HostSearchPage } from '@juno/agent-contract'
import { contextTint, parseSearchQuery, tsToMillis, type Ts } from '@juno/domain'
import type { SearchGroup } from '@juno/contract'
import { searchHasErrors } from '../searchCompiler'
import { mergeSearch } from '../searchMerge'
import { fetchSearch, loadLocal, prepareSearch, type SearchRun } from '../searchRun'
import type { SessionClient } from '../sessionClient'
import type { SyncLink } from '../syncLink'

type Page = typeof HostSearchPage.Type
type Match = Page['matches'][number]
interface Continuation {
  readonly key: string
  readonly expires: number
  readonly run: SearchRun
  readonly emitted: ReadonlySet<string>
}

const PAGE_MAX = 50
const CURSOR_MS = 10 * 60_000
const CURSORS_MAX = 20

const unavailableNote = 'Slack search is unavailable. These are matches on this Mac only; older history may be missing.'
const expiredNote = 'That cursor has expired or belongs to another search. Search again without it.'
const resultKey = (group: SearchGroup) => group.messages[0]?.id ?? group.topicId
const rootOf = (topicId: string) => (topicId.startsWith('t:') ? topicId.split(':')[2] : undefined)

/** A copy that a later call can move on without changing what a replay of this cursor sees. */
const fork = (run: SearchRun): SearchRun => ({
  ...run, pages: [...run.pages], hidden: new Set(run.hidden), automatedHidden: new Set(run.automatedHidden), establishedTitles: new Set(run.establishedTitles),
})

function matchesOf(groups: ReadonlyArray<SearchGroup>, timeZone: string): Match[] {
  const clock = new Intl.DateTimeFormat('en-CA', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const time = (ts: string) => clock.format(tsToMillis(ts as Ts))
  return groups.flatMap((group) => {
    const topic = { topicId: group.topicId, title: group.title, where: group.place.label, tint: contextTint(group.place.kind) }
    const channelId = HostChannelId.make(group.place.id)
    if (group.messages.length === 0) {
      const root = rootOf(group.topicId)
      return [{ topic, channelId, time: time(group.at), ...(root === undefined ? {} : { rootTs: HostMessageTs.make(root) }) }]
    }
    return group.messages.map((hit) => {
      const threadTs = rootOf(hit.topicId)
      return { topic, channelId, time: time(hit.ts), message: {
        channelId, ts: HostMessageTs.make(hit.ts), ...(threadTs === undefined || threadTs === hit.ts ? {} : { threadTs: HostMessageTs.make(threadTs) }),
        senderId: HostUserId.make(hit.senderId ?? ''), senderName: hit.sender, channelName: hit.place.label, text: hit.text,
      } }
    })
  })
}

export function makeAgentSearch(client: SessionClient['Service'], link: SyncLink['Service']) {
  const cursors = new Map<string, Continuation>()
  return (account: string, query: string, cursor: string | undefined, requestedLimit: number, options: typeof HostSearchOptions.Type = {}) => Effect.gen(function* () {
    if (query.trim() === '') return { matches: [], notes: ['Give the search some words or filters.'] } satisfies Page
    const now = yield* Clock.currentTimeMillis
    for (const [id, value] of cursors) if (value.expires <= now) cursors.delete(id)
    const limit = Math.max(1, Math.min(PAGE_MAX, requestedLimit))
    const parsed = parseSearchQuery(query, { scope: { hideApps: options.includeApps !== true, hideAutomated: options.includeAutomated !== true, sort: options.sort ?? 'newest' } })
    const key = JSON.stringify([account, parsed])
    const prior = cursor === undefined ? undefined : cursors.get(cursor)
    if (cursor !== undefined && prior?.key !== key) return { matches: [], notes: [expiredNote] } satisfies Page
    const run = prior === undefined ? yield* prepareSearch({ sessionId: randomUUID(), generation: 1, query: parsed }, client, link, () => true) : fork(prior.run)
    const { query: resolved } = run.resolved
    const notes = resolved.diagnostics.map((d) => (d.code === 'incomplete' ? `${resolved.raw.slice(d.span.start, d.span.end)}: ${d.message}` : d.message))
    if (searchHasErrors(resolved)) return { matches: [], notes } satisfies Page

    run.online = yield* link.online
    if (prior !== undefined && !run.localCoverage.complete) yield* loadLocal(run)
    // Unlike the tab, a call neither fills thin pages nor counts hidden apps: one Slack request at most.
    if (run.pagination.page === 0 || run.pagination.hasMore || run.state === 'slackUnavailable' || run.state === 'offline') yield* fetchSearch(run, true)
    const unavailable = run.state === 'offline' || run.state === 'slackUnavailable'
    if (unavailable) notes.push(unavailableNote)
    // A query Slack cannot take (only local filters) leaves no page: the local index alone covers it.
    const pages = run.pages.length === 0 && run.state === 'done' ? [{ rows: [], coverage: { through: null, complete: true } }] : run.pages
    const merged = mergeSearch({ local: run.local, titles: run.titles, localCoverage: run.localCoverage, pages, sort: resolved.scope.sort })
    const emitted = new Set(prior?.emitted)
    const remaining = merged.groups.filter((g) => !emitted.has(resultKey(g)))
    const shown = remaining.filter((g) => unavailable || !g.older).slice(0, limit)
    for (const group of shown) emitted.add(resultKey(group))

    const more = remaining.length > shown.length || !run.localCoverage.complete || run.pagination.hasMore
    if (!more) return { matches: matchesOf(shown, run.resolved.timeZone), notes } satisfies Page
    const next = HostCursor.make(randomUUID())
    cursors.set(next, { key, expires: now + CURSOR_MS, run, emitted })
    for (const id of [...cursors.keys()].slice(0, Math.max(0, cursors.size - CURSORS_MAX))) cursors.delete(id)
    return { matches: matchesOf(shown, run.resolved.timeZone), notes, next } satisfies Page
  })
}
