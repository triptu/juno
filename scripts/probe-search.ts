/** Read-only Search tab research. Raw responses and query values stay in memory. */
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { apiBaseFromWorkspace, slackRoute } from '@juno/slack'
import type { CachedSession } from './live-common.ts'

type Json = Record<string, unknown>
type Args = Record<string, string | number | boolean>
const methods = ['auth.test', 'client.userBoot', 'users.prefs.get', 'users.info', 'conversations.history', 'conversations.replies', 'pins.list', 'stars.list', 'search.modules.messages', 'search.modules.files', 'search.modules.people', 'search.modules.channels'] as const
type Method = typeof methods[number]
type Call = (method: Method, args: Args, label: string) => Promise<Json>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const object = (value: unknown): Json => isObject(value) ? value : {}
const objects = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : []
const str = (value: unknown): string => typeof value === 'string' ? value : ''
const num = (value: unknown): number => typeof value === 'number' ? value : 0
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const safeKey = (key: string) => /^[a-z][a-z0-9_]*$/.test(key) ? key : 'redacted'
const keys = (values: Json[]) => [...new Set(values.flatMap((value) => Object.keys(value).map(safeKey)))].toSorted()
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const DAY = 86_400_000
const bot = (m: Json) => typeof m['bot_id'] === 'string' || m['subtype'] === 'bot_message'
const thread = (m: Json) => typeof m['thread_ts'] === 'string' || num(m['reply_count']) > 0 || str(m['permalink']).includes('thread_ts=')
const link = (m: Json) => /https?:\/\//.test(str(m['text']))
const reaction = (m: Json) => objects(m['reactions']).length > 0
const pinned = (m: Json) => Array.isArray(m['pinned_to']) && m['pinned_to'].length > 0
const saved = (m: Json) => m['is_starred'] === true || m['is_saved'] === true
const facets = ['filters', 'manual_filters', 'ai_filters', 'filter_suggestions']

/** All scalar values are erased, including timestamps and enum-like strings. */
function shape(value: unknown): unknown {
  if (typeof value === 'string') return 'redacted'
  if (typeof value === 'number') return 0
  if (Array.isArray(value)) return value.slice(0, 2).map(shape)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [safeKey(key), shape(child)]))
  return value
}
function types(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 0 ? [] : value.slice(0, 2).map(types)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [safeKey(key), types(child)]))
  return value === null ? 'null' : typeof value
}
function hits(response: Json) {
  return objects(response['items']).flatMap((item) => objects(item['messages']).map((m) => ({ m, c: object(item['channel']) })))
}
type Hit = ReturnType<typeof hits>[number]
const identity = ({ m, c }: Hit) => `${str(c['id'])}:${str(m['ts'])}`
function summary(response: Json) {
  const rows = hits(response)
  const pagination = object(response['pagination'])
  return {
    ok: response['ok'] === true, items: objects(response['items']).length, messages: rows.length,
    pagination: Object.fromEntries(['page', 'page_count', 'per_page', 'total_count', 'first', 'last'].filter((key) => typeof pagination[key] === 'number').map((key) => [key, pagination[key]])),
    bots: rows.filter(({ m }) => bot(m)).length, threads: rows.filter(({ m }) => thread(m)).length,
    links: rows.filter(({ m }) => link(m)).length, reactions: rows.filter(({ m }) => reaction(m)).length,
    pinned: rows.filter(({ m }) => pinned(m)).length, saved: rows.filter(({ m }) => saved(m)).length,
    descending: rows.every(({ m }, i) => i === 0 || Number(m['ts']) <= Number(rows[i - 1]?.m['ts'])),
    cursorPresent: Boolean(response['next_cursor'] || object(response['response_metadata'])['next_cursor'] || pagination['next_cursor']),
  }
}
function compare(a: Json, b: Json) {
  const left = hits(a).map(identity)
  const right = hits(b).map(identity)
  const positions = new Map(right.map((id, i) => [id, i]))
  const common = left.flatMap((id) => { const i = positions.get(id); return i === undefined ? [] : [i] })
  let discordant = 0
  for (let i = 0; i < common.length; i++) for (let j = i + 1; j < common.length; j++) if (common[i]! > common[j]!) discordant++
  const pairs = common.length * (common.length - 1) / 2
  return { left: left.length, right: right.length, overlap: common.length, sameOrder: left.length === right.length && left.every((id, i) => id === right[i]), pairs, discordant, tau: pairs === 0 ? null : 1 - 2 * discordant / pairs }
}
function highlights(response: Json) {
  const rows = hits(response)
  let markers = 0
  let strings = 0
  const walk = (value: unknown) => {
    if (typeof value === 'string') { strings++; if (/[\ue000-\uf8ff]|<\/?(?:em|b|mark)>/.test(value)) markers++ }
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk)
  }
  // Exclude attachment/file content, where markup may be part of the source.
  for (const { m } of rows) for (const key of ['text', 'extracts', 'blocks_extracts', 'blocks_extracts_typed']) walk(m[key])
  return { messages: rows.length, nonemptyExtracts: rows.filter(({ m }) => Array.isArray(m['extracts']) && m['extracts'].length > 0).length, strings, markers, extractShape: types(rows.find(({ m }) => objects(m['extracts']).length)?.m['extracts'] ?? []) }
}

