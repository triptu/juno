import type { SearchHit, SearchSnapshot, SearchTitleHit } from '@juno/contract'
import { compareTs, type SearchQuery } from '@juno/domain'
import { searchMessagePage, type SearchPageMatch } from '@juno/slack'
import { StoreReader } from '@juno/store'
import { Effect } from 'effect'
import { automatedChannelsSql, compileSearchSlack, includedChannels, searchNeedsSlack, type ResolvedSearch } from '../searchCompiler'
import { resolveSearch } from '../searchResolve'
import type { SessionClient } from '../sessionClient'
import type { SyncLink } from '../syncLink'
import { literalRanges, mergeSearch, windowSearchGroups, type Coverage, type SearchPage } from './merge'
import { messageHits, titleResults } from './query'
import { localHits, remoteHits, threadOf } from './sessionRows'

export interface SearchRun {
  input: { sessionId: string; generation: number; query: SearchQuery; immediate?: boolean }
  resolved: ResolvedSearch
  client: SessionClient['Service']
  link: SyncLink['Service']
  current: () => boolean
  publish: () => void
  local: ReadonlyArray<SearchHit>
  titles: ReadonlyArray<SearchTitleHit>
  localLimit: number
  localCoverage: Coverage
  pages: SearchPage[]
  facets: SearchSnapshot['facets']
  pagination: SearchSnapshot['pagination']
  state: SearchSnapshot['state']
  slackTotal: number | null
  hidden: Set<string>
  automatedHidden: Set<string>
  hiddenApps: number
  offset: number
  online: boolean
  automated: Set<string>
  explicit: Set<string>
  visibleChannels: Set<string>
}

export const prepareSearch = (input: SearchRun['input'], client: SearchRun['client'], link: SearchRun['link'], current: () => boolean) => Effect.gen(function* () {
  const resolved = yield* resolveSearch(input.query)
  const sql = yield* StoreReader
  const online = yield* link.online
  const explicit = new Set(includedChannels(resolved))
  if (resolved.query.scope.topic !== undefined) explicit.add(resolved.query.scope.topic.channel)
  const run: SearchRun = {
    input, resolved, client, link, current, publish: () => {}, online, explicit,
    local: [], localLimit: 200, localCoverage: { through: null, complete: false }, pages: [],
    titles: [],
    facets: { from: [], in: [] }, pagination: { page: 0, pageCount: 0, perPage: 50, first: 0, last: 0, hasMore: false },
    state: online ? 'searching' : 'offline', slackTotal: null, hidden: new Set(), automatedHidden: new Set(), hiddenApps: 0, offset: 0,
    automated: new Set((yield* sql.unsafe<{ channel: string }>(automatedChannelsSql)).map((r) => r.channel)),
    visibleChannels: new Set((yield* sql<{ id: string }>`SELECT c.id FROM conversations c WHERE c.is_member = 1 AND NOT EXISTS (SELECT 1 FROM ignored_channels g WHERE g.channel = c.id)`).map((r) => r.id)),
  }
  yield* loadLocal(run)
  return run
})
export const loadLocal = (run: SearchRun) => Effect.gen(function* () {
  const rows = yield* messageHits(run.resolved, run.localLimit + 1)
  run.local = yield* localHits(rows.slice(0, run.localLimit), run.resolved.query)
  const titles = yield* titleResults(run.resolved, run.localLimit + 1)
  run.titles = titles.slice(0, run.localLimit).map((title) => ({ ...title, ranges: literalRanges(title.title, run.resolved.query) }))
  const bounds = [...(rows.length > run.localLimit ? [run.local.at(-1)?.ts] : []), ...(titles.length > run.localLimit ? [((run.titles.at(-1)?.at ?? 0) / 1000).toFixed(6)] : [])].filter((ts): ts is string => ts !== undefined)
  run.localCoverage = { through: bounds.toSorted((a, b) => (run.resolved.query.scope.sort === 'newest' ? -1 : 1) * compareTs(a, b))[0] ?? null, complete: bounds.length === 0 }
})
export const localHidden = (run: SearchRun) => Effect.gen(function* () {
  const { resolved } = run
  if (run.local.length > 0 || searchNeedsSlack(resolved.query) || (!resolved.query.scope.hideApps && !resolved.query.scope.hideAutomated)) return
  const rows = yield* messageHits({ ...resolved, query: { ...resolved.query, scope: { ...resolved.query.scope, hideApps: false, hideAutomated: false } } }, 201)
  for (const row of rows) run.hidden.add(`${row.channel}:${row.ts}`)
})

