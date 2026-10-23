/**
 * `pnpm notif:replay run`: every notification candidate of the last N days,
 * decided by the new pipeline as of its own time. The store is a copy; the
 * readings go to OpenRouter and are cached by their input under `--out`.
 */
import { defaultModelPrefs, makePiAiProvider, notificationReading, openRouterModels, type AiProviderShape, type NotificationReadingInput } from '@juno/ai'
import {
  ChannelId, UserId, channelLabel, decideNotification, isDm, localTime, messageMentionsMe, messageMentionsMeDirectly, millisToTs, tsToMillis,
  type ConversationKind, type Instruction, type Me, type NotificationSettings, type Reading,
} from '@juno/domain'
import { readConversation, readingInput, readSettings, type Candidate } from '@juno/notifications'
import { messageBody, readableText } from '@juno/richtext'
import { Store, StoreWriter, workspacePathsFromDir } from '@juno/store'
import { Effect } from 'effect'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flags, readJson, required, writeJson, type Kind, type Replay, type ReplayItem, type ReplayReading, type ShownMessage, type Step } from './model'

const DAY = 86_400_000
/** Message subtypes a person wrote. Joins, topic changes and the like never notify. */
const WRITTEN = new Set([null, 'thread_broadcast', 'bot_message', 'file_share', 'me_message'])
/** The replay waits longer than the app's 2 s so slow answers are still measured; the report counts them. */
const REPLAY_TIMEOUT_MILLIS = 20_000
const READING_MILLIS = 2000

interface MessageRow {
  readonly channel: string
  readonly ts: string
  readonly thread_ts: string | null
  readonly user_id: string | null
  readonly subtype: string | null
  readonly text: string
  readonly blocks_json: string | null
  readonly attachments_json: string | null
  readonly files_json: string | null
  readonly kind: ConversationKind
  readonly name: string | null
  readonly dm_user: string | null
  readonly member_ids_json: string | null
  readonly ignored: number
  readonly sender_name: string | null
  readonly bot_name: string | null
  readonly subscribed: number | null
  readonly started: number
}

const parse = <A>(json: string | null): A | undefined => {
  if (json === null) return undefined
  try {
    return JSON.parse(json) as A
  } catch {
    return undefined
  }
}

function defaultWorkspace(): string {
  const root = join(homedir(), 'Library/Application Support/Juno/workspaces')
  const found = existsSync(root) ? readdirSync(root).filter((name) => existsSync(join(root, name, 'user.db'))) : []
  if (found.length !== 1) throw new Error(`Found ${found.length} workspaces under ${root}. Pass --data <workspace folder>.`)
  return join(root, found[0]!)
}

/** Copies the workspace's two databases, with their WAL files, into `into`. The real folder is only read. */
function copyStore(from: string, into: string) {
  rmSync(into, { recursive: true, force: true })
  mkdirSync(into, { recursive: true })
  for (const db of ['user.db', 'cache.db']) {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(join(from, db + suffix))) copyFileSync(join(from, db + suffix), join(into, db + suffix))
    }
  }
}

function loadKey(envFile: string | undefined): string {
  const repo = fileURLToPath(new URL('../..', import.meta.url))
  for (const file of [envFile, join(repo, '.env'), mainCheckoutEnv()]) {
    if (file === undefined || process.env.OPENROUTER_API_KEY) continue
    try {
      process.loadEnvFile(file)
    } catch {
      // Not there: try the next.
    }
  }
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY is not set and no .env has it. Pass --env <file>.')
  return key
}

/** The main checkout's `.env`, for a worktree: `git rev-parse --git-common-dir` is its `.git`. */
function mainCheckoutEnv(): string | undefined {
  const repo = fileURLToPath(new URL('../..', import.meta.url))
  const gitFile = join(repo, '.git')
  if (!existsSync(gitFile)) return undefined
  const text = readFileSync(gitFile, 'utf8')
  const match = /^gitdir: (.+)\/\.git\/worktrees\//m.exec(text)
  return match === null ? undefined : join(match[1]!, '.env')
}

interface Cached {
  readonly reading: Omit<ReplayReading, 'latencyMillis'> | null
  readonly latencyMillis: number
  readonly costUsd: number
}

interface Pending {
  readonly candidate: Candidate
  readonly at: number
  readonly item: Omit<ReplayItem, 'decision' | 'reading' | 'early'>
  readonly early?: Step
  readonly input?: NotificationReadingInput
}

type Sql = StoreWriter['Service']