type Emit = (label: string, value: unknown) => Promise<void>
type Search = (label: string, query: string, args?: Args) => Promise<Json>
async function probeText(rows: Hit[], base: string, search: Search, call: Call, emit: Emit) {
  const sampleText = rows.find(({ m }) => !bot(m) && /\b[a-zA-Z]{4,}\s+[a-zA-Z]{4,}\b/.test(str(m['text'])))?.m['text']
  const phrase = /\b[a-zA-Z]{4,}\s+[a-zA-Z]{4,}\b/.exec(str(sampleText))?.[0]
  if (phrase) {
    const word = phrase.split(/\s+/)[0]!.toLowerCase()
    const phraseResults = await search('quoted-phrase', `${base} "${phrase}"`)
    const wordResults = await search('word', `${base} ${word}`)
    const prefix = await search('word-prefix', `${base} ${word.slice(0, 4)}*`)
    const negative = await search('negative-word', `${base} -${word}`)
    await emit('text-validation', { phraseTextMatches: hits(phraseResults).filter(({ m }) => str(m['text']).toLowerCase().includes(phrase.toLowerCase())).length, wordTextMatches: hits(wordResults).filter(({ m }) => new RegExp(`\\b${word}\\b`, 'i').test(str(m['text']))).length, prefixTextMatches: hits(prefix).filter(({ m }) => new RegExp(`\\b${word.slice(0, 4)}`, 'i').test(str(m['text']))).length, negativeTextLeaks: hits(negative).filter(({ m }) => new RegExp(`\\b${word}\\b`, 'i').test(str(m['text']))).length })
    const score = await search('sort-score', `${base} ${word}`, { sort: 'score', count: 50 })
    const timestamp = await search('sort-timestamp', `${base} ${word}`, { count: 50 })
    const noSortArgs: Args = { module: 'messages', query: `${base} ${word}`, count: 50, page: 1, extracts: 1, highlight: 1, extra_message_data: 1, no_user_profile: 1 }
    const none = await call('search.modules.messages', noSortArgs, 'sort-none')
    await emit('sort-comparison', { scoreVsTime: compare(score, timestamp), noneVsScore: compare(none, score), noneVsTime: compare(none, timestamp), none: summary(none) })
    const short = await search('extract-short', `${base} ${word}`, { count: 50, max_extract_len: 30 })
    const long = await search('extract-long', `${base} ${word}`, { count: 50, max_extract_len: 500 })
    await emit('highlights', { short: highlights(short), long: highlights(long), regular: highlights(timestamp) })
  }
}

const latency = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b)
  return { calls: sorted.length, min: sorted[0], p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }
}

