/**
 * The chat as the renderer lists it (agent-contract `ChatItem`), built from
 * the agent's records: owner messages from the inbox, Juno's bubbles from
 * each run's archived text (or the live run), endings from `runs`, and
 * reactions. Plain functions over the store, so the server only decides
 * when to rebuild.
 *
 * - An owner message is an inbox `send` or `steer`. A `retry` is the same
 *   message sent again, so it is not a second bubble: a reply or reaction
 *   that names the retry points at the original.
 * - A bubble's time is when it was first shown (`chat_bubbles`): when the
 *   model closed it in a live run, or its archive row's time for a bubble
 *   the server never saw live. It never changes, so neither the order nor
 *   the read state moves when the run ends and the archive catches up.
 * - Bubbles group by sender within two minutes and the same origin; a day
 *   separator, an ending or a group label ends a group.
 * - A Juno bubble is unread when it is newer than the read mark.
 *
 * - Cards (WP15) sit at the time Juno proposed them, under their run; a
 *   Task card at the time its job started. A card is unread like a bubble.
 *
 * A removed owner message is a "Removed" note in its place. Other notes
 * come with the pin events; they are not listed yet.
 */
import type {
  BubbleId,
  CardId,
  ChatItem,
  ChatMessageId,
  ChatSummary,
  ChatWindow as ChatWindowSchema,
  Ending,
  GroupPosition,
  JobId,
  JunoInline,
  OpId,
  Origin,
  Quote,
  Reaction,
  ReplyTarget,
  RunId,
  SendContext,
  ScheduleId,
} from '@juno/agent-contract'
import type { CardView } from '../actions/cards'
import { sessionOf } from '../t3/protocol'
import { aboutOf } from '@juno/agent-contract'
import type { Job } from '../jobs/jobs'
import type { RunState } from '../router/events'
import { parseOutput } from '../router/output'
import { resolveSpans, sourceTable, type BubbleSpan } from '../router/sources'
import type { Store } from '../store/store'
import { chatRevisions, keyedMemo, memo } from './cache'

const GROUP_GAP_MS = 2 * 60_000
const PREVIEW_CHARS = 120

export interface ChatSource {
  readonly store: Store
  readonly live: RunState | undefined
  /** When a bubble was first shown; `fallback` is stored for a bubble not seen before. */
  readonly seen: (bubbleId: string, fallback: number) => number
  readonly jobs: ReadonlyArray<Job>
  /** Every card Juno proposed (`actions.views`). */
  readonly cards: ReadonlyArray<CardView>
  /** Juno items at or before this time are read. */
  readonly readAt: number
  /** Why accepted messages wait, if they do. */
  readonly waiting: 'network' | 'resume' | 'review' | undefined
  /** Local midnight of the day `at` falls in. */
  readonly dayOf: (at: number) => number
}

interface OpRow {
  readonly seq: number
  readonly opId: string
  readonly kind: string
  readonly text: string
  readonly data: string | null
  readonly at: number
  readonly state: string
}

interface RunRow {
  readonly id: string
  readonly opId: string
  readonly origin: 'owner' | 'wake' | 'report' | 'click'
  readonly startedAt: number
  readonly endedAt: number | null
  readonly ending: string | null
}

/** One bubble before grouping. */
type Bubble =
  | { readonly by: 'owner'; readonly at: number; readonly item: Omit<Extract<ChatItem, { _tag: 'owner' }>, 'group'> }
  | { readonly by: 'juno'; readonly at: number; readonly originKey: string; readonly item: Omit<Extract<ChatItem, { _tag: 'juno' }>, 'group'> }

type Entry =
  | Bubble
  | { readonly by: 'line'; readonly at: number; readonly item: ChatItem }