/** Who the owner is, names for mentions, the old check's decisions and the settings, from the copy. */
const openCopy = (sql: Sql, instructions: ReadonlyArray<Instruction> | undefined) =>
  Effect.gen(function* () {
    const self = (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id
    if (self == null) return yield* Effect.die(new Error('The copied store has no signed-in user.'))
    const me: Me = parse<Me>((yield* sql<{ value_json: string }>`SELECT value_json FROM sync_state WHERE key = 'me'`)[0]?.value_json ?? null) ?? { userId: UserId.make(self) }
    const users = new Map((yield* sql<{ id: string; name: string | null }>`SELECT id, COALESCE(NULLIF(display_name, ''), NULLIF(real_name, ''), name) AS name FROM users`).map((row) => [row.id, row.name ?? row.id]))
    const groups = new Map((yield* sql<{ id: string; handle: string }>`SELECT id, handle FROM usergroups`).map((row) => [row.id, { handle: row.handle }]))
    // The old check's decisions, then a clean log: the burst rule is played from the replay's own banners.
    const old = new Map((yield* sql<{ channel: string; ts: string; outcome: string; reason: string | null }>`SELECT channel, ts, outcome, reason FROM notification_log`)
      .map((row) => [`${row.channel}:${row.ts}`, { outcome: row.outcome === 'notify' || row.outcome === 'now' ? 'notify' as const : 'stay' as const, reason: row.reason ?? '' }]))
    yield* sql`DELETE FROM notification_log`
    const stored = yield* readSettings
    const settings: NotificationSettings = instructions === undefined ? stored.settings : { ...stored.settings, instructions }
    return { self, me, users, lookups: { user: (id: string) => users.get(id), usergroup: (id: string) => groups.get(id) }, old, settings, aiAssist: stored.aiAssist }
  })
type Copy = Effect.Success<ReturnType<typeof openCopy>>

const candidateRows = (sql: Sql, self: string, from: number) =>
  sql<MessageRow>`SELECT m.channel, m.ts, m.thread_ts, m.user_id, m.subtype, m.text, m.blocks_json, m.attachments_json, m.files_json, m.bot_name,
      c.kind, c.name, c.user_id AS dm_user, c.member_ids_json, ig.channel IS NOT NULL AS ignored,
      COALESCE(NULLIF(u.display_name, ''), NULLIF(u.real_name, ''), u.name) AS sender_name, s.subscribed, st.root_ts IS NOT NULL AS started
    FROM messages m JOIN conversations c ON c.id = m.channel
    LEFT JOIN ignored_channels ig ON ig.channel = m.channel
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN thread_subs s ON s.channel = m.channel AND s.thread_ts = m.thread_ts
    LEFT JOIN started_threads st ON st.channel = m.channel AND st.root_ts = m.thread_ts
    WHERE m.ts >= ${millisToTs(from)} AND m.deleted = 0 AND (m.user_id IS NULL OR m.user_id <> ${self})
    ORDER BY m.ts`

/** The candidate a message makes, as the engine's frame handler builds it, or undefined when it is not one. */
function toCandidate(copy: Copy, row: MessageRow): Candidate | undefined {
  const { self, me, users, lookups, settings } = copy
  if (!WRITTEN.has(row.subtype) || (row.kind === 'im' && row.dm_user === self)) return undefined
  const body = messageBody({
    text: row.text,
    ...(parse(row.blocks_json) === undefined ? {} : { blocks: parse(row.blocks_json) }),
    ...(parse(row.attachments_json) === undefined ? {} : { attachments: parse(row.attachments_json) }),
    ...(parse(row.files_json) === undefined ? {} : { files: parse(row.files_json) }),
  } as never, lookups)
  const mentionsMe = messageMentionsMe(body, me)
  const reply = row.thread_ts !== null && row.thread_ts !== row.ts
  const topicId = reply ? `t:${row.channel}:${row.thread_ts}` : `m:${row.channel}`
  const sender = row.user_id ?? ''
  const always = settings.channels[row.channel] === 'always' || settings.people[sender] === 'always' || settings.threads?.[topicId] === 'always'
  // The candidates, as the engine's frame handler takes them: DMs and group DMs, mentions, replies in threads the owner follows or started, and Always.
  if (!isDm(row.kind) && !mentionsMe && !(reply && (row.subscribed === 1 || row.started === 1)) && !always) return undefined
  const memberNames = row.kind === 'mpim' ? (parse<string[]>(row.member_ids_json) ?? []).filter((id) => id !== self).map((id) => users.get(id) ?? id) : []
  const name = row.kind === 'im' ? users.get(row.dm_user ?? '') ?? row.name ?? row.channel
    : row.kind === 'mpim' ? channelLabel({ kind: 'mpim', name: row.name ?? row.channel, memberNames }) : row.name ?? row.channel
  const senderName = row.sender_name ?? row.bot_name ?? undefined
  // The other people it names, found as the engine's frame handler finds them.
  const mentioned = new Set([...`${row.text} ${row.blocks_json ?? ''}`.matchAll(/<@([UW][A-Z0-9]+)|"user_id":"([UW][A-Z0-9]+)"/g)].map((m) => (m[1] ?? m[2])!))
  const mentionsOthers = [...mentioned].filter((id) => id !== self && id !== sender).flatMap((id) => users.get(id) ?? [])
  return {
    channel: { id: ChannelId.make(row.channel), kind: row.kind, name, ignored: row.ignored === 1 },
    senderId: UserId.make(sender),
    ...(senderName === undefined ? {} : { senderName }),
    mentionsMe, mentionsMeDirectly: mentionsMe && messageMentionsMeDirectly(body, me), mentionsOthers,
    ts: row.ts, topicId, text: readableText(body),
  }
}

/** The facts as of the message's own time, the decision before the reading, and the reading's input when it gets that far. */
const prepare = (sql: Sql, copy: Copy, candidate: Candidate) =>
  Effect.gen(function* () {
    const at = tsToMillis(candidate.ts as never)
    const conversation = yield* readConversation(sql, copy.self, candidate, at)
    const facts = conversation.facts
    const first = decideNotification({ ...candidate, facts, at: localTime(at) }, copy.settings, { aiAssist: copy.aiAssist, userName: () => candidate.senderName })
    // The reading is asked whenever the message gets past the closer, so the report can sweep the live window too.
    const reaches = 'needsReading' in first || first.decidedBy === 'live'
    const exchanges = reaches ? (yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.channel
        WHERE c.kind = 'im' AND c.user_id = ${candidate.senderId} AND m.ts >= ${millisToTs(at - 30 * DAY)} AND m.ts < ${candidate.ts} AND m.deleted = 0`)[0]?.n ?? 0 : 0
    const readable = (text: string) => readableText(messageBody({ text }, copy.lookups))
    const shown = (message: { sender: string; text: string; at: string; fromMe?: boolean }): ShownMessage =>
      ({ sender: message.fromMe === true ? 'You' : message.sender, text: readable(message.text), at: Date.parse(message.at), fromMe: message.fromMe === true })
    const { kind: channelKind, id: channel } = candidate.channel
    const kind: Kind = channelKind === 'im' ? 'dm' : channelKind === 'mpim' ? 'group DM' : candidate.topicId.startsWith('t:') ? 'thread' : 'channel'
    const old = copy.old.get(`${channel}:${candidate.ts}`)
    return {
      candidate, at,
      item: {
        id: `${channel}:${candidate.ts}`, at, topicId: candidate.topicId, kind, where: channelLabel(candidate.channel), sender: candidate.senderName ?? 'Someone',
        text: candidate.text, mentionsMe: candidate.mentionsMe, mentionsMeDirectly: candidate.mentionsMeDirectly === true, facts,
        ...(conversation.threadRoot === undefined ? {} : { threadRoot: shown(conversation.threadRoot) }),
        before: conversation.before.map(shown),
        ...(old === undefined ? {} : { old }),
      },
      ...(reaches ? {} : { early: { outcome: first.outcome, decidedBy: first.decidedBy, reason: first.reason } }),
      ...(reaches ? { input: readingInput({ ...candidate, facts }, conversation, copy.settings.instructions ?? [], exchanges, at) } : {}),
    } satisfies Pending
  })

interface Reader {
  readonly ai: AiProviderShape
  readonly model: string
  readonly cacheDir: string
  readonly concurrency: number
}

/** The readings, by item id, cached on disk by their input. A failure is not cached, so a rerun asks again. */
const readAll = (pending: ReadonlyArray<Pending>, { ai, model, cacheDir, concurrency }: Reader) =>
  Effect.gen(function* () {
    const task = { ...notificationReading, timeoutMillis: REPLAY_TIMEOUT_MILLIS }
    const counts = { calls: 0, cached: 0, cost: 0 }
    const toRead = pending.filter((entry) => entry.input !== undefined)
    const readings = yield* Effect.forEach(toRead, (entry) => Effect.gen(function* () {
      const key = createHash('sha256').update(JSON.stringify({ model, task: task.name, version: task.version, input: entry.input })).digest('hex')
      const file = join(cacheDir, `${key}.json`)
      if (existsSync(file)) {
        counts.cached++
        return [entry.item.id, readJson<Cached>(file)] as const
      }
      const answer = yield* ai.decide(task, entry.input!)
      counts.cost += answer.meta.costUsd ?? 0
      const value: Cached = answer._tag === 'Decided'
        ? { reading: { ...answer.value, instruction: answer.value.instruction ?? undefined } as never, latencyMillis: answer.meta.latencyMillis, costUsd: answer.meta.costUsd ?? 0 }
        : { reading: null, latencyMillis: answer.meta.latencyMillis, costUsd: answer.meta.costUsd ?? 0 }
      if (value.reading !== null) writeFileSync(file, JSON.stringify(value))
      if (++counts.calls % 50 === 0) console.log(`  ${counts.calls} asked`)
      return [entry.item.id, value] as const
    }), { concurrency })
    return { byId: new Map(readings), ...counts }
  })

/** The real decision for each message in time order, with the burst rule played from the replay's own banners. */
function decideInOrder(pending: ReadonlyArray<Pending>, byId: ReadonlyMap<string, Cached>, copy: Copy): ReplayItem[] {
  const lastBanner = new Map<string, number>()
  return pending.map((entry) => {
    const got = byId.get(entry.item.id)
    const reading: ReplayReading | 'failed' | undefined = got === undefined ? undefined
      : got.reading === null ? 'failed' : { ...stripUndefined(got.reading), latencyMillis: got.latencyMillis }
    const last = lastBanner.get(entry.candidate.topicId)
    const facts = { ...entry.item.facts, ...(last === undefined ? {} : { bannerSecondsAgo: (entry.at - last) / 1000 }) }
    const decided = decideNotification({ ...entry.candidate, facts, at: localTime(entry.at) }, copy.settings,
      { aiAssist: copy.aiAssist, userName: () => entry.candidate.senderName }, reading as Reading | 'failed' | undefined)
    if ('needsReading' in decided) throw new Error(`No reading for ${entry.item.id}`)
    if (decided.outcome === 'notify') lastBanner.set(entry.candidate.topicId, entry.at)
    return {
      ...entry.item,
      ...(entry.early === undefined ? {} : { early: entry.early }),
      ...(reading === undefined ? {} : { reading }),
      decision: { outcome: decided.outcome, decidedBy: decided.decidedBy, reason: decided.reason },
    }
  })
}

export async function run(argv: ReadonlyArray<string>) {
  const options = flags(argv)
  const out = resolve(required(options, 'out'))
  const days = Number(options.days ?? 21)
  const data = resolve(options.data ?? defaultWorkspace())
  if (out.startsWith(data)) throw new Error('--out must be outside the app data folder.')
  const instructions = options.instructions === undefined ? undefined : readJson<ReadonlyArray<Instruction>>(resolve(options.instructions))
  const model = defaultModelPrefs.classifier
  const reader: Reader = {
    ai: makePiAiProvider(Effect.succeed({ apiKey: loadKey(options.env), models: { classifier: model } }), openRouterModels()),
    model, cacheDir: join(out, 'readings'), concurrency: Number(options.concurrency ?? 4),
  }
  const storeDir = join(out, 'store')
  mkdirSync(reader.cacheDir, { recursive: true })
  copyStore(data, storeDir)
  const started = Date.now()
  const to = Date.now()
  const from = to - days * DAY

  const program = Effect.gen(function* () {
    const sql = yield* StoreWriter
    const copy = yield* openCopy(sql, instructions)
    const pending: Pending[] = []
    for (const row of yield* candidateRows(sql, copy.self, from)) {
      const candidate = toCandidate(copy, row)
      if (candidate !== undefined) pending.push(yield* prepare(sql, copy, candidate))
    }
    console.log(`${pending.length} candidates in ${days} days, ${pending.filter((entry) => entry.input !== undefined).length} reach the reading.`)
    const { byId, calls, cached, cost } = yield* readAll(pending, reader)
    const items = decideInOrder(pending, byId, copy)
    const replay: Replay = { createdAt: new Date().toISOString(), days, from, to, instructions: copy.settings.instructions ?? [], model, items }
    writeJson(join(out, 'replay.json'), replay)
    const slow = items.filter((item) => typeof item.reading === 'object' && item.reading.latencyMillis > READING_MILLIS).length
    const failed = items.filter((item) => item.reading === 'failed').length
    console.log(`${calls} calls, ${cached} from the cache, $${cost.toFixed(4)}, ${Math.round((Date.now() - started) / 1000)} s.`)
    console.log(`${failed} readings failed; ${slow} took over ${READING_MILLIS / 1000} s, which the app would have read as "couldn't read this in time".`)
    console.log(`${items.filter((item) => item.old !== undefined).length} messages have an old decision. Wrote ${join(out, 'replay.json')}.`)
  })

  await Effect.runPromise(program.pipe(Effect.provide(Store.layer(workspacePathsFromDir(storeDir)))))
}

const stripUndefined = <A extends object>(value: A): A => JSON.parse(JSON.stringify(value)) as A