interface ProbeTools { readonly call: Call; readonly search: Search; readonly emit: Emit; readonly out: string }

async function probeDetail(self: string, { call, search, emit }: ProbeTools) {
  const base = `after:${day(Date.now() - 30 * DAY)} before:${day(Date.now() - DAY)}`
  const source = await search('detail-source', `${base} from:<@${self}>`)
  await probeText(hits(source), base, search, call, emit)
  const user = object((await call('users.info', { user: self }, 'detail-timezone'))['user'])
  const zone = str(user['tz'])
  const date = day(Date.now() - 3 * DAY)
  const month = date.slice(0, 7)
  for (const [label, query, sort_dir] of [
    ['detail-on', `on:${date}`, 'asc'],
    ['detail-before', `before:${date}`, 'desc'],
    ['detail-after', `after:${date}`, 'asc'],
    ['detail-month', `during:${month}`, 'asc'],
  ] as const) {
    const response = await search(label, query, { sort_dir })
    const utcDays = hits(response).map(({ m }) => day(Number(m['ts']) * 1000))
    const localDays = hits(response).map(({ m }) => zone ? new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Number(m['ts']) * 1000)) : '')
    const bins = (days: string[]) => ({ beforeDay: days.filter((d) => d < date).length, onDay: days.filter((d) => d === date).length, afterDay: days.filter((d) => d > date).length, outsideMonth: days.filter((d) => !d.startsWith(month)).length })
    await emit(`${label}-boundaries`, { utc: bins(utcDays), local: zone ? bins(localDays) : null, dayDisagreements: utcDays.filter((d, i) => d !== localDays[i]).length })
  }
  const baseline = await search('detail-saved-control', base)
  const saves = await search('detail-saved', `${base} is:saved`)
  await emit('detail-saved-comparison', { ...compare(baseline, saves), filters: types(saves['filters']), manual: types(saves['manual_filters']) })
  await search('detail-count-101', base, { count: 101 })
  const linkResults = await search('detail-links', `${base} has:link`)
  const selected = hits(linkResults).find(({ m }) => !link(m))
  if (selected) {
    const ts = str(selected.m['ts'])
    const parent = str(selected.m['thread_ts'])
    const response = parent && parent !== ts
      ? await call('conversations.replies', { channel: str(selected.c['id']), ts: parent, oldest: ts, latest: ts, inclusive: true, limit: 2 }, 'detail-link-reply')
      : await call('conversations.history', { channel: str(selected.c['id']), oldest: ts, latest: ts, inclusive: true, limit: 2 }, 'detail-link-history')
    const local = objects(response['messages']).find((m) => m['ts'] === ts)
    await emit('detail-link-comparison', { found: Boolean(local), searchTextHasUrl: link(selected.m), localTextHasUrl: local ? link(local) : null, textsEqual: local ? selected.m['text'] === local['text'] : null, searchKeys: keys([selected.m]), localKeys: local ? keys([local]) : [], searchAttachmentUrl: /https?:\/\//.test(JSON.stringify(selected.m['attachments'] ?? [])), localAttachmentUrl: /https?:\/\//.test(JSON.stringify(local?.['attachments'] ?? [])) })
  }
}

async function probeIdentity({ boot, user, self, base, channels }: { boot: Json; user: Json; self: string; base: string; channels: Json[] }, { search, emit }: ProbeTools) {
  const channelA = channels[0]
  const channelB = channels[1]
  const dm = objects(boot['ims']).find((im) => str(im['user']) && im['user'] !== self)
  const from = await search('from-mention', `${base} from:<@${self}>`)
  const handle = str(user['name'])
  const display = str(object(user['profile'])['display_name']) || str(user['real_name'])
  if (handle) await emit('from-handle-comparison', compare(from, await search('from-handle', `${base} from:@${handle}`)))
  if (display) await emit('from-display-comparison', compare(from, await search('from-display', `${base} from:"${display}"`)))
  await emit('from-raw-comparison', compare(from, await search('from-raw-id', `${base} from:${self}`)))
  await emit('from-validation', { examined: hits(from).length, selfMatches: hits(from).filter(({ m }) => m['user'] === self).length })
  if (channelA && channelB) {
    const a = str(channelA['id']); const b = str(channelB['id'])
    const inA = await search('in-mention', `${base} in:<#${a}>`)
    await emit('in-name-comparison', compare(inA, await search('in-name', `${base} in:#${str(channelA['name'])}`)))
    const inB = await search('in-second', `${base} in:<#${b}>`)
    const both = await search('in-combined', `${base} in:<#${a}> in:<#${b}>`)
    const exclude = await search('exclude-channel', `${base} -in:<#${a}>`)
    const excludePerson = await search('exclude-person', `${base} -from:<@${self}>`)
    const combined = await search('in-from-combined', `${base} in:<#${a}> from:<@${self}>`)
    await emit('identity-combination', { aTotal: object(inA['pagination'])['total_count'], bTotal: object(inB['pagination'])['total_count'], bothTotal: object(both['pagination'])['total_count'], bothInA: hits(both).filter(({ c }) => c['id'] === a).length, bothInB: hits(both).filter(({ c }) => c['id'] === b).length, excludedChannelLeaks: hits(exclude).filter(({ c }) => c['id'] === a).length, excludedPersonLeaks: hits(excludePerson).filter(({ m }) => m['user'] === self).length, combinedViolations: hits(combined).filter(({ m, c }) => m['user'] !== self || c['id'] !== a).length })
  }
  if (dm) {
    const response = await search('dm-person', `${base} in:<@${str(dm['user'])}>`)
    const raw = await search('dm-id', `${base} in:${str(dm['id'])}`)
    await emit('dm-comparison', { ...compare(response, raw), personResultsInPickedDm: hits(response).filter(({ c }) => c['id'] === dm['id']).length })
  }
  return { from, handle, channelA }
}

async function probeDates(rows: Hit[], zone: string, { search, emit }: ProbeTools) {
  const anchor = rows[Math.floor(rows.length / 2)]
  if (anchor) {
    const date = day(Number(anchor.m['ts']) * 1000)
    const utc = Date.parse(`${date}T00:00:00Z`)
    const window = `after:${day(utc - 2 * DAY)} before:${day(utc + 3 * DAY)}`
    const localDate = (ts: number) => zone ? new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts * 1000)) : ''
    for (const [label, query, args] of [
      ['date-window', window, {}],
      ['date-before', `after:${day(utc - 2 * DAY)} before:${date}`, {}],
      ['date-after', `after:${date} before:${day(utc + 3 * DAY)}`, { sort_dir: 'asc' }],
      ['date-on', `on:${date}`, {}],
      ['date-during-day', `during:${date}`, {}],
      ['date-during-month', `during:${date.slice(0, 7)}`, {}],
    ] as const) {
      const response = await search(label, query, { count: 1000, ...args })
      const ts = hits(response).map(({ m }) => Number(m['ts']))
      const utcDays = ts.map((t) => day(t * 1000))
      const localDays = ts.map(localDate)
      const bins = (days: string[]) => ({ beforeDay: days.filter((d) => d < date).length, onDay: days.filter((d) => d === date).length, afterDay: days.filter((d) => d > date).length, outsideMonth: days.filter((d) => !d.startsWith(date.slice(0, 7))).length })
      await emit(`${label}-boundaries`, { utc: bins(utcDays), local: zone ? bins(localDays) : null, dayDisagreements: utcDays.filter((d, i) => d !== localDays[i]).length, recognized: types(object(response['filters'])) })
    }
  }
}