export function snapshot(run: SearchRun): SearchSnapshot {
  const merged = mergeSearch({ local: run.local, titles: run.titles, localCoverage: run.localCoverage, pages: run.pages, sort: run.resolved.query.scope.sort, group: run.resolved.query.scope.groupByThread === true })
  const window = windowSearchGroups(merged.groups, run.offset, 100)
  const olderIndex = window.groups.findIndex((g) => g.older)
  const hidden = Math.max(run.hidden.size, run.automatedHidden.size + run.hiddenApps)
  return {
    sessionId: run.input.sessionId, generation: run.input.generation, query: run.resolved.query, needsSlack: searchNeedsSlack(run.resolved.query),
    state: run.state === 'done' && merged.groups.length === 0 && hidden > 0 && !run.pagination.hasMore ? 'onlyHidden' : run.state,
    groups: window.groups, frontier: { ...merged.frontier, olderGroupIndex: olderIndex < 0 ? window.groups.length : olderIndex }, facets: run.facets,
    counts: { local: run.local.length, slackLoaded: new Set(run.pages.flatMap((p) => p.rows.map((r) => r.id))).size, hidden, slackTotal: run.slackTotal },
    pagination: run.pagination, window: { offset: run.offset, totalGroups: merged.groups.length, totalRows: window.totalRows },
  }
}

function visibleMatches(run: SearchRun, matches: ReadonlyArray<SearchPageMatch>) {
  return matches.filter((match) => {
    const channel = match.channel
    if (!run.visibleChannels.has(channel)) return false
    const scope = run.resolved.query.scope.topic
    if (scope !== undefined && (channel !== scope.channel || (scope.threadTs !== undefined && match.ts !== scope.threadTs && threadOf(match) !== scope.threadTs))) return false
    if (run.resolved.query.scope.hideAutomated && run.automated.has(channel) && !run.explicit.has(channel)) {
      run.hidden.add(`${channel}:${match.ts}`); run.automatedHidden.add(`${channel}:${match.ts}`)
      return false
    }
    return true
  })
}

export const fetchSearch = (run: SearchRun) => Effect.gen(function* () {
  if (!run.online) { run.state = 'offline'; return }
  const firstArgs = compileSearchSlack(run.resolved, run.pagination.page + 1)
  if (firstArgs === undefined || (firstArgs.query === '' && run.resolved.query.raw.trim() !== '')) { run.state = 'done'; return }
  const apiResult = yield* Effect.result(run.client.api)
  if (apiResult._tag === 'Failure') { run.state = 'slackUnavailable'; return }
  const api = apiResult.success
  let shown = 0
  run.state = 'searching'
  run.publish()
  do {
    const args = compileSearchSlack(run.resolved, run.pagination.page + 1)
    if (args === undefined) break
    const answer = yield* Effect.result(searchMessagePage(api, args))
    if (!run.current()) return
    if (answer._tag === 'Failure') { run.state = (yield* run.link.online) ? 'slackUnavailable' : 'offline'; return }
    const raw = answer.success.matches
    const p = answer.success.pagination
    const page = p?.page ?? args.page ?? 1
    run.slackTotal = answer.success.total ?? 0
    run.pagination = { page, pageCount: p?.page_count ?? page, perPage: p?.per_page ?? 50, first: p?.first ?? 0, last: p?.last ?? 0, hasMore: page < (p?.page_count ?? page) && raw.length > 0 }
    run.facets = { from: (answer.success.facets?.from ?? []).map((r) => ({ id: r.id, count: r.facet_count })), in: (answer.success.facets?.in ?? []).map((r) => ({ id: r.id, count: r.facet_count })) }
    const rows = yield* remoteHits(visibleMatches(run, raw), run.resolved.query)
    shown += rows.length
    run.pages.push({ rows, coverage: { through: raw.at(-1)?.ts ?? run.pages.at(-1)?.coverage.through ?? null, complete: !run.pagination.hasMore } })
    run.publish()
  } while (run.pagination.hasMore && shown < 50 && run.current())
  if (!run.current()) return
  if (run.local.length === 0 && run.pages.every((p) => p.rows.length === 0) && run.resolved.query.scope.hideApps) {
    const unhidden = compileSearchSlack({ ...run.resolved, query: { ...run.resolved.query, scope: { ...run.resolved.query.scope, hideApps: false } } })
    if (unhidden !== undefined) run.hiddenApps = yield* searchMessagePage(api, unhidden).pipe(Effect.map((answer) => Math.max(0, (answer.total ?? 0) - (run.slackTotal ?? 0))), Effect.catch(() => Effect.succeed(0)))
  }
  run.state = 'done'
})
