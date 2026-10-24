import { SEARCH_WINDOW, type SearchCard, type SearchGroup, type SearchHit, type SearchSnapshot, type SearchTitleHit } from '@juno/contract'
import { compareTs, type SearchQuery } from '@juno/domain'
import { searchMessagePage, type SearchPageMatch } from '@juno/slack'
import { StoreReader } from '@juno/store'
import { Effect } from 'effect'
import { automatedChannelsSql, compileSearchSlack, includedChannels, searchNeedsSlack, type ResolvedSearch } from './searchCompiler'
import { resolveSearch } from './searchResolve'
import type { SessionClient } from './sessionClient'
import type { SyncLink } from './syncLink'
import { literalRanges, mergeSearch, windowSearchGroups, type Coverage, type SearchPage } from './searchMerge'
import { messageHits, titleResults } from './searchQuery'
import { localHits, namedFacets, remoteHits, threadOf, withArt } from './searchRows'
import { cardKey, searchCards, type CardRow } from './searchCards'

export interface SearchRun {
  input: { sessionId: string; generation: number; query: SearchQuery; immediate?: boolean }
  resolved: ResolvedSearch
  client: SessionClient['Service']
  link: SyncLink['Service']
  current: () => boolean
  /** Sends the run's window, with the cards of its results built first (`fillCards`). */
  publish: () => Effect.Effect<void>
  local: ReadonlyArray<SearchHit>
  titles: ReadonlyArray<SearchTitleHit>
  localDone: boolean
  titlesDone: boolean
  establishedTitles: Set<string>
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
  desiredOffset: number
  online: boolean
  automated: Set<string>
  explicit: Set<string>
  visibleChannels: Set<string>
  /** Each result's stored row or Slack's, by result id, for its card; and the cards built so far, only for results a window has shown. */
  cardRows: Map<string, CardRow>
  cards: Map<string, SearchCard>
}

export const prepareSearch = (input: SearchRun['input'], client: SearchRun['client'], link: SearchRun['link'], current: () => boolean) => Effect.gen(function* () {
  const local = yield* initialSearch(input.query)
  const resolved = local.resolved
  const sql = yield* StoreReader
  const online = yield* link.online
  const explicit = new Set(includedChannels(resolved))
  if (resolved.query.scope.topic !== undefined) explicit.add(resolved.query.scope.topic.channel)
  const run: SearchRun = {
    input, client, link, current, publish: () => Effect.void, online, explicit, cards: new Map(),
    ...local, establishedTitles: new Set(), pages: [],
    facets: { from: [], in: [] }, pagination: { page: 0, pageCount: 0, perPage: 50, first: 0, last: 0, hasMore: false },
    state: online ? 'searching' : 'offline', slackTotal: null, hidden: new Set(), automatedHidden: new Set(), hiddenApps: 0, offset: 0, desiredOffset: 0,
    automated: new Set((yield* sql.unsafe<{ channel: string }>(automatedChannelsSql)).map((r) => r.channel)),
    visibleChannels: new Set((yield* sql<{ id: string }>`SELECT c.id FROM conversations c WHERE c.is_member = 1 AND NOT EXISTS (SELECT 1 FROM ignored_channels g WHERE g.channel = c.id)`).map((r) => r.id)),
  }
  return run
})
type LocalSearch = Pick<SearchRun, 'resolved' | 'local' | 'titles' | 'localDone' | 'titlesDone' | 'localCoverage' | 'cardRows'>

const initialSearch = (query: SearchQuery) => Effect.gen(function* () {
  const resolved = yield* resolveSearch(query)
  const local: LocalSearch = { resolved, local: [], titles: [], localDone: false, titlesDone: false, localCoverage: { through: null, complete: false }, cardRows: new Map() }
  yield* loadLocal(local)
  return local
})

export const loadLocal = (run: LocalSearch) => Effect.gen(function* () {
  if (!run.localDone) {
    const rows = yield* messageHits(run.resolved, 201, { offset: run.local.length })
    for (const row of rows.slice(0, 200)) run.cardRows.set(cardKey(row), row)
    run.local = [...run.local, ...yield* localHits(rows.slice(0, 200), run.resolved.query)]
    run.localDone = rows.length <= 200
  }
  if (!run.titlesDone) {
    const titles = yield* titleResults(run.resolved, 201, run.titles.length)
    run.titles = [...run.titles, ...yield* withArt(titles.slice(0, 200).map((title) => ({ ...title, ranges: literalRanges(title.title, run.resolved.query) })), (title) => title.id)]
    run.titlesDone = titles.length <= 200
  }
  const bounds = [...(!run.localDone ? [run.local.at(-1)?.ts] : []), ...(!run.titlesDone ? [((run.titles.at(-1)?.at ?? 0) / 1000).toFixed(6)] : [])].filter((ts): ts is string => ts !== undefined)
  run.localCoverage = { through: bounds.toSorted((a, b) => (run.resolved.query.scope.sort === 'newest' ? -1 : 1) * compareTs(a, b))[0] ?? null, complete: run.localDone && run.titlesDone }
})
export const localHidden = (run: SearchRun) => Effect.gen(function* () {
  const { resolved } = run
  if (run.local.length > 0 || searchNeedsSlack(resolved.query) || (!resolved.query.scope.hideApps && !resolved.query.scope.hideAutomated)) return
  const rows = yield* messageHits({ ...resolved, query: { ...resolved.query, scope: { ...resolved.query.scope, hideApps: false, hideAutomated: false } } }, 201)
  for (const row of rows) run.hidden.add(`${row.channel}:${row.ts}`)
})