async function probeFilters({ self, base, rows, channels }: { self: string; base: string; rows: Hit[]; channels: Json[] }, { call, search, emit }: ProbeTools) {
  const filterResponses = new Map<string, Json>()
  for (const [label, clause] of [['with-person', `with:<@${self}>`], ['has-link', 'has:link'], ['has-reaction', 'has:reaction'], ['has-pin', 'has:pin'], ['is-saved', 'is:saved'], ['is-thread', 'is:thread']] as const) {
    filterResponses.set(label, await search(label, `${base} ${clause}`))
  }
  const emoji = rows.flatMap(({ m }) => objects(m['reactions'])).map((r) => str(r['name'])).find(Boolean) || hits(filterResponses.get('has-reaction') ?? {}).flatMap(({ m }) => objects(m['reactions'])).map((r) => str(r['name'])).find(Boolean)
  if (emoji) {
    const response = await search('has-specific-reaction', `${base} has::${emoji}:`)
    filterResponses.set('has-specific-reaction', response)
    await emit('emoji-validation', { examined: hits(response).length, withReaction: hits(response).filter(({ m }) => objects(m['reactions']).some((r) => r['name'] === emoji)).length })
  }
  const local = new Map<string, Json>()
  for (const c of channels.slice(0, 2)) {
    const history = await call('conversations.history', { channel: str(c['id']), limit: 100 }, 'local-history')
    for (const m of objects(history['messages'])) local.set(identity({ m, c }), m)
  }
  const pinRows = hits(filterResponses.get('has-pin') ?? {})
  const pinChannel = pinRows[0]?.c ?? channels[0]
  let pinList: Json = {}
  if (pinChannel) pinList = await call('pins.list', { channel: str(pinChannel['id']) }, 'local-pins')
  const starList = await call('stars.list', { count: 100, page: 1 }, 'local-saves')
  for (const [label, response] of filterResponses) {
    const selected = hits(response)[0]
    let exactFound = false
    if (selected) {
      const ts = str(selected.m['ts'])
      const parent = str(selected.m['thread_ts'])
      const answer = parent && parent !== ts
        ? await call('conversations.replies', { channel: str(selected.c['id']), ts: parent, oldest: ts, latest: ts, inclusive: true, limit: 2 }, 'exact-filter-reply')
        : await call('conversations.history', { channel: str(selected.c['id']), oldest: ts, latest: ts, inclusive: true, limit: 2 }, 'exact-filter-history')
      const exact = objects(answer['messages']).find((m) => m['ts'] === ts)
      if (exact) { local.set(identity(selected), exact); exactFound = true }
    }
    const subset = hits(response)
    const predicate = label === 'has-link' ? link : label === 'has-reaction' || label === 'has-specific-reaction' ? reaction : label === 'has-pin' ? pinned : label === 'is-saved' ? saved : label === 'is-thread' ? thread : (m: Json) => m['user'] === self || str(m['text']).includes(`<@${self}>`)
    const matched = subset.flatMap((h) => { const m = local.get(identity(h)); return m ? [m] : [] })
    await emit(`${label}-local`, { exactFound, examined: subset.length, searchPredicateTrue: subset.filter(({ m }) => predicate(m)).length, historyOverlap: matched.length, historyPredicateTrue: matched.filter(predicate).length })
  }
  const pinIds = new Set(objects(pinList['items']).map((i) => str(object(i['message'])['ts'])))
  const savedIds = new Set(objects(starList['items']).map((i) => `${str(i['channel'])}:${str(object(i['message'])['ts'])}`))
  await emit('pin-save-lists', { pinOk: pinList['ok'] === true, pinListCount: objects(pinList['items']).length, pinSearchInChannel: pinRows.filter(({ c }) => c['id'] === pinChannel?.['id']).length, pinConfirmed: pinRows.filter(({ m, c }) => c['id'] === pinChannel?.['id'] && pinIds.has(str(m['ts']))).length, savedOk: starList['ok'] === true, savedListCount: objects(starList['items']).length, savedPaging: types(starList['paging']), savedConfirmed: hits(filterResponses.get('is-saved') ?? {}).filter((h) => savedIds.has(identity(h))).length })
}

