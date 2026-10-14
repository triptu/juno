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
import type { FileView, MessageView, Person, ReactionView, ThreadLink } from '@juno/contract'
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
} from '@juno/domain'
import { emojiUnicode, messageBody, splitEmojiName, type MessageBody, type MessageContent } from '@juno/richtext'
import { StoreReader, type SqlClient, type SqlError } from '@juno/store'
import type { ListRun } from '../protocol/live'
import { personFrom, userName, type UserRow } from '../topicRows'
import { reactionsStatement, threadTitlesStatement, windowStatements, type WindowMessage, type WindowTarget } from './window'

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
    let rows: ReadonlyArray<WindowMessage>
    if (statements.length === 1) {
      rows = shown
    } else {
      const newer = yield* sql.unsafe<WindowMessage>(statements[1]!.sql, statements[1]!.params)
      rows = [...shown, ...newer.slice(0, Math.max(0, range.limit - shown.length))]
    }

    const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
    const selfId = team[0]?.self_user_id ?? undefined
    if (cache.selfId !== selfId) {
      cache.selfId = selfId
      cache.rows = new Map()
      cache.bodies = new Map()
    }

    // Reactions, in Slack's order.
    const reactions = new Map<string, Array<{ readonly name: string; readonly count: number; readonly me: 0 | 1 }>>()
    if (rows.length > 0) {
      const statement = reactionsStatement(target.channel, rows.map((row) => row.ts))
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
      const linked = rows.filter((row) => row.reply_count > 0 && row.thread_ts === row.ts).map((row) => threadTopicId(target.channel as ChannelId, row.ts as Ts))
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
    const me = selfId === undefined ? undefined : { userId: selfId as UserId }
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
      beforeWindow === undefined ? undefined : { senderId: beforeWindow.user_id, body: { blocks: [] }, isThreadRoot: target.kind === 'thread' && beforeWindow.ts === target.threadTs }
    for (const row of rows) {
      const body = bodies.get(row.ts)!
      const isRoot = target.kind === 'thread' && row.ts === target.threadTs
      const group: GroupMessage = { senderId: row.user_id, body: body.body, isThreadRoot: isRoot }
      const groupStart = startsGroup(previous, group)
      previous = group
      const own = reactions.get(row.ts) ?? []
      const topicId = target.kind === 'main' && row.reply_count > 0 && row.thread_ts === row.ts ? threadTopicId(target.channel as ChannelId, row.ts as Ts) : undefined
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
        ...own.flatMap((r) => [r.name, r.count, r.me]),
      ].join('\u0001')
      const held = cache.rows.get(row.ts)
      let view: MessageView
      if (held !== undefined && held.key === key) {
        view = held.row
      } else {
        const thread = topicId === undefined ? undefined : threadLink(topicId, row, title, target.channel, conversation)
        view = shapeRow(row, body, { groupStart, isRoot, selfId, reactions: own, thread, cache })
      }
      nextRows.set(row.ts, { key, row: view })
      out.push(view)
      if (view.senderId !== undefined && !people.has(view.senderId)) {
        const person = personFrom(view.senderId, cache.users.get(view.senderId), cache.people.get(view.senderId))
        people.set(view.senderId, person)
      }
    }
    cache.rows = nextRows
    cache.people = people
    return { rows: out, total: out.length, refs: { people: [...people.values()] } }
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
  const resolved = resolveTitle(topic)
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
    at: tsToMillis(row.ts as Ts),
    kind,
    ...(row.user_id === null || kind === 'unloaded' ? {} : { senderId: row.user_id }),
    fromMe: input.selfId !== undefined && row.user_id === input.selfId,
    body: body.body,
    edited: row.edited_ts !== null && kind === 'message',
    groupStart: input.groupStart,
    mentionsMe: body.mentionsMe,
    broadcast: row.subtype === 'thread_broadcast',
    root: input.isRoot,
    reactions: kind === 'message' ? reactions : [],
    files: kind === 'message' ? filesOf(row) : [],
    ...(input.thread === undefined ? {} : { thread: input.thread }),
  }
  return { ...fields, rev: hashId(JSON.stringify(fields)) } as MessageView
}

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
    out.push({
      id: file.id,
      name: file.title || file.name || file.id,
      kind,
      ...(file.mimetype === undefined ? {} : { mimetype: file.mimetype }),
      ...(file.size === undefined ? {} : { size: file.size }),
      ...(file.original_w === undefined || file.original_h === undefined ? {} : { width: file.original_w, height: file.original_h }),
      ...(thumb === undefined ? {} : { thumb }),
    })
  }
  return out
}