const firstLine = (text: string) => {
  const line = text.trim().split('\n', 1)[0] ?? ''
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1)}…` : line
}

const parse = <A>(json: string | null): A | undefined => (json === null ? undefined : (JSON.parse(json) as A))

type ArchiveRow = { runId: string; text: string; entry: string; at: number }
type ReactionRow = { kind: string; id: string; by: 'owner' | 'juno'; emoji: string | null }
const emptyReactions: Reaction[] = []

function caches() {
  return {
    ops: memo<ReadonlyArray<OpRow>>(),
    times: memo<Map<string, number>>(),
    opMaps: memo<{ original: Map<string, string>; text: Map<string, string>; handles: Map<string, string> }>(),
    archived: memo<Map<string, ArchiveRow[]>>(),
    origins: keyedMemo<Origin>(),
    sourceKeys: memo<Map<string, string>>(),
    endings: keyedMemo<Entry | undefined>(),
    runs: memo<ReadonlyArray<RunRow>>(),
    archiveIds: memo<Map<string, ChatMessageId>>(),
    archive: memo<ReadonlyArray<ArchiveRow>>(),
    reactions: memo<ReadonlyArray<ReactionRow>>(),
    aliases: memo<Map<string, string>>(),
    reactionMap: memo<Map<string, Reaction[]>>(),
    started: memo<Map<string, number>>(),
    bubbles: keyedMemo<ReturnType<typeof archivedBubbles>>(),
    entries: keyedMemo<Entry>(),
    removed: memo<{ readonly ops: ReadonlySet<string>; readonly bubbles: ReadonlySet<string> }>(),
    grouped: keyedMemo<ChatItem>(),
  }
}
type Caches = ReturnType<typeof caches>
const invalidators = new WeakMap<Store['db'], Set<() => void>>()

/** WP16: call after committing redaction, before any subscriber reads the page. */
export function invalidateChatCaches(store: Store): void {
  for (const invalidate of invalidators.get(store.db) ?? []) invalidate()
}

/** One cache per chat server. Invalidate before publishing a redaction's change signal. */
export function createChatCache(store: Store, changed: () => void = () => {}) {
  const revisions = chatRevisions(store)
  let cache = caches()
  let previous: { inputs: ReadonlyArray<unknown>; items: ReadonlyArray<ChatItem>; reactions: Map<string, Reaction[]>; indexes: Map<string, number> } | undefined
  const invalidateAll = () => { cache = caches(); previous = undefined; changed() }
  const registered = invalidators.get(store.db) ?? new Set<() => void>()
  registered.add(invalidateAll)
  invalidators.set(store.db, registered)
  const inputs = (source: ChatSource, revision: ReturnType<typeof revisions>) => [
    ...revision('inbox', 'messages', 'runs', 'run_inputs', 'sources', 'chat_bubbles', 'jobs', 'tool_blocks'),
    source.readAt, source.waiting, source.dayOf, new Date().getTimezoneOffset(),
    JSON.stringify(source.jobs), JSON.stringify(source.cards.map((view) => [view.at, view.runId, view.card.id])),
    JSON.stringify(source.live === undefined ? undefined : { ...source.live, status: undefined }),
  ]
  return {
    items(source: ChatSource): ReadonlyArray<ChatItem> {
      const revision = revisions()
      const next = inputs(source, revision)
      const known = previous
      if (known !== undefined && next.every((input, n) => input === known.inputs[n])) {
        // These changes cannot move a row or change its neighbours' grouping.
        const reactions = reactionsFor(store, cache, revision)
        let updatedItems: ChatItem[] | undefined
        let items = known.items
        const replace = (index: number, item: ChatItem) => {
          updatedItems ??= known.items.slice()
          updatedItems[index] = item
          items = updatedItems
        }
        if (reactions !== known.reactions) {
          for (const key of new Set([...reactions.keys(), ...known.reactions.keys()])) {
            const updated = reactions.get(key) ?? emptyReactions
            if (JSON.stringify(updated) === JSON.stringify(known.reactions.get(key) ?? emptyReactions)) continue
            const index = known.indexes.get(key)
            const item = index === undefined ? undefined : items[index]
            if (index !== undefined && item !== undefined && (item._tag === 'owner' || item._tag === 'juno' || item._tag === 'card')) replace(index, { ...item, reactions: updated })
          }
        }
        for (const view of source.cards) {
          const index = known.indexes.get(`card:${view.card.id}`)
          const item = index === undefined ? undefined : items[index]
          if (index !== undefined && item?._tag === 'card' && JSON.stringify(item.card) !== JSON.stringify(view.card)) replace(index, { ...item, card: view.card })
        }
        const statusIndex = known.indexes.get('status')
        const status = statusIndex === undefined ? undefined : items[statusIndex]
        if (statusIndex !== undefined && status?._tag === 'status' && source.live?.runId === status.runId && status.text !== source.live.status.text) {
          const text = source.live.status.text
          replace(statusIndex, { _tag: 'status', runId: status.runId, ...(text === undefined ? {} : { text }) })
        }
        previous = { inputs: next, items, reactions, indexes: known.indexes }
        return items
      }
      const items = buildItems(source, cache, revision)
      // First display can persist timestamps. Include those writes in the snapshot.
      const indexes = new Map<string, number>()
      items.forEach((item, index) => {
        if (item._tag === 'owner') indexes.set(`owner:${item.opId}`, index)
        else if (item._tag === 'juno') indexes.set(`bubble:${item.id}`, index)
        else if (item._tag === 'card') indexes.set(`card:${item.card.id}`, index)
        else if (item._tag === 'status') indexes.set('status', index)
      })
      previous = { inputs: inputs(source, revisions()), items, reactions: reactionsFor(store, cache, revision), indexes }
      return items
    },
    invalidateAll,
    close: () => { registered.delete(invalidateAll); cache = caches(); previous = undefined },
  }
}

function reactionsFor(store: Store, cache: Caches, revision: ReturnType<ReturnType<typeof chatRevisions>>) {
  const aliases = cache.aliases(revision('inbox'), () => {
    const result = new Map<string, string>()
    const retries = store.db.prepare("SELECT op_id, data FROM inbox WHERE kind = 'retry' ORDER BY seq").all()
    for (const row of retries) {
      const of = parse<{ retryOf?: string }>(row.data as string | null)?.retryOf
      if (of !== undefined) result.set(String(row.op_id), result.get(of) ?? of)
    }
    return result
  })
  const rows = cache.reactions(revision('reactions'), () => store.db.prepare(
    `SELECT target_kind AS kind, target_id AS id, by, emoji FROM reactions r
     WHERE seq = (SELECT max(seq) FROM reactions WHERE target_kind = r.target_kind AND target_id = r.target_id AND by = r.by)
     ORDER BY seq`,
  ).all() as ReactionRow[])
  return cache.reactionMap([aliases, rows], () => {
    const result = new Map<string, Reaction[]>()
    for (const row of rows) {
      if (row.emoji === null) continue
      const key = `${row.kind}:${row.kind === 'owner' ? aliases.get(row.id) ?? row.id : row.id}`
      result.set(key, [...(result.get(key) ?? []), { by: row.by, emoji: row.emoji as Reaction['emoji'] }])
    }
    return result
  })
}

/** Every item in the chat, oldest first. */
function buildItems(source: ChatSource, cache: Caches, revision: ReturnType<ReturnType<typeof chatRevisions>>): ReadonlyArray<ChatItem> {
  const { store } = source
  const ops = cache.ops(revision('inbox'), () => store.db
    .prepare("SELECT seq, op_id AS opId, kind, text, data, at, state FROM inbox WHERE kind IN ('send', 'steer', 'retry') ORDER BY seq")
    .all() as unknown as ReadonlyArray<OpRow>)
  // A retry stands for the message it resends.
  const maps = cache.opMaps([ops], () => {
    const original = new Map<string, string>()
    for (const op of ops) {
      if (op.kind !== 'retry') continue
      const of = parse<{ retryOf?: string }>(op.data)?.retryOf
      if (of !== undefined) original.set(op.opId, original.get(of) ?? of)
    }
    return { original, text: new Map(ops.map((op) => [op.opId, op.text])), handles: new Map(ops.map((op) => [`n${op.seq}`, op.opId])) }
  })
  const ownerOp = (opId: string) => maps.original.get(opId) ?? opId
  // A removed message shows as "Removed", and a quote of it reads Removed (WP16). A removal clears inbox and archive text in one transaction.
  const removed = cache.removed(revision('inbox', 'messages'), () => ({
    ops: new Set((store.db.prepare('SELECT op_id AS opId FROM removed_ops').all() as Array<{ opId: string }>).map((row) => row.opId)),
    bubbles: new Set((store.db.prepare('SELECT bubble_id AS id FROM removed_bubbles').all() as Array<{ id: string }>).map((row) => row.id)),
  }))
  const opText = { get: (opId: string) => (removed.ops.has(opId) ? undefined : maps.text.get(opId)) }
  const handles = maps.handles
  const times = cache.times(revision('chat_bubbles'), () => new Map(
    store.db.prepare('SELECT id, at FROM chat_bubbles').all().map((row) => [String(row.id), Number(row.at)]),
  ))
  const seen = (id: string, fallback: number) => {
    const known = times.get(id)
    if (known !== undefined) return known
    const at = source.seen(id, fallback)
    times.set(id, at)
    return at
  }

  const archiveIds = cache.archiveIds(revision('messages'), () => new Map(
    (store.db.prepare("SELECT origin_op AS opId, min(id) AS id FROM messages WHERE kind = 'user' AND origin_op IS NOT NULL GROUP BY origin_op").all() as Array<{
      opId: string
      id: number
    }>).map((row) => [row.opId, String(row.id) as ChatMessageId]),
  ))

  const reactionMap = reactionsFor(store, cache, revision)
  const reactionsOf = (kind: string, id: string) => reactionMap.get(`${kind}:${id}`) ?? emptyReactions

  const bubbleTexts = new Map<string, string>()
  const quoteOf = (target: ReplyTarget): Quote => {
    switch (target._tag) {
      case 'owner': {
        const opId = ownerOp(target.opId)
        const text = opText.get(opId)
        return text === undefined
          ? { target: { _tag: 'owner', opId: opId as OpId }, preview: '', removed: true }
          : { target: { _tag: 'owner', opId: opId as OpId }, preview: firstLine(text) }
      }
      case 'bubble': {
        const text = removed.bubbles.has(target.id) ? undefined : bubbleTexts.get(target.id)
        return text === undefined ? { target, preview: '', removed: true } : { target, preview: firstLine(text) }
      }
      case 'card':
        return { target, preview: '' }
    }
  }

  const entries: Entry[] = []

  // Juno's side first, so an owner reply can quote any bubble.
  const runs = cache.runs(revision('runs'), () => store.db
    .prepare('SELECT id, op_id AS opId, origin, started_at AS startedAt, ended_at AS endedAt, ending FROM runs ORDER BY started_at, id')
    .all() as unknown as ReadonlyArray<RunRow>)
  const juno = cache.archive(revision('messages', 'run_inputs'), () => store.db
    .prepare(
      `SELECT run_inputs.run_id AS runId, messages.text, messages.incarnation || '/' || messages.entry_id AS entry, messages.at
       FROM messages JOIN run_inputs ON run_inputs.op_id = messages.origin_op
       WHERE messages.kind = 'juno' AND messages.redacted_gen IS NULL ORDER BY messages.id`,
    )
    .all() as ArchiveRow[])
  const archived = cache.archived([juno], () => {
    const byRun = new Map<string, ArchiveRow[]>()
    for (const row of juno) {
      const rows = byRun.get(row.runId)
      if (rows === undefined) byRun.set(row.runId, [row])
      else rows.push(row)
    }
    return byRun
  })
  const sourceKeys = cache.sourceKeys(revision('sources'), () => {
    const keys = new Map<string, string[]>()
    for (const row of store.db.prepare('SELECT * FROM sources ORDER BY run_id, handle').all()) {
      const id = String(row.run_id)
      const rows = keys.get(id) ?? []
      rows.push(JSON.stringify(row))
      keys.set(id, rows)
    }
    return new Map([...keys].map(([id, rows]) => [id, rows.join('\n')]))
  })

  const junoEntries: Entry[] = []
  for (const run of runs) {
    const live = source.live?.runId === run.id ? source.live : undefined
    const job = run.origin === 'report' ? source.jobs.find((candidate) => candidate.id === reportJob(run.opId)) : undefined
    const origin = cache.origins.get(run.id, [run.origin, run.opId, job?.id, job?.title], () => originOf(run, source.jobs, store))
    const originKey = origin._tag === 'job' ? `job:${origin.jobs.map((j) => j.jobId).join(',')}` : origin._tag === 'schedule' ? `schedule:${origin.scheduleId}` : origin._tag
    let bubbles: ReadonlyArray<{ id: string; text: string; body: ReadonlyArray<BubbleSpan>; replyTo?: string; at: number }>
    if (live !== undefined) {
      bubbles = live.bubbles.map((b) => ({ ...b, at: source.seen(b.id, Date.now()) }))
    } else {
      const rows = archived.get(run.id) ?? []
      bubbles = cache.bubbles.get(run.id, [run.startedAt, sourceKeys.get(run.id), ...rows.flatMap((row) => [row.text, row.entry, row.at])],
        () => archivedBubbles(store, run.id, rows, run.startedAt))
    }
    if (bubbles.length > 0 && origin._tag !== 'owner') {
      const at = seen(bubbles[0]!.id, bubbles[0]!.at)
      const text = labelOf(origin, source.jobs)
      junoEntries.push(cache.entries.get(`label:${run.id}`, [at, origin, text],
        () => ({ by: 'line', at, item: { _tag: 'groupLabel', id: `label:${run.id}`, origin, text } })))
    }
    for (const bubble of bubbles) {
      bubbleTexts.set(bubble.id, bubble.text)
      const at = seen(bubble.id, bubble.at)
      const replyOp = live === undefined ? handles.get(`n${Number(/^n(\d+)$/.exec(bubble.replyTo ?? '')?.[1])}`) : bubble.replyTo
      const replyTo = replyOp === undefined ? undefined : ({ _tag: 'owner', opId: ownerOp(replyOp) as OpId } as const)
      const quote = replyTo ? quoteOf(replyTo) : undefined
      const reactions = reactionsOf('bubble', bubble.id)
      junoEntries.push(cache.entries.get(`bubble:${bubble.id}`, [bubble.body, at, origin, quote?.preview, quote?.removed, replyTo?.opId, JSON.stringify(reactions), at > source.readAt], () => ({
        by: 'juno',
        at,
        originKey,
        item: {
          _tag: 'juno',
          id: bubble.id as BubbleId,
          runId: run.id as RunId,
          body: bubble.body.map(inlineOf),
          at,
          origin,
          ...(quote ? { replyTo: quote } : {}),
          reactions,
          unread: at > source.readAt,
        },
      })))
    }
    const ending = cache.endings.get(run.id, [run.ending, run.endedAt, run.startedAt], () => {
      const parsed = parse<Ending>(run.ending)
      return parsed === undefined || parsed._tag === 'complete' ? undefined
        : { by: 'line', at: run.endedAt ?? run.startedAt, item: { _tag: 'ending', runId: run.id as RunId, ending: parsed } }
    })
    if (ending !== undefined) junoEntries.push(ending)
    if (live !== undefined) {
      junoEntries.push({ by: 'line', at: Number.POSITIVE_INFINITY, item: { _tag: 'status', runId: run.id as RunId, ...(live.status.text === undefined ? {} : { text: live.status.text }) } })
    }
  }

  for (const op of ops) {
    if (op.kind === 'retry') continue
    const id = archiveIds.get(op.opId)
    if (removed.ops.has(op.opId)) {
      entries.push({ by: 'line', at: op.at, item: { _tag: 'note', id: id ?? (`removed:${op.opId}` as ChatMessageId), kind: 'removed' } })
      continue
    }
    const data = parse<{ replyTo?: ReplyTarget; context?: SendContext }>(op.data)
    const quote = data?.replyTo === undefined ? undefined : quoteOf(data.replyTo)
    const reactions = reactionsOf('owner', op.opId)
    const waiting = op.state === 'accepted' ? source.waiting : undefined
    entries.push(cache.entries.get(`owner:${op.opId}`, [op.text, op.at, op.state, op.data, id, waiting, JSON.stringify(quote), JSON.stringify(reactions)], () => ({
      by: 'owner',
      at: op.at,
      item: {
        _tag: 'owner',
        opId: op.opId as OpId,
        ...(id === undefined ? {} : { id }),
        text: op.text,
        at: op.at,
        delivery: waiting !== undefined ? { _tag: 'waiting', for: waiting } : { _tag: 'sent' },
        ...(quote === undefined ? {} : { replyTo: quote }),
        ...(data?.context === undefined ? {} : { about: aboutOf(data.context) }),
        reactions,
      },
    })))
  }
  entries.push(...junoEntries)
  for (const row of store.db.prepare('SELECT call_id, at FROM tool_blocks').all()) {
    entries.push({ by: 'line', at: Number(row.at), item: { _tag: 'note', id: `blocked:${String(row.call_id)}` as ChatMessageId, kind: 'secretBlocked' } })
  }
  for (const view of source.cards) {
    const reactions = reactionsOf('card', view.card.id)
    entries.push(cache.entries.get(`card:${view.card.id}`, [view.at, view.runId, JSON.stringify(view.card), JSON.stringify(reactions), view.at > source.readAt],
      () => ({ by: 'line', at: view.at, item: { _tag: 'card', runId: view.runId as RunId, card: view.card, reactions, unread: view.at > source.readAt } })))
  }
  const started = cache.started(revision('jobs'), () => new Map(
    (store.db.prepare('SELECT id, created_at AS at FROM jobs').all() as Array<{ id: string; at: number }>).map((row) => [row.id, row.at]),
  ))
  for (const job of source.jobs) {
    const at = started.get(job.id) ?? job.stepAt
    const session = job.kind === 't3' ? sessionOf(job.task) : undefined
    const pr = session?.pullRequest
    const open = session === undefined ? {} : { open: { _tag: 'url' as const,
      url: job.phase === 'done' && pr ? pr.url : `t3-thread://v1/${session.threadId}`,
      label: job.phase === 'done' && pr ? `Open PR ${pr.number}` : 'Open',
    } }
    const card = {
      ...open,
      _tag: 'task' as const, id: `task:${job.id}` as CardId, jobId: job.id as JobId, kind: job.kind, title: job.title, where: job.place,
      phase: job.phase === 'unknown' ? ('failed' as const) : job.phase, ...(job.state === null ? {} : { state: job.state }),
    }
    const reactions = reactionsOf('card', card.id)
    entries.push(cache.entries.get(`card:${card.id}`, [at, job.runId, JSON.stringify(card), JSON.stringify(reactions), at > source.readAt],
      () => ({ by: 'line', at, item: { _tag: 'card', runId: job.runId as RunId, card, reactions, unread: at > source.readAt } })))
  }
  // Stable: at the same time an owner message comes before what answers it.
  entries.sort((a, b) => a.at - b.at)
  const result = layout(entries, source, cache.grouped)
  cache.endings.sweep()
  cache.origins.sweep()
  cache.bubbles.sweep()
  cache.entries.sweep()
  cache.grouped.sweep()
  return result
}