async function probePagingAndModules({ baseline, base, handle, channelA }: { baseline: Json; base: string; handle: string; channelA: Json | undefined }, { call, search, emit, out }: ProbeTools) {
  const noBots1 = await search('exclude-bots-1', base, { search_exclude_bots: 1 })
  const noBotsTrue = await search('exclude-bots-true', base, { search_exclude_bots: true })
  await emit('bot-comparison', { baselineVsOne: compare(baseline, noBots1), oneVsTrue: compare(noBots1, noBotsTrue) })
  const page1 = await search('paging-20-first', base, { count: 20 })
  const page2 = await search('paging-20-second', base, { count: 20, page: 2 })
  const cursor = str(page1['next_cursor']) || str(object(page1['response_metadata'])['next_cursor']) || str(object(page1['pagination'])['next_cursor'])
  const cursorRead = await search('paging-cursor', base, { count: 20, cursor: cursor || 'probe-invalid-cursor' })
  for (const count of [200, 1000, 1001, 10000]) await search(`paging-count-${count}`, base, { count })
  const reread = await search('paging-repeat', base, { count: 20 })
  await emit('paging-comparison', { pages: compare(page1, page2), repeat: compare(page1, reread), cursorProvidedByServer: Boolean(cursor), cursorVsFirst: compare(page1, cursorRead), cursorVsSecond: compare(page2, cursorRead) })
  const naturalResponses = []
  for (const rewrite of [undefined, false, true]) {
    const label = rewrite === undefined ? 'natural-default' : rewrite ? 'natural-disabled' : 'natural-enabled'
    const response = await search(label, 'from me last week', rewrite === undefined ? {} : { query_rewrite_disabled: rewrite })
    naturalResponses.push(response)
    await emit(`${label}-facets`, { topKeys: keys([response]), returnedQueryEqualsInput: response['query'] === 'from me last week', ...Object.fromEntries(facets.map((key) => [key, key in response ? types(response[key]) : 'absent'])) })
  }
  await emit('natural-comparison', { defaultVsEnabled: compare(naturalResponses[0]!, naturalResponses[1]!), enabledVsDisabled: compare(naturalResponses[1]!, naturalResponses[2]!) })
  for (const module of ['files', 'people', 'channels'] as const) {
    const query = module === 'files' ? base : module === 'people' ? handle : str(channelA?.['name'])
    const response = await call(`search.modules.${module}`, { module, query, count: 20, page: 1 }, `module-${module}`)
    await emit(`module-${module}`, { ok: response['ok'] === true, topKeys: keys([response]), items: objects(response['items']).length, itemKeys: keys(objects(response['items'])), firstItemShape: types(objects(response['items'])[0]), pagination: summary(response).pagination })
    if (objects(response['items']).length) await writeFile(join(out, `search.modules.${module}.json`), JSON.stringify(shape({ ...response, items: objects(response['items']).slice(0, 1) }), null, 2) + '\n')
  }
}

