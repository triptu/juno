/**
 * The `messages.list` query: one topic's window of messages, shaped as
 * `MessageView`s, with the senders as `refs` (architecture 7, performance
 * 6).
 *
 * A run reads the window through its index (`window.ts`), the reactions of
 * those messages, and for Main the overlay titles of the threads it links
 * to. Then it shapes the rows. Shaping is the expensive part, so each
 * subscription keeps a `MessageCache`:
 *
 * - by message ts, the row it built and the inputs it built it from. A
 *   message whose stored version, reactions, thread link and group start are
 *   unchanged keeps its row object and is not parsed again;
 * - the names of users and channels and the custom emoji the bodies looked
 *   up. Bodies are parsed with lookups from these maps; ids a body asked for
 *   that the maps lack are read in one statement and only those bodies are
 *   parsed again. The handler drops the maps when `users`, `conversations`
 *   or `emoji` change, which rebuilds every row once.
 *
 * `rev` is a hash of the shaped row, so a rebuilt row that shows the same
 * thing keeps its `rev` and does not travel. The sender is a ref: a new
 * name or photo changes no row.
 */
import { Effect } from 'effect'
import { pendingRowId, type FileView, type MessageView, type Person, type ReactionView, type ThreadLink } from '@juno/contract'
import {
  hashId,
  messageMentionsMe,
  resolveTitle,
  startsGroup,
  threadLinkLabel,
  threadTopicId,
  tsToMillis,
  type ChannelId,
  type ChannelInfo,
  type GroupMessage,
  type Topic,
  type Ts,
  type UserId,
  type Me,
} from '@juno/domain'
import { emojiUnicode, messageBody, plainText, splitEmojiName, type Lookups, type MessageBody, type MessageContent } from '@juno/richtext'
import { syncState, StoreReader, type SqlClient, type SqlError } from '@juno/store'
import type { PendingFile } from '@juno/sync'
import { windowCovered } from './coverage'
import { uploadsUrl } from '../staging'
import type { ListRun } from '../protocol/live'
import { personFrom, userName, type UserRow } from '../topicRows'
import { actionsStatement, hiddenCopiesStatement, pendingStatement, reactionsStatement, threadTitlesStatement, windowStatements, type WindowMessage, type WindowTarget } from './window'

export interface MessageRange {
  readonly anchor?: string | undefined
  readonly before: number
  readonly limit: number
}

interface CachedRow {
  /** Everything the row was built from, joined; equal inputs mean an equal row. */
  readonly key: string
  readonly row: MessageView
}

interface CachedBody {
  readonly version: number
  readonly epoch: number
  readonly body: MessageBody
  readonly mentionsMe: boolean
}

/** What one `messages.list` subscription keeps between runs. See the module comment. */
export interface MessageCache {
  rows: Map<string, CachedRow>
  bodies: Map<string, CachedBody>
  /** Users read so far, `null` for an id with no row. */
  users: Map<string, UserRow | null>
  channels: Map<string, string | null>
  /** Custom emoji image urls, `null` for a name with no custom emoji. */
  emoji: Map<string, string | null>
  /** Bumped whenever the lookup maps are dropped; a body parsed in an older epoch is parsed again. */
  epoch: number
  people: Map<string, Person>
  selfId: string | undefined
  membership: string
}

export const makeMessageCache = (): MessageCache => ({
  rows: new Map(),
  bodies: new Map(),
  users: new Map(),
  channels: new Map(),
  emoji: new Map(),
  epoch: 0,
  people: new Map(),
  selfId: undefined,
  membership: '',
})

/** Drops the names and emoji a cache has read, after `users`, `conversations` or `emoji` changed. */
export function forgetLookups(cache: MessageCache): void {
  cache.users = new Map()
  cache.channels = new Map()
  cache.emoji = new Map()
  cache.epoch += 1
}

interface ConversationInfo {
  readonly kind: ChannelInfo['kind']
  readonly name: string | null
}

const STUB = (row: WindowMessage) => row.user_id === null && row.text === '' && row.blocks_json === null && row.deleted === 0

