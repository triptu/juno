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
 * Cards come with the actions (WP15) and notes with the pin events; neither
 * is listed yet.
 */
import type {
  BubbleId,
  ChatItem,
  ChatMessageId,
  ChatSummary,
  ChatWindow as ChatWindowSchema,
  Ending,
  GroupPosition,
  JobId,
  OpId,
  Origin,
  Quote,
  Reaction,
  ReplyTarget,
  RunId,
} from '@juno/agent-contract'
import type { Job } from '../jobs/jobs'
import { ownerOpOf } from '../router/input'
import type { RunState } from '../router/events'
import { parseOutput } from '../router/output'
import type { Store } from '../store/store'

const GROUP_GAP_MS = 2 * 60_000
const PREVIEW_CHARS = 120

export interface ChatSource {
  readonly store: Store
  readonly live: RunState | undefined
  /** When a bubble was first shown; `fallback` is stored for a bubble not seen before. */
  readonly seen: (bubbleId: string, fallback: number) => number
  readonly jobs: ReadonlyArray<Job>
  /** Juno items at or before this time are read. */
  readonly readAt: number
  /** Why accepted messages wait, if they do. */
  readonly waiting: 'network' | 'resume' | undefined
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

/** Every item in the chat, oldest first. */
export function chatItems(source: ChatSource): ReadonlyArray<ChatItem> {
  const { store } = source
  const ops = store.db
    .prepare("SELECT seq, op_id AS opId, kind, text, data, at, state FROM inbox WHERE kind IN ('send', 'steer', 'retry') ORDER BY seq")
    .all() as unknown as ReadonlyArray<OpRow>
  // A retry stands for the message it resends.
  const original = new Map<string, string>()
  for (const op of ops) {
    if (op.kind !== 'retry') continue
    const of = parse<{ retryOf?: string }>(op.data)?.retryOf
    if (of !== undefined) original.set(op.opId, original.get(of) ?? of)
  }
  const ownerOp = (opId: string) => original.get(opId) ?? opId
  const opText = new Map(ops.map((op) => [op.opId, op.text]))

  const archiveIds = new Map(
    (store.db.prepare("SELECT origin_op AS opId, min(id) AS id FROM messages WHERE kind = 'user' AND origin_op IS NOT NULL GROUP BY origin_op").all() as Array<{
      opId: string
      id: number
    }>).map((row) => [row.opId, String(row.id) as ChatMessageId]),
  )

  const reactions = new Map<string, Reaction[]>()
  const reactionRows = store.db
    .prepare(
      `SELECT target_kind AS kind, target_id AS id, by, emoji FROM reactions r
       WHERE seq = (SELECT max(seq) FROM reactions WHERE target_kind = r.target_kind AND target_id = r.target_id AND by = r.by)
       ORDER BY seq`,
    )
    .all() as Array<{ kind: string; id: string; by: 'owner' | 'juno'; emoji: string | null }>
  for (const row of reactionRows) {
    if (row.emoji === null) continue
    const key = `${row.kind}:${row.kind === 'owner' ? ownerOp(row.id) : row.id}`
    reactions.set(key, [...(reactions.get(key) ?? []), { by: row.by, emoji: row.emoji as Reaction['emoji'] }])
  }
  const reactionsOf = (kind: string, id: string) => reactions.get(`${kind}:${id}`) ?? []

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
        const text = bubbleTexts.get(target.id)
        return text === undefined ? { target, preview: '', removed: true } : { target, preview: firstLine(text) }
      }
      case 'card':
        return { target, preview: '' }
    }
  }

  const entries: Entry[] = []

  // Juno's side first, so an owner reply can quote any bubble.
  const runs = store.db
    .prepare('SELECT id, op_id AS opId, origin, started_at AS startedAt, ended_at AS endedAt, ending FROM runs ORDER BY started_at, id')
    .all() as unknown as ReadonlyArray<RunRow>
  const archived = new Map<string, Array<{ text: string; entry: string; at: number }>>()
  const juno = store.db
    .prepare(
      `SELECT run_inputs.run_id AS runId, messages.text, messages.incarnation || '/' || messages.entry_id AS entry, messages.at
       FROM messages JOIN run_inputs ON run_inputs.op_id = messages.origin_op
       WHERE messages.kind = 'juno' AND messages.redacted_gen IS NULL ORDER BY messages.id`,
    )
    .all() as Array<{ runId: string; text: string; entry: string; at: number }>
  for (const row of juno) archived.set(row.runId, [...(archived.get(row.runId) ?? []), row])

  const junoEntries: Entry[] = []
  for (const run of runs) {
    const live = source.live?.runId === run.id ? source.live : undefined
    const origin = originOf(run, source.jobs)
    const originKey = origin._tag === 'job' ? `job:${origin.jobs.map((j) => j.jobId).join(',')}` : origin._tag
    let bubbles: ReadonlyArray<{ id: string; text: string; replyTo?: string; at: number }>
    if (live !== undefined) {
      bubbles = live.bubbles.map((b) => ({ ...b, at: source.seen(b.id, Date.now()) }))
    } else {
      bubbles = archivedBubbles(store, run.id, archived.get(run.id) ?? [], run.startedAt).map((b) => ({ ...b, at: source.seen(b.id, b.at) }))
    }
    if (bubbles.length > 0 && origin._tag !== 'owner') {
      junoEntries.push({ by: 'line', at: bubbles[0]!.at, item: { _tag: 'groupLabel', id: `label:${run.id}`, origin, text: labelOf(origin, source.jobs) } })
    }
    for (const bubble of bubbles) {
      bubbleTexts.set(bubble.id, bubble.text)
      const replyTo = bubble.replyTo === undefined ? undefined : ({ _tag: 'owner', opId: ownerOp(bubble.replyTo) as OpId } as const)
      junoEntries.push({
        by: 'juno',
        at: bubble.at,
        originKey,
        item: {
          _tag: 'juno',
          id: bubble.id as BubbleId,
          runId: run.id as RunId,
          body: [{ _tag: 'text', text: bubble.text }],
          at: bubble.at,
          origin,
          ...(replyTo ? { replyTo: quoteOf(replyTo) } : {}),
          reactions: reactionsOf('bubble', bubble.id),
          unread: bubble.at > source.readAt,
        },
      })
    }
    const ending = parse<Ending>(run.ending)
    if (ending !== undefined && ending._tag !== 'complete') {
      junoEntries.push({ by: 'line', at: run.endedAt ?? run.startedAt, item: { _tag: 'ending', runId: run.id as RunId, ending } })
    }
    if (live !== undefined) {
      junoEntries.push({ by: 'line', at: Number.POSITIVE_INFINITY, item: { _tag: 'status', runId: run.id as RunId, ...(live.status.text === undefined ? {} : { text: live.status.text }) } })
    }
  }

  for (const op of ops) {
    if (op.kind === 'retry') continue
    const data = parse<{ replyTo?: ReplyTarget }>(op.data)
    const id = archiveIds.get(op.opId)
    entries.push({
      by: 'owner',
      at: op.at,
      item: {
        _tag: 'owner',
        opId: op.opId as OpId,
        ...(id === undefined ? {} : { id }),
        text: op.text,
        at: op.at,
        delivery: op.state === 'accepted' && source.waiting !== undefined ? { _tag: 'waiting', for: source.waiting } : { _tag: 'sent' },
        ...(data?.replyTo === undefined ? {} : { replyTo: quoteOf(data.replyTo) }),
        reactions: reactionsOf('owner', op.opId),
      },
    })
  }
  entries.push(...junoEntries)
  // Stable: at the same time an owner message comes before what answers it.
  entries.sort((a, b) => a.at - b.at)
  return layout(entries, source)
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
  return output.bubbles.map((bubble, n) => {
    const replyTo = bubble.replyTo === undefined ? undefined : ownerOpOf(store, bubble.replyTo)
    return { id: `${runId}:${n}`, text: bubble.text, at: times[n] ?? entries.at(-1)?.at ?? startedAt, ...(replyTo ? { replyTo } : {}) }
  })
}

const reportJob = (opId: string) => /^report:([^:]+):/.exec(opId)?.[1]

/** What started a run, as the chat labels it. Schedules come with WP19; until then a wake shows as Juno's own. */
function originOf(run: RunRow, jobs: ReadonlyArray<Job>): Origin {
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
function layout(entries: ReadonlyArray<Entry>, source: ChatSource): ReadonlyArray<ChatItem> {
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
      items[index] = { ...items[index], group: position } as ChatItem
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
    items.push({ ...entry.item, group: 'single' } as ChatItem)
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