export async function probeSearch(cached: CachedSession, requestedOut?: string, section?: string): Promise<void> {
  if (section !== undefined && section !== 'detail') throw new Error('unknown section')
  const scratch = existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork' : tmpdir()
  if (scratch !== '/Volumes/AgentWork' && requestedOut === undefined) console.log('search2: scratch volume unavailable; using system temp directory')
  const out = requestedOut ?? await mkdtemp(join(scratch, 'search-probe-'))
  await mkdir(out, { recursive: true })
  const records: { label: string; method: Method; millis: number; status: number; ok: boolean; rateLimited: boolean; error: string | undefined }[] = []
  let lastStart = 0
  const call: Call = async (method, args, label) => {
    if (!methods.includes(method) || records.length >= 75) throw new Error('probe limit')
    await sleep(Math.max(0, lastStart + 3_000 - Date.now()))
    lastStart = Date.now()
    const body = new FormData()
    body.set('token', cached.session.token)
    body.set('_x_reason', 'probe')
    body.set('_x_mode', 'online')
    for (const [key, value] of Object.entries(args)) body.set(key, String(value))
    const url = new URL(`${apiBaseFromWorkspace(cached.session.workspaceUrl)}/${method}`)
    url.searchParams.set('slack_route', slackRoute(cached.session))
    url.searchParams.set('_x_app_name', 'client')
    const started = performance.now()
    const response = await fetch(url, { method: 'POST', body, headers: { cookie: cached.cookie }, signal: AbortSignal.timeout(30_000) })
    const json = object(await response.json())
    const limited = response.status === 429 || /rate_?limit/.test(str(json['error']))
    const error = ['unknown_method', 'invalid_arguments', 'invalid_auth', 'not_authed', 'missing_scope', 'not_allowed_token_type', 'deprecated_method'].includes(str(json['error'])) ? str(json['error']) : json['ok'] === true ? undefined : 'other'
    const record = { label, method, millis: Math.round(performance.now() - started), status: response.status, ok: json['ok'] === true, rateLimited: limited, error }
    records.push(record)
    console.log(JSON.stringify(record))
    await writeFile(join(out, 'calls.json'), JSON.stringify(records, null, 2) + '\n')
    if (limited) throw new Error('rate limit: stopped')
    if (response.status === 401 || error === 'invalid_auth' || error === 'not_authed') throw new Error('authentication: stopped')
    return json
  }
  const report: Json = {}
  const emit = async (label: string, value: unknown) => {
    report[label] = value
    console.log(JSON.stringify({ section: label, result: value }))
    await writeFile(join(out, 'search2-counts.json'), JSON.stringify(report, null, 2) + '\n')
  }
  const search = async (label: string, query: string, args: Args = {}) => {
    const response = await call('search.modules.messages', { module: 'messages', query, count: 100, page: 1, sort: 'timestamp', sort_dir: 'desc', extracts: 1, highlight: 1, extra_message_data: 1, no_user_profile: 1, max_extract_len: 200, ...args }, label)
    await emit(label, summary(response))
    return response
  }
  const auth = await call('auth.test', {}, 'auth')
  const self = str(auth['user_id'])
  if (!self) throw new Error('no identity')
  if (section === 'detail') {
    await probeDetail(self, { call, search, emit, out })
  } else {
    const boot = await call('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true }, 'boot')
    const prefs = object((await call('users.prefs.get', {}, 'prefs'))['prefs'])
    const user = object((await call('users.info', { user: self }, 'self-profile'))['user'])
    const zone = str(user['tz']) || str(prefs['tz']) || str(object(boot['self'])['tz'])
    const offset = num(user['tz_offset'])
    await emit('timezone', { userTimezonePresent: Boolean(str(user['tz'])), userOffsetSeconds: offset, prefsTimezoneKeys: Object.keys(prefs).filter((k) => /^(tz|timezone)/.test(k)).map(safeKey), bootSelfTimezonePresent: Boolean(object(boot['self'])['tz']), zoneAvailable: Boolean(zone) })
    const base = `after:${day(Date.now() - 30 * DAY)}`
    const baseline = await search('baseline', base)
    const rows = hits(baseline)
    const channels = [...new Map(rows.filter(({ c }) => c['is_channel'] === true && str(c['name'])).map(({ c }) => [str(c['id']), c])).values()]
    const { from, handle, channelA } = await probeIdentity({ boot, user, self, base, channels }, { call, search, emit, out })
    await probeText([...rows, ...hits(from)], base, search, call, emit)
    await probeDates(rows, zone, { call, search, emit, out })
    await probeFilters({ self, base, rows, channels }, { call, search, emit, out })
    await probePagingAndModules({ baseline, base, handle, channelA }, { call, search, emit, out })
  }
  await emit('latency', { all: latency(records.map((r) => r.millis)), messages: latency(records.filter((r) => r.method === 'search.modules.messages').map((r) => r.millis)), rateLimits: records.filter((r) => r.rateLimited).length, minimumStartSpacingMillis: 3000, budget: 75 })
}