const parseJson = <A>(json: string | null): A | undefined => {
  if (json === null) return undefined
  try {
    return JSON.parse(json) as A
  } catch {
    return undefined
  }
}

/** The window of one topic, oldest first, with the senders as refs. */
export const listMessages = (target: WindowTarget, range: MessageRange, cache: MessageCache): Effect.Effect<ListRun<MessageView>, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const statements = windowStatements(target, range)
    // The older statement reads one extra row, the message before the window (see `windowStatements`).
    const older = yield* sql.unsafe<WindowMessage>(statements[0]!.sql, statements[0]!.params)
    const olderCount = statements.length === 1 ? range.limit : Math.min(range.before, range.limit)
    const beforeWindow = older[olderCount]
    const shown = older.slice(0, olderCount).toReversed()
    let stored: ReadonlyArray<WindowMessage>
    let atNewest = true
    if (statements.length === 1) {
      stored = shown
    } else {
      const newer = yield* sql.unsafe<WindowMessage>(statements[1]!.sql, statements[1]!.params)
      const room = Math.max(0, range.limit - shown.length)
      atNewest = newer.length <= room
      stored = [...shown, ...newer.slice(0, room)]
    }

    const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
    const selfId = team[0]?.self_user_id ?? undefined
    const me = (yield* syncState.get<Me>('me')) ?? (selfId === undefined ? undefined : { userId: selfId as UserId })
    const membership = JSON.stringify(me) ?? ''

    // Juno's own messages Slack does not hold yet come after the newest stored one (architecture 5.7).
    const pending = new Map<string, PendingRow>()
    if (atNewest) {
      const statement = pendingStatement(target)
      for (const row of yield* sql.unsafe<PendingRow>(statement.sql, statement.params)) pending.set(pendingRowId(row.client_msg_id), row)
    }
    const ownRoots = new Map<string, string>()
    const clients = [...stored.flatMap(row => row.client_msg_id === null ? [] : [row.client_msg_id]), ...[...pending.values()].map(row => row.client_msg_id)]
    if (target.kind === 'main' && clients.length > 0) {
      for (const root of yield* sql<{ client_msg_id: string; topic_id: string; root_ts: string | null }>`SELECT client_msg_id, topic_id, root_ts FROM started_threads
        WHERE channel = ${target.channel} AND client_msg_id IN ${sql.in(clients)}`) {
        ownRoots.set(root.root_ts ?? pendingRowId(root.client_msg_id), root.root_ts === null ? root.topic_id : `t:${target.channel}:${root.root_ts}`)
      }
    }
    const threadId = (row: WindowMessage) => ownRoots.get(row.ts) ?? threadTopicId(target.channel as ChannelId, row.ts as Ts)
    const withPending: ReadonlyArray<WindowMessage> = pending.size === 0 ? stored : [...stored, ...[...pending.values()].map((row) => ({ ...pendingMessage(row, selfId), ...(ownRoots.has(pendingRowId(row.client_msg_id)) ? { thread_ts: pendingRowId(row.client_msg_id) } : {}) }))]
    // A network copy of a post that shares files is hidden but not deleted (ADR 0014).
    const hiddenCopies = withPending.length === 0 ? [] : yield* sql.unsafe<{ ts: string }>(hiddenCopiesStatement(target.channel).sql, hiddenCopiesStatement(target.channel).params)
    const hidden = new Set(hiddenCopies.map((row) => row.ts))
    const listed = hidden.size === 0 ? withPending : withPending.filter((row) => !hidden.has(row.ts))

    // Juno's own edits, deletes and reactions show over the stored message until Slack has them (architecture 5.7).
    const actions = listed.length === 0 ? emptyIntents : intentsOf(yield* sql.unsafe<ActionRow>(actionsStatement(target.channel).sql, actionsStatement(target.channel).params))
    const rows = actions.size === 0 ? listed : withIntents(listed, actions, target)

    if (cache.selfId !== selfId || cache.membership !== membership) {
      cache.membership = membership
      cache.selfId = selfId
      cache.rows = new Map()
      cache.bodies = new Map()
    }

    // Reactions, in Slack's order.
    const reactions = new Map<string, Array<{ readonly name: string; readonly count: number; readonly me: 0 | 1 }>>()
    if (rows.length > 0) {
      const statement = reactionsStatement(target.channel, stored.map((row) => row.ts))
      for (const reaction of yield* sql.unsafe<{ ts: string; name: string; count: number; me: 0 | 1 }>(statement.sql, statement.params)) {
        let list = reactions.get(reaction.ts)
        if (list === undefined) reactions.set(reaction.ts, (list = []))
        list.push(reaction)
      }
    }

    // Main: the titles of the threads the window links to.
    const titles = new Map<string, { readonly manual_title: string | null; readonly ai_title: string | null }>()
    let conversation: ConversationInfo | undefined
    if (target.kind === 'main') {
      const linked = rows.filter((row) => row.thread_ts === row.ts && (row.reply_count > 0 || ownRoots.has(row.ts))).map(threadId)
      if (linked.length > 0) {
        const statement = threadTitlesStatement(linked)
        for (const title of yield* sql.unsafe<{ topic_id: string; manual_title: string | null; ai_title: string | null }>(statement.sql, statement.params)) titles.set(title.topic_id, title)
        const found = yield* sql<ConversationInfo>`SELECT kind, name FROM conversations WHERE id = ${target.channel}`
        conversation = found[0]
      }
    }

    // Senders, then bodies: parse with what the maps hold, read what they lacked, parse those again.
    const senders = new Set<string>()
    for (const row of rows) if (row.user_id !== null) senders.add(row.user_id)
    yield* readUsers(sql, cache, senders)
    const wanted = { users: new Set<string>(), channels: new Set<string>(), emoji: new Set<string>() }
    const lookups = {
      ...(selfId === undefined ? {} : { me: selfId }),
      user: (id: string) => {
        const user = cache.users.get(id)
        if (user === undefined) wanted.users.add(id)
        return user === undefined || user === null ? undefined : userName(id, user)
      },
      channel: (id: string) => {
        const name = cache.channels.get(id)
        if (name === undefined) wanted.channels.add(id)
        return name ?? undefined
      },
      emoji: (name: string) => {
        const url = cache.emoji.get(name)
        if (url === undefined) wanted.emoji.add(name)
        return url ?? undefined
      },
    }
    const parse = (row: WindowMessage): CachedBody => {
      const content: MessageContent = {
        text: row.text,
        ...(row.blocks_json === null ? {} : { blocks: parseJson<MessageContent['blocks']>(row.blocks_json) ?? [] }),
        ...(row.files_json === null ? {} : { files: parseJson<MessageContent['files']>(row.files_json) ?? [] }),
        ...(row.attachments_json === null ? {} : { attachments: parseJson<MessageContent['attachments']>(row.attachments_json) ?? [] }),
      }
      const body = row.deleted === 1 ? { blocks: [] } : messageBody(content, lookups)
      return { version: row.version, epoch: cache.epoch, body, mentionsMe: me !== undefined && messageMentionsMe(body, me) }
    }
    const bodies = new Map<string, CachedBody>()
    const parsedNow: Array<WindowMessage> = []
    for (const row of rows) {
      const held = cache.bodies.get(row.ts)
      if (held !== undefined && held.version === row.version && held.epoch === cache.epoch) {
        bodies.set(row.ts, held)
        continue
      }
      bodies.set(row.ts, parse(row))
      parsedNow.push(row)
    }
    // Emoji names in reactions are looked up too, so the second pass has them.
    for (const list of reactions.values()) for (const reaction of list) if (emojiUnicode(reaction.name) === undefined) lookups.emoji(splitEmojiName(reaction.name).name)
    if (wanted.users.size + wanted.channels.size + wanted.emoji.size > 0) {
      yield* readUsers(sql, cache, wanted.users)
      yield* readChannels(sql, cache, wanted.channels)
      yield* readEmoji(sql, cache, wanted.emoji)
      for (const row of parsedNow) bodies.set(row.ts, parse(row))
    }
    cache.bodies = bodies

    // Shape, reusing rows whose inputs are unchanged.
    const out: Array<MessageView> = []
    const nextRows = new Map<string, CachedRow>()
    const people = new Map<string, Person>()
    // Grouping starts from the message before the window, so the first row's header does not depend on where the window begins.
    let previous: GroupMessage | undefined =
      beforeWindow === undefined ? undefined : { senderId: groupSender(beforeWindow), body: { blocks: [] }, isThreadRoot: target.kind === 'thread' && beforeWindow.ts === target.threadTs }
    for (const row of rows) {
      const body = bodies.get(row.ts)!
      const isRoot = target.kind === 'thread' && row.ts === target.threadTs
      const group: GroupMessage = { senderId: groupSender(row), body: body.body, isThreadRoot: isRoot }
      const groupStart = startsGroup(previous, group)
      previous = group
      const intent = intentOf(actions, row)
      const own = intent === undefined || intent.reactions.size === 0 ? (reactions.get(row.ts) ?? []) : withReactionIntents(reactions.get(row.ts) ?? [], intent.reactions)
      const topicId = target.kind === 'main' && row.thread_ts === row.ts && (row.reply_count > 0 || ownRoots.has(row.ts)) ? threadId(row) : undefined
      const title = topicId === undefined ? undefined : titles.get(topicId)
      const key = [
        row.version,
        body.epoch,
        groupStart ? 1 : 0,
        row.reply_count,
        row.latest_reply,
        title?.manual_title,
        title?.ai_title,
        conversation?.name,
        pending.get(row.ts)?.state,
        ...own.flatMap((r) => [r.name, r.count, r.me]),
      ].join('\u0001')
      const held = cache.rows.get(row.ts)
      let view: MessageView
      if (held !== undefined && held.key === key) {
        view = held.row
      } else {
        const thread = topicId === undefined ? undefined : threadLink(topicId, row, title, target.channel, conversation, lookups)
        view = shapeRow(row, body, { groupStart, isRoot, selfId, reactions: own, thread, cache, pending: pending.get(row.ts) })
      }
      nextRows.set(row.ts, { key, row: view })
      out.push(view)
      if (view.senderId !== undefined && !people.has(view.senderId)) {
        const person = row.bot_name !== null || row.bot_icon !== null
          ? personFrom(view.senderId, { id: view.senderId, name: row.bot_name ?? row.user_id, display_name: row.bot_name, real_name: null, avatar_url: row.bot_icon ?? cache.users.get(row.user_id ?? '')?.avatar_url ?? null })
          : personFrom(view.senderId, cache.users.get(view.senderId), cache.people.get(view.senderId))
        people.set(view.senderId, person)
      }
    }
    cache.rows = nextRows
    cache.people = people
    return { rows: out, total: out.length, windowCovered: yield* windowCovered(target, stored[0]?.ts), refs: { people: [...people.values()] } }
  })