/** A finished run's bubbles from its archived text, each timed by the archive row it was written in. */
function archivedBubbles(store: Store, runId: string, rows: ReadonlyArray<{ text: string; entry: string; at: number }>, startedAt: number) {
  const entries: Array<{ text: string; at: number }> = []
  let last: string | undefined
  for (const row of rows) {
    if (row.entry === last) entries[entries.length - 1]!.text += row.text
    else entries.push({ text: row.text, at: row.at })
    last = row.entry
  }
  const output = parseOutput(entries.map((e) => e.text).join('\n\n'))
  // How many bubbles each entry closed, to time each bubble by its entry.
  const times: number[] = []
  for (const entry of entries) for (let n = parseOutput(entry.text).bubbles.length; n > 0; n--) times.push(entry.at)
  const sources = sourceTable(store, runId)
  return output.bubbles.map((bubble, n) => {
    const replyTo = bubble.replyTo
    const body = resolveSpans(bubble.spans, sources)
    return { id: `${runId}:${n}`, text: bubble.text, body, at: times[n] ?? entries.at(-1)?.at ?? startedAt, ...(replyTo ? { replyTo } : {}) }
  })
}

/** A span of a bubble as the chat shows it. A source the host did not name a channel for shows its channel id as the place. */
const inlineOf = (span: BubbleSpan): JunoInline =>
  'source' in span
    ? { _tag: 'source', text: span.text, channelId: span.source.channelId, ts: span.source.ts, place: span.source.place ?? span.source.channelId }
    : { _tag: 'text', text: span.text }