const merged = (run: SearchRun) => mergeSearch({ local: run.local, titles: run.titles, establishedTitles: run.establishedTitles, localCoverage: run.localCoverage, pages: run.pages, sort: run.resolved.query.scope.sort })

/** Builds the cards of the window's results that have none yet. A window's worth at most, so typing never pays for results it does not show. */
export const fillCards = (run: SearchRun) => Effect.gen(function* () {
  const shown = windowSearchGroups(merged(run).groups, run.offset, SEARCH_WINDOW).groups.flatMap((group) => group.messages)
  const missing = shown.flatMap((hit) => { const row = run.cards.has(hit.id) ? undefined : run.cardRows.get(hit.id); return row === undefined ? [] : [row] })
  if (missing.length === 0) return
  for (const [id, card] of yield* searchCards(missing)) run.cards.set(id, card)
})

export function snapshot(run: SearchRun): SearchSnapshot {
  const all = merged(run)
  for (const group of all.groups) if (group.kind === 'topic' && !group.older) run.establishedTitles.add(group.topicId)
  const window = withCards(run, windowSearchGroups(all.groups, run.offset, SEARCH_WINDOW))
  const olderIndex = window.groups.findIndex((g) => g.older)
  const hidden = Math.max(run.hidden.size, run.automatedHidden.size + run.hiddenApps)
  return {
    sessionId: run.input.sessionId, generation: run.input.generation, query: run.resolved.query, needsSlack: searchNeedsSlack(run.resolved.query),
    state: run.state === 'done' && all.groups.length === 0 && hidden > 0 && !run.pagination.hasMore ? 'onlyHidden' : run.state,
    groups: window.groups, frontier: { ...all.frontier, olderGroupIndex: olderIndex < 0 ? window.groups.length : olderIndex }, facets: run.facets,
    counts: { local: run.local.length, slackLoaded: new Set(run.pages.flatMap((p) => p.rows.map((r) => r.id))).size, hidden, slackTotal: run.slackTotal },
    pagination: run.pagination, window: { offset: run.offset, totalGroups: all.groups.length, totalRows: window.totalRows, hasMoreLocal: !run.localCoverage.complete },
  }
}

/** The window with each result's card, when built. */
function withCards<W extends { readonly groups: ReadonlyArray<SearchGroup> }>(run: SearchRun, window: W): W {
  if (run.cards.size === 0) return window
  return { ...window, groups: window.groups.map((group) => (group.messages.length === 0 ? group : { ...group, messages: group.messages.map((hit) => { const card = run.cards.get(hit.id); return card === undefined ? hit : { ...hit, card } }) })) }
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

export const fetchSearch = (run: SearchRun, singlePage = false) => Effect.gen(function* () {
  if (!run.online) { run.state = 'offline'; return }
  const firstArgs = compileSearchSlack(run.resolved, run.pagination.page + 1)
  if (firstArgs === undefined || (firstArgs.query === '' && run.resolved.query.raw.trim() !== '')) { run.state = 'done'; return }
  const apiResult = yield* Effect.result(run.client.api)
  if (apiResult._tag === 'Failure') { run.state = 'slackUnavailable'; return }
  const api = apiResult.success
  let shown = 0
  run.state = 'searching'
  yield* run.publish()
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
    run.facets = yield* namedFacets({ from: (answer.success.facets?.from ?? []).map((r) => ({ id: r.id, count: r.facet_count })), in: (answer.success.facets?.in ?? []).map((r) => ({ id: r.id, count: r.facet_count })) })
    const { hits: rows, cards } = yield* remoteHits(visibleMatches(run, raw), run.resolved.query)
    for (const row of cards) if (!run.cardRows.has(cardKey(row))) run.cardRows.set(cardKey(row), row)
    shown += rows.length
    run.pages.push({ rows, coverage: { through: raw.at(-1)?.ts ?? run.pages.at(-1)?.coverage.through ?? null, complete: !run.pagination.hasMore } })
    yield* run.publish()
    if (singlePage) break
  } while (run.pagination.hasMore && shown < 50 && run.current())
  if (!run.current()) return
  if (!singlePage && run.local.length === 0 && run.pages.every((p) => p.rows.length === 0) && run.resolved.query.scope.hideApps) {
    const unhidden = compileSearchSlack({ ...run.resolved, query: { ...run.resolved.query, scope: { ...run.resolved.query.scope, hideApps: false } } })
    if (unhidden !== undefined) run.hiddenApps = yield* searchMessagePage(api, unhidden).pipe(Effect.map((answer) => Math.max(0, (answer.total ?? 0) - (run.slackTotal ?? 0))), Effect.catch(() => Effect.succeed(0)))
  }
  run.state = 'done'
})