const readUsers = (sql: SqlClient.SqlClient, cache: MessageCache, ids: Iterable<string>) =>
  Effect.gen(function* () {
    const missing = [...ids].filter((id) => !cache.users.has(id))
    if (missing.length === 0) return
    for (const id of missing) cache.users.set(id, null)
    for (const user of yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url FROM users WHERE id IN ${sql.in(missing)}`) cache.users.set(user.id, user)
  })

const readChannels = (sql: SqlClient.SqlClient, cache: MessageCache, ids: Iterable<string>) =>
  Effect.gen(function* () {
    const missing = [...ids].filter((id) => !cache.channels.has(id))
    if (missing.length === 0) return
    for (const id of missing) cache.channels.set(id, null)
    for (const row of yield* sql<{ id: string; name: string | null }>`SELECT id, name FROM conversations WHERE id IN ${sql.in(missing)}`) cache.channels.set(row.id, row.name)
  })

/** Custom emoji by name, following an alias to another custom emoji (`alias:name`) up to three times. */
const readEmoji = (sql: SqlClient.SqlClient, cache: MessageCache, names: Iterable<string>) =>
  Effect.gen(function* () {
    let missing = [...names].filter((name) => !cache.emoji.has(name))
    const aliases = new Map<string, string>()
    for (let hop = 0; hop < 4 && missing.length > 0; hop++) {
      for (const name of missing) cache.emoji.set(name, null)
      const rows = yield* sql<{ name: string; url: string | null; alias_for: string | null }>`SELECT name, url, alias_for FROM emoji WHERE name IN ${sql.in(missing)}`
      const next: Array<string> = []
      for (const row of rows) {
        const target = row.alias_for ?? (row.url?.startsWith('alias:') ? row.url.slice('alias:'.length) : undefined)
        if (target !== undefined) {
          aliases.set(row.name, target)
          if (!cache.emoji.has(target)) next.push(target)
        } else if (row.url !== null) {
          cache.emoji.set(row.name, row.url)
        }
      }
      missing = next
    }
    for (const [name, target] of aliases) {
      let url = cache.emoji.get(target) ?? null
      let hops = 0
      let current = target
      while (url === null && aliases.has(current) && hops++ < 3) {
        current = aliases.get(current)!
        url = cache.emoji.get(current) ?? null
      }
      cache.emoji.set(name, url)
    }
  })

function threadLink(
  topicId: string,
  row: WindowMessage,
  title: { readonly manual_title: string | null; readonly ai_title: string | null } | undefined,
  channel: string,
  conversation: ConversationInfo | undefined,
  lookups: Lookups,
): ThreadLink {
  const topic: Topic = {
    id: topicId as Topic['id'],
    kind: 'thread',
    channel: { id: channel as ChannelId, kind: conversation?.kind ?? 'public', name: conversation?.name ?? channel },
    activity: { lastActivityTs: (row.latest_reply ?? row.ts) as Ts, messageCount: row.reply_count + 1, unreadCount: 0, mentionsMe: false, participants: [] },
    overlay: {
      ...(title?.manual_title ? { manualTitle: title.manual_title } : {}),
      ...(title?.ai_title ? { aiTitle: title.ai_title } : {}),
    },
    ...(row.deleted === 0 && row.text !== '' ? { firstMessageText: row.text } : {}),
  }
  // The root's own body was parsed with the same lookups, so the people it mentions are loaded: "@Maya fix the…", never "<@U…>".
  const resolved = resolveTitle(topic, lookups)
  return {
    id: topicId,
    replyCount: row.reply_count,
    label: threadLinkLabel(row.reply_count),
    title: resolved.text,
    titleSource: resolved.source,
    ...(row.latest_reply === null ? {} : { lastReplyAt: tsToMillis(row.latest_reply as Ts) }),
  }
}

interface ShapeInput {
  readonly groupStart: boolean
  readonly isRoot: boolean
  readonly selfId: string | undefined
  readonly reactions: ReadonlyArray<{ readonly name: string; readonly count: number; readonly me: 0 | 1 }>
  readonly thread: ThreadLink | undefined
  readonly cache: MessageCache
  readonly pending: PendingRow | undefined
}

function shapeRow(row: WindowMessage, body: CachedBody, input: ShapeInput): MessageView {
  const kind = row.deleted === 1 ? 'deleted' : STUB(row) ? 'unloaded' : 'message'
  const reactions: Array<ReactionView> = input.reactions.map((reaction) => {
    const unicode = emojiUnicode(reaction.name)
    const url = unicode === undefined ? (input.cache.emoji.get(splitEmojiName(reaction.name).name) ?? undefined) : undefined
    return {
      name: reaction.name,
      count: reaction.count,
      me: reaction.me === 1,
      ...(unicode === undefined ? {} : { unicode }),
      ...(url === undefined ? {} : { url }),
    }
  })
  const fields: Omit<MessageView, 'rev'> = {
    id: row.ts,
    ts: row.ts,
    at: input.pending === undefined ? tsToMillis(row.ts as Ts) : Number(input.pending.created_at),
    kind,
    ...(row.user_id === null || kind === 'unloaded' ? {} : { senderId: row.bot_name !== null || row.bot_icon !== null ? `bot:${row.channel}:${row.ts}` : row.user_id }),
    fromMe: input.selfId !== undefined && row.user_id === input.selfId,
    body: body.body,
    edited: row.edited_ts !== null && kind === 'message',
    groupStart: input.groupStart,
    mentionsMe: body.mentionsMe,
    broadcast: row.subtype === 'thread_broadcast',
    root: input.isRoot,
    reactions: kind === 'message' ? reactions : [],
    files: kind !== 'message' ? [] : input.pending === undefined ? filesOf(row) : pendingFiles(input.pending),
    ...(input.thread === undefined ? {} : { thread: input.thread }),
    ...(row.client_msg_id === null ? {} : { clientMsgId: row.client_msg_id }),
    ...(input.pending === undefined ? {} : { pending: input.pending.state === 'failed' ? ('failed' as const) : ('sending' as const) }),
    ...(kind === 'message' && input.selfId !== undefined && row.user_id === input.selfId ? { editText: composerText(body.body) } : {}),
  }
  return { ...fields, rev: hashId(JSON.stringify(fields)) } as MessageView
}

// Pending messages

interface PendingRow {
  readonly client_msg_id: string
  readonly channel: string
  readonly thread_ts: string | null
  readonly text: string
  readonly blocks_json: string | null
  readonly file_ids_json: string | null
  readonly created_at: string
  readonly state: 'queued' | 'sending' | 'unknown' | 'failed'
}


/** A version for content that is not stored as Slack's: below every stored version, and different for different content, so its body is parsed again when it changes. */
function contentVersion(text: string, blocksJson: string | null): number {
  let hash = 5381
  const content = `${text}\u0001${blocksJson ?? ''}`
  for (let i = 0; i < content.length; i++) hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0
  return -1 - (hash >>> 0)
}

/** A message as the edit field starts with it: the composer's text, without the names of its files. */
function composerText(body: MessageBody): string {
  return plainText({ blocks: body.blocks.filter((block) => block.kind !== 'file') })
}

// Edits, deletes and reactions not yet in Slack

interface ActionRow {
  readonly id: number
  readonly kind: 'edit' | 'delete' | 'react'
  readonly payload_json: string
}

/** What the user has asked for one message: the text of an edit, a delete, and reactions by name. */
interface Intent {
  edit?: { readonly text: string; readonly blocksJson: string | null }
  deleted: boolean
  readonly reactions: Map<string, boolean>
}

/** Intents by the message's ts and by its `client_msg_id`, for posts Slack did not have when the user acted. */
type Intents = { readonly size: number; readonly byTs: Map<string, Intent>; readonly byClientMsgId: Map<string, Intent> }

const emptyIntents: Intents = { size: 0, byTs: new Map(), byClientMsgId: new Map() }

function intentsOf(rows: ReadonlyArray<ActionRow>): Intents {
  const byTs = new Map<string, Intent>()
  const byClientMsgId = new Map<string, Intent>()
  for (const row of rows) {
    const payload = parseJson<{ ts: string | null; clientMsgId: string | null; text?: string; blocksJson?: string | null; name?: string; want?: boolean }>(row.payload_json)
    if (payload === undefined) continue
    const intent = (payload.ts !== null ? byTs.get(payload.ts) : undefined) ?? (payload.clientMsgId !== null ? byClientMsgId.get(payload.clientMsgId) : undefined) ?? { deleted: false, reactions: new Map<string, boolean>() }
    if (payload.ts !== null) byTs.set(payload.ts, intent)
    if (payload.clientMsgId !== null) byClientMsgId.set(payload.clientMsgId, intent)
    if (row.kind === 'delete') intent.deleted = true
    else if (row.kind === 'edit' && payload.text !== undefined) intent.edit = { text: payload.text, blocksJson: payload.blocksJson ?? null }
    else if (row.kind === 'react' && payload.name !== undefined) intent.reactions.set(payload.name, payload.want === true)
  }
  return { size: rows.length, byTs, byClientMsgId }
}

const intentOf = (intents: Intents, row: Pick<WindowMessage, 'ts' | 'client_msg_id'>): Intent | undefined =>
  intents.size === 0 ? undefined : (intents.byTs.get(row.ts) ?? (row.client_msg_id === null ? undefined : intents.byClientMsgId.get(row.client_msg_id)))

/**
 * The window with the intents applied: an edited message shows its new
 * text and "edited"; a deleted one goes, except a root with replies, which
 * keeps its place as deleted, as Slack shows it.
 */
function withIntents(rows: ReadonlyArray<WindowMessage>, intents: Intents, target: WindowTarget): ReadonlyArray<WindowMessage> {
  const out: Array<WindowMessage> = []
  for (const row of rows) {
    const intent = intentOf(intents, row)
    if (intent === undefined) {
      out.push(row)
    } else if (intent.deleted) {
      const keepsPlace = row.reply_count > 0 || (target.kind === 'thread' && row.ts === target.threadTs)
      if (keepsPlace) out.push({ ...row, deleted: 1, text: '', blocks_json: null, files_json: null, attachments_json: null, version: contentVersion('', 'deleted') })
    } else if (intent.edit !== undefined) {
      const { text, blocksJson } = intent.edit
      out.push({ ...row, text, blocks_json: blocksJson, edited_ts: row.edited_ts ?? row.ts, version: contentVersion(text, blocksJson) })
    } else {
      out.push(row)
    }
  }
  return out
}

/** Stored reactions with the user's own intents applied: theirs counted in or out, an emptied chip gone, a new one last. */
function withReactionIntents(
  stored: ReadonlyArray<{ readonly name: string; readonly count: number; readonly me: 0 | 1 }>,
  intents: ReadonlyMap<string, boolean>,
): ReadonlyArray<{ readonly name: string; readonly count: number; readonly me: 0 | 1 }> {
  const out: Array<{ readonly name: string; readonly count: number; readonly me: 0 | 1 }> = []
  for (const reaction of stored) {
    const want = intents.get(reaction.name)
    if (want === undefined || want === (reaction.me === 1)) out.push(reaction)
    else if (want) out.push({ name: reaction.name, count: reaction.count + 1, me: 1 })
    else if (reaction.count > 1) out.push({ name: reaction.name, count: reaction.count - 1, me: 0 })
  }
  for (const [name, want] of intents) if (want && !stored.some((reaction) => reaction.name === name)) out.push({ name, count: 1, me: 1 })
  return out
}

const groupSender = (row: WindowMessage): string | null =>
  row.bot_name !== null || row.bot_icon !== null ? JSON.stringify([row.user_id, row.bot_name, row.bot_icon]) : row.user_id

/** A pending message as the window's other rows are read, from the signed-in user, so it groups and parses like the message it becomes. */
const pendingMessage = (row: PendingRow, selfId: string | undefined): WindowMessage => ({
  channel: row.channel,
  ts: pendingRowId(row.client_msg_id),
  thread_ts: row.thread_ts,
  user_id: selfId ?? null,
  bot_name: null,
  bot_icon: null,
  subtype: null,
  text: row.text,
  blocks_json: row.blocks_json,
  files_json: null,
  attachments_json: null,
  edited_ts: null,
  deleted: 0,
  client_msg_id: row.client_msg_id,
  reply_count: 0,
  latest_reply: null,
  // An edit before the post went out rewrites the row's text, so its body is parsed again.
  version: contentVersion(row.text, row.blocks_json),
  last_event_ts: null,
})

// Files

interface SlackFile {
  readonly id?: string
  readonly name?: string | null
  readonly title?: string | null
  readonly mimetype?: string
  readonly size?: number
  readonly mode?: string
  readonly file_access?: string
  readonly original_w?: number
  readonly original_h?: number
  readonly thumb_360?: string
  readonly thumb_360_w?: number
  readonly thumb_360_h?: number
  readonly thumb_480?: string
  readonly thumb_720?: string
  readonly thumb_1024?: string
  readonly url_private?: string
  readonly url_private_download?: string
}

/** The longest side of a thumbnail as the message list shows it, in CSS pixels. */
export const THUMB_BOX = 360

/**
 * The thumbnail Slack made for an image, as a `juno://files` url main
 * serves from the Slack session (architecture 9), with the box the view
 * reserves before the bytes arrive. The 720 variant when Slack has it, so
 * the image is sharp on a Retina screen; the box is at most `THUMB_BOX`.
 */
function thumbOf(file: SlackFile): FileView['thumb'] {
  if (file.id === undefined) return undefined
  const variant = file.thumb_720 !== undefined ? '720' : file.thumb_480 !== undefined ? '480' : file.thumb_360 !== undefined ? '360' : undefined
  const url = variant === '720' ? file.thumb_720 : variant === '480' ? file.thumb_480 : file.thumb_360
  const w = file.original_w ?? file.thumb_360_w
  const h = file.original_h ?? file.thumb_360_h
  if (variant === undefined || url === undefined || w === undefined || h === undefined || w <= 0 || h <= 0) return undefined
  const scale = Math.min(1, THUMB_BOX / Math.max(w, h))
  return {
    src: `juno://files/${encodeURIComponent(file.id)}/${variant}?url=${encodeURIComponent(url)}`,
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  }
}

/**
 * The files of a message Juno is sending, from their staged copies. An
 * image's box is worked out as `thumbOf` works out Slack's, from the same
 * pixel size, so the row does not move when the stored message replaces it.
 */
function pendingFiles(row: PendingRow): ReadonlyArray<FileView> {
  const files = parseJson<ReadonlyArray<PendingFile>>(row.file_ids_json) ?? []
  return files.map((file) => {
    const kind = fileKind(file.mimetype)
    const src = uploadsUrl(file.stagedName)
    const sized = kind === 'image' && file.width !== undefined && file.height !== undefined && !file.stagedName.endsWith('.bin')
    const scale = sized ? Math.min(1, THUMB_BOX / Math.max(file.width!, file.height!)) : 1
    return {
      id: file.id,
      name: file.name,
      kind,
      mimetype: file.mimetype,
      size: file.size,
      ...(sized
        ? {
            width: file.width!,
            height: file.height!,
            thumb: { src, width: Math.max(1, Math.round(file.width! * scale)), height: Math.max(1, Math.round(file.height! * scale)) },
            full: src,
          }
        : {}),
    }
  })
}

function fileKind(mimetype: string | undefined): FileView['kind'] {
  if (mimetype === undefined) return 'file'
  if (mimetype.startsWith('image/')) return 'image'
  if (mimetype.startsWith('video/')) return 'video'
  if (mimetype.startsWith('audio/')) return 'audio'
  if (mimetype === 'application/pdf') return 'pdf'
  return 'file'
}

function filesOf(row: WindowMessage): ReadonlyArray<FileView> {
  const files = parseJson<ReadonlyArray<SlackFile>>(row.files_json)
  if (files === undefined) return []
  const out: Array<FileView> = []
  for (const file of files) {
    if (file.id === undefined) continue
    if (file.mode === 'tombstone' || file.file_access === 'file_not_found') {
      out.push({ id: file.id, name: '', kind: 'deleted' })
      continue
    }
    const kind = fileKind(file.mimetype)
    const thumb = kind === 'image' ? thumbOf(file) : undefined
    // The viewer shows the original (Slack's `url_private`).
    const full = thumb === undefined ? undefined : file.url_private ?? file.thumb_1024
    out.push({
      id: file.id,
      name: file.title || file.name || file.id,
      kind,
      ...(file.mimetype === undefined ? {} : { mimetype: file.mimetype }),
      ...(file.size === undefined ? {} : { size: file.size }),
      ...(file.original_w === undefined || file.original_h === undefined ? {} : { width: file.original_w, height: file.original_h }),
      ...(thumb === undefined ? {} : { thumb }),
      ...(full === undefined ? {} : { full: `juno://files/${encodeURIComponent(file.id)}/full?url=${encodeURIComponent(full)}` }),
      ...(file.url_private_download === undefined ? {} : { download: file.url_private_download }),
    })
  }
  return out
}