const reportJob = (opId: string) => /^report:([^:]+):/.exec(opId)?.[1]

/** What started a run, using the persisted occurrence for a schedule wake. */
function originOf(run: RunRow, jobs: ReadonlyArray<Job>, store: Store): Origin {
  if (run.origin === 'wake') {
    const row = store.db.prepare(`SELECT s.id, json_extract(s.definition, '$.what') AS name
      FROM schedules s JOIN schedule_occurrences o ON o.schedule_id = s.id WHERE o.op_id = ?`).get(run.opId)
    if (typeof row?.id === 'string' && typeof row.name === 'string') return { _tag: 'schedule', scheduleId: row.id as ScheduleId, name: row.name }
  }
  if (run.origin !== 'report') return { _tag: 'owner' }
  const jobId = reportJob(run.opId)
  const job = jobs.find((j) => j.id === jobId)
  return job === undefined ? { _tag: 'owner' } : { _tag: 'job', jobs: [{ jobId: job.id as JobId, title: job.title }] }
}

function labelOf(origin: Origin, jobs: ReadonlyArray<Job>): string {
  switch (origin._tag) {
    case 'job': {
      const [first] = origin.jobs
      const place = jobs.find((j) => j.id === first?.jobId)?.place ?? 'Juno'
      return origin.jobs.length === 1 ? `${place} · ${first!.title}` : `${place} · ${origin.jobs.length} jobs`
    }
    case 'schedule':
      return `Scheduled · ${origin.name}`
    case 'owner':
      return ''
  }
}

/** Day separators, the "New" divider, and each bubble's place in its group. */
function layout(entries: ReadonlyArray<Entry>, source: ChatSource, grouped: Caches['grouped']): ReadonlyArray<ChatItem> {
  const items: ChatItem[] = []
  const unread = entries.filter((e) => e.by === 'juno' && e.item.unread).length
  let divided = false
  let day: number | undefined
  // The bubbles of the open group, as indexes into `items`.
  let group: number[] = []
  let previous: Bubble | undefined
  const close = () => {
    group.forEach((index, n) => {
      const position: GroupPosition = group.length === 1 ? 'single' : n === 0 ? 'first' : n === group.length - 1 ? 'last' : 'middle'
      const item = items[index]!
      const key = `${item._tag}:${keyOf(item)!}`
      items[index] = grouped.get(key, [item, position], () => ({ ...item, group: position } as ChatItem))
    })
    group = []
    previous = undefined
  }
  for (const entry of entries) {
    if (Number.isFinite(entry.at)) {
      const start = source.dayOf(entry.at)
      if (start !== day) {
        close()
        day = start
        items.push({ _tag: 'day', at: start })
      }
    }
    if (!divided && entry.by === 'juno' && entry.item.unread) {
      close()
      divided = true
      items.push({ _tag: 'newDivider', count: unread })
    }
    if (entry.by === 'line') {
      close()
      items.push(entry.item)
      continue
    }
    const joins =
      previous !== undefined &&
      previous.by === entry.by &&
      entry.at - previous.at <= GROUP_GAP_MS &&
      (entry.by === 'owner' || (previous.by === 'juno' && previous.originKey === entry.originKey))
    if (!joins) close()
    group.push(items.length)
    items.push(entry.item as ChatItem)
    previous = entry
  }
  close()
  return items
}

/** The id a window can be anchored on. */
export function keyOf(item: ChatItem): string | undefined {
  switch (item._tag) {
    case 'owner':
      return item.id ?? item.opId
    case 'juno':
      return item.id
    case 'card':
      return item.card.id
    case 'note':
      return item.id
    case 'groupLabel':
      return item.id
    default:
      return undefined
  }
}

const indexOf = (items: ReadonlyArray<ChatItem>, anchor: string) =>
  items.findIndex((item) => keyOf(item) === anchor || (item._tag === 'owner' && item.opId === anchor))

/** The slice of `items` a window asks for, with whether more lies on each side. */
export type ChatWindow = typeof ChatWindowSchema.Type

export function windowOf(items: ReadonlyArray<ChatItem>, window: ChatWindow) {
  const slice = (start: number, end: number) => {
    const from = Math.max(0, start)
    const to = Math.min(items.length, end)
    return { items: items.slice(from, to), moreAbove: from > 0, moreBelow: to < items.length }
  }
  const latest = (limit: number) => slice(items.length - limit, items.length)
  switch (window._tag) {
    case 'latest':
      return latest(window.limit)
    case 'unread': {
      const divider = items.findIndex((item) => item._tag === 'newDivider')
      // A few rows of context above the divider, the rest below it.
      return divider < 0 ? latest(window.limit) : slice(divider - Math.floor(window.limit / 4), divider - Math.floor(window.limit / 4) + window.limit)
    }
    case 'around': {
      const at = indexOf(items, window.anchor)
      return at < 0 ? latest(window.limit) : slice(at - window.before, at - window.before + window.limit)
    }
    case 'above': {
      const at = indexOf(items, window.anchor)
      return at < 0 ? slice(0, 0) : slice(at - window.limit, at)
    }
    case 'below': {
      const at = indexOf(items, window.anchor)
      return at < 0 ? slice(items.length, items.length) : slice(at + 1, at + 1 + window.limit)
    }
  }
}

/** The sidebar's Juno row, the nav count and the home's Ask Juno field. */
export function chatSummary(items: ReadonlyArray<ChatItem>, active: ReadonlyArray<Job>): ChatSummary {
  const unread = items.filter((item) => (item._tag === 'juno' || item._tag === 'card') && item.unread).length
  const newest = active.toSorted((a, b) => b.stepAt - a.stepAt)[0]
  return {
    unread,
    busy: active.length > 0,
    ...(newest?.state ? { jobLine: `${newest.place} · ${newest.state}` } : {}),
  }
}

/** The `at` of the item `through` names, a Juno bubble or an archive message, for the read mark. */
export function readMarkOf(items: ReadonlyArray<ChatItem>, through: string): number | undefined {
  const item = items[indexOf(items, through)]
  if (item === undefined) return undefined
  if (item._tag === 'juno' || item._tag === 'owner') return item.at
  return undefined
}
