/**
 * The `messages.list` query: one topic's window of messages, shaped as
 * `MessageView`s, with the senders as `refs` (architecture 7, performance
 * 6).
 *
 * A run reads the window through its index (`window.ts`), the reactions of
 * those messages, and for Main the first known replies of the threads it links
 * to. Then it shapes the rows. Shaping is the expensive part, so each
 * subscription keeps a `MessageCache`:
 *
 * - by message ts, the row it built and the inputs it built it from. A
 *   message whose stored version, reactions, thread link and group start are
 *   unchanged keeps its row object and is not parsed again;
 * - the names of users, channels and user groups and the custom emoji the bodies looked
 *   up. Bodies are parsed with lookups from these maps; ids a body asked for
 *   that the maps lack are read in one statement and only those bodies are
 *   parsed again. The handler drops the maps when `users`, `conversations`,
 *   `usergroups` or `emoji` change, which rebuilds every row once.
 *
 * `rev` is a hash of the shaped row, so a rebuilt row that shows the same
 * thing keeps its `rev` and does not travel. The sender is a ref: a new
 * name or photo changes no row.
 */
import { Effect } from 'effect'
import { pendingRowId, type FileView, type MessageView, type Person, type ReactionIssue, type ReactionView, type ThreadLink } from '@juno/contract'
import {
  channelLabelBare,
  compareTs,
  fileMediaKind,
  hashId,
  firstName,
  startsGroup,
  threadLinkLabel,
  threadTopicId,
  tsToMillis,
  type ChannelId,
  type ChannelInfo,
  type GroupMessage,
  type Ts,
  type UserId,
  type Me,
  fileTextKind,
} from '@juno/domain'
import { editMarkup, emojiUnicode, messageBody, readableText, splitEmojiName, type MessageBody, type MessageContent, type UsergroupName } from '@juno/richtext'
import { syncState, StoreReader, type SqlClient, type SqlError } from '@juno/store'
import { imagesWithoutThumbs, type PendingFile } from '@juno/sync'
import { clipThread, threadCoverage, windowCovered, type ThreadCoverage } from './coverage'
import { broadcastTitles } from './broadcastTitles'
import { uploadsUrl } from '../staging'
import type { ListRun } from '../protocol/live'
import { reactionEmoji, readEmoji } from '../emojiLookup'
import { personFrom, userName, type UserRow } from '../topicRows'
import { actionsStatement, hiddenCopiesStatement, messagesByTsStatement, pendingStatement, reactionsStatement, rootStatement, firstRepliesStatement, windowStatements, type WindowMessage, type WindowTarget } from './window'

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
  /** For your own messages: the text the edit field starts with. */
  readonly editText?: string
}

/**
 * A user as the message list reads them. For an app or a deactivated
 * person, `dm` is their DM and `dm_main` the same once it has a Main, which
 * is what a click opens; null for anyone else.
 */
export type MessageUser = UserRow & { readonly is_bot: 0 | 1; readonly deleted: 0 | 1; readonly dm: string | null; readonly dm_main: string | null }

/** The users `ids` names, with the DM of each app and deactivated person (`MessageUser`), through `conversations_im_user`. */
export function messageUsersStatement(ids: ReadonlyArray<string>): { readonly sql: string; readonly params: ReadonlyArray<unknown> } {
  const dm = `SELECT d.id FROM conversations d WHERE d.kind = 'im' AND d.user_id = u.id AND d.is_member = 1`
  return {
    sql: `SELECT u.id, u.name, u.display_name, u.real_name, u.avatar_url, u.avatar_small_url, u.avatar_large_url, u.is_bot, u.deleted,
      CASE WHEN u.is_bot = 1 OR u.deleted = 1 THEN (${dm} LIMIT 1) END AS dm,
      CASE WHEN u.is_bot = 1 OR u.deleted = 1 THEN (${dm} AND EXISTS (SELECT 1 FROM topic_index t WHERE t.topic_id = 'm:' || d.id) LIMIT 1) END AS dm_main
      FROM users u WHERE u.id IN (${ids.map(() => '?').join(', ')})`,
    params: ids,
  }
}

/**
 * Juno has nothing to open for this user (SPEC 7, "People"): one the store
 * does not know, or an app or deactivated person whose DM has no Main. A
 * person with no DM still opens Home addressed to them. Undefined: not read yet.
 */
export const unreachable = (user: MessageUser | null | undefined): boolean => user === null || ((user?.is_bot === 1 || user?.deleted === 1) && user.dm_main === null)

/** `person` with its `unreachable` flag set to `flag`, the same object when it already is. */
export function reach(person: Person, flag: boolean): Person {
  if ((person.unreachable === true) === flag) return person
  if (flag) return { ...person, unreachable: true }
  const { unreachable: _unreachable, ...rest } = person
  return rest
}

/** What one `messages.list` subscription keeps between runs. See the module comment. */
export interface MessageCache {
  rows: Map<string, CachedRow>
  bodies: Map<string, CachedBody>
  /** Users read so far, `null` for an id with no row. */
  users: Map<string, MessageUser | null>
  /** Conversations read so far, `null` for an id with no row. */
  channels: Map<string, ChannelRow | null>
  /** User groups read so far, `null` for an id with no row. */
  usergroups: Map<string, UsergroupName | null>
  /** Custom emoji image urls, `null` for a name with no custom emoji. */
  emoji: Map<string, string | null>
  /** Custom aliases with no image, to the name they end at (a standard emoji, or a missing one). */
  emojiAliases: Map<string, string>
  /** Bumped whenever the lookup maps are dropped; a body parsed in an older epoch is parsed again. */
  epoch: number
  people: Map<string, Person>
  /** Set by the subscription: forget the lookups and run again once this Main exists. */
  watchMain?: (topicId: string) => void
  /** Watch only the source topics in this window for renamed or AI titles. */
  watchBroadcastTitles?: (ids: ReadonlyArray<string>) => void
  selfId: string | undefined
  membership: string
}

export const makeMessageCache = (): MessageCache => ({
  rows: new Map(),
  bodies: new Map(),
  users: new Map(),
  channels: new Map(),
  usergroups: new Map(),
  emoji: new Map(),
  emojiAliases: new Map(),
  epoch: 0,
  people: new Map(),
  selfId: undefined,
  membership: '',
})

/** Drops the names and emoji a cache has read, after `users`, `conversations`, `usergroups` or `emoji` changed. */
export function forgetLookups(cache: MessageCache): void {
  cache.users = new Map()
  cache.channels = new Map()
  cache.usergroups = new Map()
  cache.emoji = new Map()
  cache.emojiAliases = new Map()
  cache.epoch += 1
}

interface ChannelRow {
  readonly kind: ChannelInfo['kind']
  readonly name: string | null
  readonly user_id: string | null
  readonly member_ids_json: string | null
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
    const team = yield* sql<{ self_user_id: string | null; left: 0 | 1 }>`SELECT self_user_id,
      EXISTS (SELECT 1 FROM conversations WHERE id = ${target.channel} AND kind = 'private' AND is_member = 0) AS "left" FROM team LIMIT 1`
    // A private channel you left shows none of its messages, as Slack's own client drops them (SPEC 7, "Not in the channel").
    if (team[0]?.left === 1) return { rows: [], atNewest: true }
    const statements = windowStatements(target, range)
    // The older statement reads one extra row, the message before the window (see `windowStatements`).
    const older = yield* sql.unsafe<WindowMessage>(statements[0]!.sql, statements[0]!.params)
    const olderCount = statements.length === 1 ? range.limit : Math.min(range.before, range.limit)
    let beforeWindow = older[olderCount]
    const shown = older.slice(0, olderCount).toReversed()
    let stored: ReadonlyArray<WindowMessage>
    let atNewest = true
    // The message just after the window, when the newer statement read one.
    let afterWindow: WindowMessage | undefined
    if (statements.length === 1) {
      stored = shown
    } else {
      const newer = yield* sql.unsafe<WindowMessage>(statements[1]!.sql, statements[1]!.params)
      const room = Math.max(0, range.limit - shown.length)
      atNewest = newer.length <= room
      afterWindow = newer[room]
      stored = [...shown, ...newer.slice(0, room)]
    }
    // A root with no reply yet is outside the thread scope; it still comes first.
    if (target.kind === 'thread' && beforeWindow === undefined && !target.threadTs.startsWith('pending:') && stored[0]?.ts !== target.threadTs) {
      const statement = rootStatement(target)
      const root = (yield* sql.unsafe<WindowMessage>(statement.sql, statement.params))[0]
      if (root !== undefined) stored = [root, ...stored]
    }
    const selfId = team[0]?.self_user_id ?? undefined
    // A thread shows only the stretch around the anchor that its ranges prove continuous (`clipThread`).
    let coverage: ThreadCoverage | undefined
    let gapBefore = false
    let gapAfter: string | undefined
    let standIn = false
    if (target.kind === 'thread' && !target.threadTs.startsWith('pending:')) {
      coverage = yield* threadCoverage(target)
      const clipped = clipThread(stored, { threadTs: target.threadTs, anchor: range.anchor, previous: beforeWindow, next: afterWindow, atNewest, coverage, own: (row) => row.user_id === selfId })
      // Juno's own sends still show at the bottom: they come after everything, known or not.
      if (range.anchor !== undefined && clipped.rows.at(-1) !== stored.at(-1)) atNewest = false
      stored = clipped.rows
      beforeWindow = clipped.previous
      gapBefore = clipped.gapBefore
      gapAfter = clipped.gapAfter
      standIn = clipped.standIn
    }

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

    // Juno's own edits, deletes, reactions and broadcasts show over the stored message until Slack has them (architecture 5.7).
    const actions = listed.length === 0 ? emptyIntents : intentsOf(yield* sql.unsafe<ActionRow>(actionsStatement(target.channel).sql, actionsStatement(target.channel).params))
    // A reply the user also sent to the channel shows in Main at once, where it falls in the window.
    const broadcasting = target.kind === 'main' ? actions.broadcasts.filter((ts) => !listed.some((row) => row.ts === ts)) : []
    const sent = broadcasting.length === 0 ? [] : (yield* sql.unsafe<WindowMessage>(messagesByTsStatement(target.channel, broadcasting).sql, messagesByTsStatement(target.channel, broadcasting).params)).filter(
      (row) => row.deleted === 0 && (beforeWindow === undefined || compareTs(row.ts, beforeWindow.ts) > 0) && (atNewest || (stored.length > 0 && compareTs(row.ts, stored.at(-1)!.ts) <= 0)),
    )
    const withSent = sent.length === 0 ? listed : [...listed.filter((row) => !row.ts.startsWith('pending:')), ...sent].toSorted((a, b) => compareTs(a.ts, b.ts)).concat(listed.filter((row) => row.ts.startsWith('pending:')))
    const rows = actions.size === 0 ? withSent : withIntents(withSent, actions, target)

    if (cache.selfId !== selfId || cache.membership !== membership) {
      cache.membership = membership
      cache.selfId = selfId
      cache.rows = new Map()
      cache.bodies = new Map()
    }

    // Reactions, in Slack's order, with who reacted as far as Slack listed them.
    const reactions = new Map<string, Array<StoredReaction>>()
    if (rows.length > 0) {
      const statement = reactionsStatement(target.channel, [...stored, ...sent].map((row) => row.ts))
      for (const reaction of yield* sql.unsafe<{ ts: string; name: string; count: number; me: 0 | 1; user_ids_json: string | null }>(statement.sql, statement.params)) {
        let list = reactions.get(reaction.ts)
        if (list === undefined) reactions.set(reaction.ts, (list = []))
        list.push({ name: reaction.name, count: reaction.count, me: reaction.me, users: parseJson<Array<string>>(reaction.user_ids_json ?? '[]') ?? [] })
      }
    }

    // Main reads one local reply per linked root, never fetching threads for the list.
    const firstReplies = new Map<string, WindowMessage>()
    if (target.kind === 'main') {
      const roots = rows.filter((row) => row.thread_ts === row.ts && row.reply_count > 0).map((row) => row.ts)
      if (roots.length > 0) {
        const statement = firstRepliesStatement(target.channel, roots)
        const replies = yield* sql.unsafe<WindowMessage>(statement.sql, statement.params)
        for (const reply of withIntents(replies, actions, target)) if (reply.thread_ts !== null && reply.deleted === 0) firstReplies.set(reply.thread_ts, reply)
      }
    }
    const sources = yield* broadcastTitles(sql, target.kind === 'main'
      ? [...new Set(rows.flatMap((row) => row.subtype === 'thread_broadcast' && row.thread_ts !== null && row.thread_ts !== row.ts
        ? [threadTopicId(target.channel as ChannelId, row.thread_ts as Ts)] : []))] : [], selfId)
    cache.watchBroadcastTitles?.([...sources.values()].map((source) => source.id))
    const contentRows = [...rows, ...firstReplies.values()]
    const repliers = new Map<string, ReadonlyArray<string>>()
    if (target.kind === 'main') {
      for (const row of rows) {
        if (row.thread_ts === row.ts) repliers.set(row.ts, (parseJson<Array<string>>(row.reply_users_json) ?? []).slice(0, 3))
      }
    }

    // The user's own images Slack has no thumbnails for yet show their staged copies (`uploaded_files`).
    const local = new Map<string, LocalFile>()
    const waiting = selfId === undefined ? [] : rows.flatMap((row) => (row.user_id === selfId && row.files_json !== null && !pending.has(row.ts) ? imagesWithoutThumbs(row.files_json) : []))
    if (waiting.length > 0) {
      for (const file of yield* sql<LocalFile>`SELECT file_id, staged_name, width, height FROM uploaded_files WHERE file_id IN ${sql.in(waiting)}`) local.set(file.file_id, file)
    }

    // Senders, then bodies: parse with what the maps hold, read what they lacked, parse those again.
    const senders = new Set<string>()
    for (const row of contentRows) if (row.user_id !== null) senders.add(row.user_id)
    // The people a reaction's popover names, read with the senders.
    if (selfId !== undefined) senders.add(selfId)
    for (const list of reactions.values()) for (const reaction of list) for (const id of reaction.users.slice(0, REACTORS_SHOWN + 1)) senders.add(id)
    for (const ids of repliers.values()) for (const id of ids) senders.add(id)
    yield* readUsers(sql, cache, senders)
    const wanted = wantedNothing()
    const lookups = bodyLookups(cache, selfId, me, wanted)
    const parse = (row: WindowMessage): CachedBody => {
      const content: MessageContent = {
        text: row.text,
        ...(row.blocks_json === null ? {} : { blocks: parseJson<MessageContent['blocks']>(row.blocks_json) ?? [] }),
        ...(row.files_json === null ? {} : { files: parseJson<MessageContent['files']>(row.files_json) ?? [] }),
        ...(row.attachments_json === null ? {} : { attachments: parseJson<MessageContent['attachments']>(row.attachments_json) ?? [] }),
      }
      const body = row.deleted === 1 ? { blocks: [] } : messageBody(content, lookups)
      const own = row.deleted !== 1 && selfId !== undefined && row.user_id === selfId
      return { version: row.version, epoch: cache.epoch, body, ...(own ? { editText: editMarkup(content, lookups) } : {}) }
    }
    const bodies = new Map<string, CachedBody>()
    const parsedNow: Array<WindowMessage> = []
    for (const row of contentRows) {
      const held = cache.bodies.get(row.ts)
      if (held !== undefined && held.version === row.version && held.epoch === cache.epoch) {
        bodies.set(row.ts, held)
        continue
      }
      bodies.set(row.ts, parse(row))
      parsedNow.push(row)
    }
    // Emoji names in reactions are looked up too, so the second pass has them: the stored ones and the user's own the
    // outbox still holds, so a custom emoji's chip shows its image before Slack echoes the reaction.
    for (const list of reactions.values()) for (const reaction of list) if (emojiUnicode(reaction.name) === undefined) lookups.emoji(splitEmojiName(reaction.name).name)
    if (actions.size > 0) for (const row of rows) for (const name of intentOf(actions, row)?.reactions.keys() ?? []) if (emojiUnicode(name) === undefined) lookups.emoji(splitEmojiName(name).name)
    if (wantsAny(wanted)) {
      yield* readWanted(sql, cache, wanted, selfId)
      for (const row of parsedNow) bodies.set(row.ts, parse(row))
    }
    cache.bodies = bodies

    // Shape, reusing rows whose inputs are unchanged.
    const out: Array<MessageView> = []
    const nextRows = new Map<string, CachedRow>()
    const people = new Map<string, Person>()
    // Grouping starts from the message before the window, so the first row's header does not depend on where the window
    // begins: its sender, whether it is the root or a reply also sent to the channel, and when it was sent.
    let previous: GroupMessage | undefined =
      beforeWindow === undefined
        ? undefined
        : { senderId: groupSender(beforeWindow), body: { blocks: [] }, isThreadRoot: target.kind === 'thread' && beforeWindow.ts === target.threadTs, broadcast: beforeWindow.subtype === 'thread_broadcast', at: tsToMillis(beforeWindow.ts as Ts) }
    for (const row of rows) {
      const body = bodies.get(row.ts)!
      const isRoot = target.kind === 'thread' && row.ts === target.threadTs
      const sent = pending.get(row.ts)
      const at = sent === undefined ? tsToMillis(row.ts as Ts) : Number(sent.created_at)
      const group: GroupMessage = { senderId: groupSender(row), body: body.body, isThreadRoot: isRoot, broadcast: row.subtype === 'thread_broadcast', at }
      const groupStart = startsGroup(previous, group)
      previous = group
      const intent = intentOf(actions, row)
      const own = intent === undefined || intent.reactions.size === 0 ? (reactions.get(row.ts) ?? []) : withReactionIntents(reactions.get(row.ts) ?? [], intent.reactions, selfId)
      const topicId = target.kind === 'main' && row.thread_ts === row.ts && (row.reply_count > 0 || ownRoots.has(row.ts)) ? threadId(row) : undefined
      const reply = firstReplies.get(row.ts)
      const replyText = reply === undefined ? '' : readableText(bodies.get(reply.ts)!.body).replace(/\s+/g, ' ').trim().slice(0, 240)
      const sender = reply?.bot_name ?? (reply?.user_id === null || reply?.user_id === undefined ? undefined : cache.users.get(reply.user_id))
      const name = typeof sender === 'string' ? sender : sender == null ? undefined : firstName(userName(sender.id, sender))
      const preview = replyText === '' ? undefined : name ? `${name}: ${replyText}` : replyText
      const broadcastRoot = target.kind === 'main' && row.subtype === 'thread_broadcast' && row.thread_ts !== null && row.thread_ts !== row.ts ? row.thread_ts : undefined
      const broadcastFrom = broadcastRoot === undefined ? undefined : sources.get(broadcastRoot)
      const key = [
        row.version,
        row.subtype,
        broadcastFrom?.title,
        broadcastFrom?.sensitive,
        body.epoch,
        groupStart ? 1 : 0,
        row.reply_count,
        row.latest_reply,
        row.reply_users_json,
        preview,
        pending.get(row.ts)?.state,
        local.size === 0 ? '' : localKey(row, local),
        intent?.actionIssue?.id,
        intent?.issue === undefined ? '' : `${intent.issue.state}:${intent.issue.on ? 1 : 0}:${intent.issue.name}`,
        ...own.flatMap((r) => [r.name, r.count, r.me, r.users.join(',')]),
      ].join('\u0001')
      const held = cache.rows.get(row.ts)
      let view: MessageView
      if (held !== undefined && held.key === key) {
        view = held.row
      } else {
        const thread = topicId === undefined ? undefined : threadLink(topicId, row, preview, repliers.get(row.ts) ?? [])
        view = shapeRow(row, body, { groupStart, isRoot, selfId, reactions: own, reactionIssue: intent?.issue, actionIssue: intent?.actionIssue, thread, broadcastFrom, cache, pending: pending.get(row.ts), local })
      }
      nextRows.set(row.ts, { key, row: view })
      out.push(view)
      if (view.senderId !== undefined && !people.has(view.senderId)) {
        // A post with its own name or icon (an app, a webhook) is drawn as that sender, and opens the DM of the app user behind it.
        const app = cache.users.get(row.user_id ?? '')
        const person = row.bot_name !== null || row.bot_icon !== null
          ? { ...personFrom(view.senderId, { id: view.senderId, name: row.bot_name ?? row.user_id, display_name: row.bot_name, real_name: null, avatar_url: row.bot_icon ?? app?.avatar_url ?? null }), ...(unreachable(app) ? { unreachable: true as const } : { user: row.user_id! }) }
          : reach(personFrom(view.senderId, cache.users.get(view.senderId), cache.people.get(view.senderId)), unreachable(cache.users.get(view.senderId)))
        people.set(view.senderId, person)
      }
      for (const id of view.thread?.replierIds ?? []) {
        if (!people.has(id)) people.set(id, reach(personFrom(id, cache.users.get(id), cache.people.get(id)), unreachable(cache.users.get(id))))
      }
      for (const reaction of view.reactions) {
        for (const id of reaction.users ?? []) if (!people.has(id)) people.set(id, reach(personFrom(id, cache.users.get(id), cache.people.get(id)), unreachable(cache.users.get(id))))
      }
    }
    cache.rows = nextRows
    cache.people = people
    return {
      rows: out,
      total: out.length,
      atNewest,
      windowCovered: yield* windowCovered(target, stored[0]?.ts, coverage),
      ...(gapBefore ? { gapBefore } : {}),
      ...(gapAfter === undefined ? {} : { gapAfter }),
      ...(standIn ? { standIn } : {}),
      refs: { people: [...people.values()] },
    }
  })

/** Ids a body asked for that the cache lacked, for `readWanted`. */
export interface Wanted {
  readonly users: Set<string>
  readonly channels: Set<string>
  readonly usergroups: Set<string>
  readonly emoji: Set<string>
}

export const wantedNothing = (): Wanted => ({ users: new Set(), channels: new Set(), usergroups: new Set(), emoji: new Set() })
export const wantsAny = (wanted: Wanted): boolean => wanted.users.size + wanted.channels.size + wanted.usergroups.size + wanted.emoji.size > 0

/** What `messageBody` asks while it parses, answered from the cache. What the cache lacks goes into `wanted`. */
export function bodyLookups(cache: MessageCache, selfId: string | undefined, me: Me | undefined, wanted: Wanted) {
  const user = (id: string) => {
    const row = cache.users.get(id)
    if (row === undefined) wanted.users.add(id)
    return row === undefined || row === null ? undefined : userName(id, row)
  }
  return {
    ...(selfId === undefined ? {} : { me: selfId }),
    ...(me?.usergroupIds === undefined ? {} : { myUsergroups: me.usergroupIds }),
    user,
    unreachable: (id: string) => unreachable(cache.users.get(id)),
    channel: (id: string) => {
      const row = cache.channels.get(id)
      if (row === undefined) wanted.channels.add(id)
      return row?.name ?? undefined
    },
    // A DM is named by its people, as the sidebar names it.
    place: (id: string) => {
      const row = cache.channels.get(id)
      if (row === undefined) wanted.channels.add(id)
      if (row === undefined || row === null) return undefined
      const nameOf = (member: string) => user(member) ?? member
      if (row.kind === 'im') return row.user_id === null ? undefined : { kind: row.kind, name: nameOf(row.user_id) }
      if (row.name === null) return undefined
      const members = row.kind === 'mpim' ? placeMembers(row, selfId) : []
      return { kind: row.kind, name: channelLabelBare({ kind: row.kind, name: row.name, memberNames: members.map(nameOf) }) }
    },
    usergroup: (id: string) => {
      const group = cache.usergroups.get(id)
      if (group === undefined) wanted.usergroups.add(id)
      return group ?? undefined
    },
    emoji: (name: string) => {
      const url = cache.emoji.get(name)
      if (url === undefined) wanted.emoji.add(name)
      return url ?? undefined
    },
    emojiAlias: (name: string) => cache.emojiAliases.get(name),
  }
}

/** Reads what the lookups wanted into the cache, so a second parse has it. */
export const readWanted = (sql: SqlClient.SqlClient, cache: MessageCache, wanted: Wanted, selfId: string | undefined) =>
  Effect.gen(function* () {
    yield* readChannels(sql, cache, wanted.channels)
    // The people a DM a shared message came from is named by.
    const placePeople = [...wanted.channels].flatMap((id) => {
      const row = cache.channels.get(id)
      return row?.kind === 'im' && row.user_id !== null ? [row.user_id] : row?.kind === 'mpim' ? placeMembers(row, selfId) : []
    })
    yield* readUsers(sql, cache, [...wanted.users, ...placePeople])
    yield* readUsergroups(sql, cache, wanted.usergroups)
    yield* readEmoji(sql, cache, wanted.emoji)
  })

export const readUsers = (sql: SqlClient.SqlClient, cache: MessageCache, ids: Iterable<string>) =>
  Effect.gen(function* () {
    const missing = [...ids].filter((id) => !cache.users.has(id))
    if (missing.length === 0) return
    for (const id of missing) cache.users.set(id, null)
    const statement = messageUsersStatement(missing)
    for (const user of yield* sql.unsafe<MessageUser>(statement.sql, statement.params)) {
      cache.users.set(user.id, user)
      // A DM with no Main yet opens nothing until its Main arrives; the list hears of that one row (`watchMain`).
      if (user.dm !== null && user.dm_main === null) cache.watchMain?.(`m:${user.dm}`)
    }
  })

const readChannels = (sql: SqlClient.SqlClient, cache: MessageCache, ids: Iterable<string>) =>
  Effect.gen(function* () {
    const missing = [...ids].filter((id) => !cache.channels.has(id))
    if (missing.length === 0) return
    for (const id of missing) cache.channels.set(id, null)
    for (const row of yield* sql<ChannelRow & { id: string }>`SELECT id, kind, name, user_id, member_ids_json FROM conversations WHERE id IN ${sql.in(missing)}`) {
      cache.channels.set(row.id, { kind: row.kind, name: row.name, user_id: row.user_id, member_ids_json: row.member_ids_json })
    }
  })

/** A group DM's members other than you. */
const placeMembers = (row: ChannelRow, selfId: string | undefined): ReadonlyArray<string> =>
  (parseJson<Array<string>>(row.member_ids_json) ?? []).filter((id) => id !== selfId)

/** User groups by id. A deleted group keeps its handle. */
const readUsergroups = (sql: SqlClient.SqlClient, cache: MessageCache, ids: Iterable<string>) =>
  Effect.gen(function* () {
    const missing = [...ids].filter((id) => !cache.usergroups.has(id))
    if (missing.length === 0) return
    for (const id of missing) cache.usergroups.set(id, null)
    for (const row of yield* sql<{ id: string; handle: string; name: string | null }>`SELECT id, handle, name FROM usergroups WHERE id IN ${sql.in(missing)}`) {
      cache.usergroups.set(row.id, { handle: row.handle, ...(row.name === null ? {} : { name: row.name }) })
    }
  })

function threadLink(
  topicId: string,
  row: WindowMessage,
  preview: string | undefined,
  replierIds: ReadonlyArray<string>,
): ThreadLink {
  return {
    id: topicId,
    replyCount: row.reply_count,
    label: threadLinkLabel(row.reply_count),
    replierIds,
    ...(preview === undefined ? {} : { preview }),
    ...(row.latest_reply === null ? {} : { lastReplyAt: tsToMillis(row.latest_reply as Ts) }),
  }
}

interface ShapeInput {
  readonly groupStart: boolean
  readonly isRoot: boolean
  readonly selfId: string | undefined
  readonly reactions: ReadonlyArray<StoredReaction>
  readonly actionIssue: MessageView['actionIssue']
  readonly reactionIssue: ReactionIssue | undefined
  readonly thread: ThreadLink | undefined
  readonly broadcastFrom: MessageView['broadcastFrom']
  readonly cache: MessageCache
  readonly pending: PendingRow | undefined
  readonly local: ReadonlyMap<string, LocalFile>
}

function shapeRow(row: WindowMessage, body: CachedBody, input: ShapeInput): MessageView {
  const kind = row.deleted === 1 ? 'deleted' : STUB(row) ? 'unloaded' : 'message'
  const reactions: Array<ReactionView> = input.reactions.map((reaction) => {
    const users = shownReactors(reaction.users, reaction.me === 1, input.selfId)
    return {
      name: reaction.name,
      count: reaction.count,
      me: reaction.me === 1,
      ...(users.length === 0 ? {} : { users }),
      ...reactionEmoji(reaction.name, input.cache),
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
    broadcast: row.subtype === 'thread_broadcast',
    root: input.isRoot,
    reactions: kind === 'message' ? reactions : [],
    ...(input.actionIssue === undefined ? {} : { actionIssue: input.actionIssue }),
    ...(kind === 'message' && input.reactionIssue !== undefined ? { reactionIssue: input.reactionIssue } : {}),
    files: kind !== 'message' ? [] : [...(input.pending === undefined ? filesOf(parseJson<ReadonlyArray<SlackFile>>(row.files_json), input.local) : pendingFiles(input.pending)), ...filesOf(sharedFiles(row), input.local)],
    ...(input.thread === undefined ? {} : { thread: input.thread }),
    ...(input.broadcastFrom === undefined ? {} : { broadcastFrom: input.broadcastFrom }),
    ...(row.client_msg_id === null ? {} : { clientMsgId: row.client_msg_id }),
    ...(input.pending === undefined ? {} : { pending: input.pending.state === 'failed' ? ('failed' as const) : ('sending' as const) }),
    ...(kind === 'message' && body.editText !== undefined ? { editText: body.editText } : {}),
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
  /** A forward's source and its card (`send/forward.ts`). */
  readonly share_json: string | null
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

// Edits, deletes, reactions and broadcasts not yet in Slack

export interface ActionRow {
  readonly created_at: string
  readonly id: number
  readonly kind: 'edit' | 'delete' | 'react' | 'broadcast'
  readonly payload_json: string
}

/** What the user has asked for one message: the text of an edit, a delete, a broadcast, reactions by name, and the newest reaction Slack has not taken. */
export interface Intent {
  edit?: { readonly text: string; readonly blocksJson: string | null }
  deleted: boolean
  broadcast?: boolean
  readonly reactions: Map<string, boolean>
  actionIssue?: NonNullable<MessageView['actionIssue']>
  issue?: ReactionIssue
}

/** Intents by the message's ts and by its `client_msg_id`, for posts Slack did not have when the user acted; `broadcasts` are the replies being sent to the channel. */
export type Intents = { readonly size: number; readonly byTs: Map<string, Intent>; readonly byClientMsgId: Map<string, Intent>; readonly broadcasts: ReadonlyArray<string> }

const emptyIntents: Intents = { size: 0, byTs: new Map(), byClientMsgId: new Map(), broadcasts: [] }

export function intentsOf(rows: ReadonlyArray<ActionRow>): Intents {
  const byTs = new Map<string, Intent>()
  const byClientMsgId = new Map<string, Intent>()
  const broadcasts: Array<string> = []
  for (const row of rows) {
    const payload = parseJson<{ ts: string | null; clientMsgId: string | null; text?: string; blocksJson?: string | null; name?: string; want?: boolean; failed?: string; stalled?: boolean }>(row.payload_json)
    if (payload === undefined) continue
    const intent = (payload.ts !== null ? byTs.get(payload.ts) : undefined) ?? (payload.clientMsgId !== null ? byClientMsgId.get(payload.clientMsgId) : undefined) ?? { deleted: false, reactions: new Map<string, boolean>() }
    if (payload.ts !== null) byTs.set(payload.ts, intent)
    if (payload.clientMsgId !== null) byClientMsgId.set(payload.clientMsgId, intent)
    if (row.kind !== 'react' && payload.failed !== undefined) intent.actionIssue = { id: row.id, kind: row.kind }
    else if (row.kind === 'delete') intent.deleted = true
    else if (row.kind === 'edit' && payload.text !== undefined) intent.edit = { text: payload.text, blocksJson: payload.blocksJson ?? null }
    else if (row.kind === 'broadcast' && payload.ts !== null) {
      intent.broadcast = true
      broadcasts.push(payload.ts)
    }
    else if (row.kind === 'react' && payload.name !== undefined) {
      // A refused reaction shows what Slack has; one that has waited long shows the change and says it is not sent yet.
      if (payload.failed === undefined) intent.reactions.set(payload.name, payload.want === true)
      if (payload.failed !== undefined || payload.stalled === true) intent.issue = { id: row.id, key: `${row.id}:${row.created_at}`, name: payload.name, on: payload.want === true, state: payload.failed === undefined ? 'waiting' : 'failed' }
    }
  }
  return { size: rows.length, byTs, byClientMsgId, broadcasts }
}

export const intentOf = (intents: Intents, row: Pick<WindowMessage, 'ts' | 'client_msg_id'>): Intent | undefined =>
  intents.size === 0 ? undefined : (intents.byTs.get(row.ts) ?? (row.client_msg_id === null ? undefined : intents.byClientMsgId.get(row.client_msg_id)))

/**
 * The window with the intents applied: an edited message shows its new
 * text and "edited"; a deleted one goes, except a root with replies, which
 * keeps its place as deleted, as Slack shows it; a reply being sent to the
 * channel shows as one.
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
    } else {
      const edited = intent.edit === undefined ? row : { ...row, text: intent.edit.text, blocks_json: intent.edit.blocksJson, edited_ts: row.edited_ts ?? row.ts, version: contentVersion(intent.edit.text, intent.edit.blocksJson) }
      out.push(intent.broadcast === true && row.thread_ts !== null && row.thread_ts !== row.ts ? { ...edited, subtype: 'thread_broadcast' } : edited)
    }
  }
  return out
}

/** A reaction as the store holds it: `users` is who Slack listed, which may be fewer than `count`. */
export interface StoredReaction {
  readonly name: string
  readonly count: number
  readonly me: 0 | 1
  readonly users: ReadonlyArray<string>
}

/** How many people a reaction's popover names; the rest are "and N others". */
const REACTORS_SHOWN = 10

/** Who reacted, in the order the views name them: you first when you reacted, then the others in Slack's order. */
export function orderedReactors(users: ReadonlyArray<string>, me: boolean, selfId: string | undefined): ReadonlyArray<string> {
  const others = users.filter((id) => id !== selfId)
  return me && selfId !== undefined ? [selfId, ...others] : others
}

/** The reactors a message row gets: `orderedReactors`, at most REACTORS_SHOWN. The "who reacted" dialog gets them all (`reactors.ts`). */
const shownReactors = (users: ReadonlyArray<string>, me: boolean, selfId: string | undefined): ReadonlyArray<string> =>
  orderedReactors(users, me, selfId).slice(0, REACTORS_SHOWN)

/** Stored reactions with the user's own intents applied: theirs counted in or out, an emptied chip gone, a new one last. */

export function withReactionIntents(stored: ReadonlyArray<StoredReaction>, intents: ReadonlyMap<string, boolean>, selfId: string | undefined): ReadonlyArray<StoredReaction> {
  const out: Array<StoredReaction> = []
  const without = (users: ReadonlyArray<string>) => users.filter((id) => id !== selfId)
  for (const reaction of stored) {
    const want = intents.get(reaction.name)
    if (want === undefined || want === (reaction.me === 1)) out.push(reaction)
    else if (want) out.push({ name: reaction.name, count: reaction.count + 1, me: 1, users: selfId === undefined ? reaction.users : [...without(reaction.users), selfId] })
    else if (reaction.count > 1) out.push({ name: reaction.name, count: reaction.count - 1, me: 0, users: without(reaction.users) })
  }
  for (const [name, want] of intents) if (want && !stored.some((reaction) => reaction.name === name)) out.push({ name, count: 1, me: 1, users: selfId === undefined ? [] : [selfId] })
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
  // A forward shows its source as the shared card Slack's copy will carry.
  attachments_json: row.share_json === null ? null : JSON.stringify([(JSON.parse(row.share_json) as { attachment: unknown }).attachment]),
  edited_ts: null,
  deleted: 0,
  client_msg_id: row.client_msg_id,
  reply_count: 0,
  latest_reply: null,
  reply_users_json: null,
  // An edit before the post went out rewrites the row's text, so its body is parsed again.
  version: contentVersion(row.text, `${row.blocks_json ?? ''}${row.share_json ?? ''}`),
  last_event_ts: null,
  partial: 0,
})

// Files

interface SlackFile {
  readonly id?: string
  readonly name?: string | null
  readonly title?: string | null
  readonly mimetype?: string
  readonly filetype?: string
  readonly pretty_type?: string
  readonly subtype?: string
  readonly size?: number
  readonly mode?: string
  readonly file_access?: string
  readonly lines?: number
  readonly duration_ms?: number
  readonly aac?: string
  readonly original_w?: number
  readonly original_h?: number
  readonly thumb_360?: string
  readonly thumb_360_w?: number
  readonly thumb_360_h?: number
  readonly thumb_480?: string
  readonly thumb_720?: string
  readonly thumb_1024?: string
  readonly thumb_video?: string
  readonly thumb_video_w?: number
  readonly thumb_video_h?: number
  readonly mp4?: string
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
  return boxOf(`juno://files/${encodeURIComponent(file.id)}/${variant}?url=${encodeURIComponent(url)}`, w, h)
}

/**
 * A video's poster frame and what the viewer plays: Slack's `mp4` when it
 * made one, else the original. Without a poster and its size the video is a
 * card.
 */
function videoOf(file: SlackFile): Pick<FileView, 'thumb' | 'video' | 'width' | 'height'> | undefined {
  const w = file.thumb_video_w
  const h = file.thumb_video_h
  const play = file.mp4 ?? file.url_private
  if (file.id === undefined || file.thumb_video === undefined || play === undefined || w === undefined || h === undefined || w <= 0 || h <= 0) return undefined
  const id = encodeURIComponent(file.id)
  return {
    width: w,
    height: h,
    thumb: boxOf(`juno://files/${id}/poster?url=${encodeURIComponent(file.thumb_video)}`, w, h),
    video: `juno://files/${id}/video?url=${encodeURIComponent(play)}`,
  }
}

/**
 * The files of a message Juno is sending, from their staged copies. An
 * image's box comes from the same pixel size as Slack's (`boxOf`), so the
 * row does not move when the stored message replaces it.
 */
function pendingFiles(row: PendingRow): ReadonlyArray<FileView> {
  const files = parseJson<ReadonlyArray<PendingFile>>(row.file_ids_json) ?? []
  return files.map((file) => {
    const kind = fileMediaKind(file)
    const src = uploadsUrl(file.stagedName)
    const sized = kind === 'image' && file.width !== undefined && file.height !== undefined && !file.stagedName.endsWith('.bin')
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
            thumb: boxOf(src, file.width!, file.height!),
            full: src,
          }
        : {}),
    }
  })
}

/**
 * What the viewer needs for a file that is not a picture: an audio file's
 * player url (a voice clip's `aac` when Slack made one) and length, and a
 * pdf, html or text file's content url, with how to draw text. A snippet's
 * `preview` may be cut short, so the viewer always reads the content url.
 */
function documentOf(file: SlackFile, kind: FileView['kind']): Partial<FileView> {
  if (file.id === undefined) return {}
  const id = encodeURIComponent(file.id)
  if (kind === 'audio') {
    const play = file.aac ?? file.url_private
    return {
      ...(play === undefined ? {} : { audio: `juno://files/${id}/audio?url=${encodeURIComponent(play)}` }),
      ...(file.duration_ms === undefined ? {} : { durationMs: file.duration_ms }),
    }
  }
  if ((kind !== 'pdf' && kind !== 'html' && kind !== 'text') || file.url_private === undefined) return {}
  // The name last, so Chromium's PDF viewer titles the file by it.
  const content = `juno://files/${id}/content/${encodeURIComponent(file.name || file.title || 'file')}?url=${encodeURIComponent(file.url_private)}`
  if (kind !== 'text') return { content }
  const text = fileTextKind(file)
  return {
    content,
    textKind: text.kind,
    ...(text.language === undefined ? {} : { language: text.language }),
    ...(file.lines === undefined ? {} : { lines: file.lines }),
  }
}

/** A sent image's staged copy, while Slack has no thumbnails for it (`uploaded_files`). */
interface LocalFile {
  readonly file_id: string
  readonly staged_name: string
  readonly width: number
  readonly height: number
}

/** The staged copies a row shows, for its cache key. */
function localKey(row: WindowMessage, local: ReadonlyMap<string, LocalFile>): string {
  if (row.files_json === null) return ''
  return imagesWithoutThumbs(row.files_json).flatMap((id) => { const file = local.get(id); return file === undefined ? [] : [file.staged_name] }).join(',')
}

/**
 * An image's box from its pixel size, the same for a staged copy and for
 * Slack's thumbnail, so the row does not move when one replaces the other.
 */
function boxOf(src: string, width: number, height: number): NonNullable<FileView['thumb']> {
  const scale = Math.min(1, THUMB_BOX / Math.max(width, height))
  return { src, width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** A stored message's files and the files of the messages it shares, as a row shows them, without staged copies. */
export function storedFiles(row: Pick<WindowMessage, 'files_json' | 'attachments_json'>): ReadonlyArray<FileView> {
  const none = new Map<string, LocalFile>()
  return [...filesOf(parseJson<ReadonlyArray<SlackFile>>(row.files_json), none), ...filesOf(sharedFiles(row), none)]
}

/** The files of the messages a row shares, which its cards draw (`richtext` `attachmentBlock`). */
function sharedFiles(row: Pick<WindowMessage, 'attachments_json'>): ReadonlyArray<SlackFile> | undefined {
  if (row.attachments_json === null || !row.attachments_json.includes('"files"')) return undefined
  return (parseJson<ReadonlyArray<{ readonly files?: ReadonlyArray<SlackFile> }>>(row.attachments_json) ?? []).flatMap((attachment) => attachment.files ?? [])
}

function filesOf(files: ReadonlyArray<SlackFile> | undefined, local: ReadonlyMap<string, LocalFile>): ReadonlyArray<FileView> {
  if (files === undefined) return []
  const out: Array<FileView> = []
  for (const file of files) {
    if (file.id === undefined) continue
    if (file.mode === 'tombstone' || file.file_access === 'file_not_found') {
      out.push({ id: file.id, name: '', kind: 'deleted' })
      continue
    }
    // Slack fills a fresh upload's `mimetype` in as it processes the file; the name says what it is meanwhile (`@juno/domain` `files.ts`).
    const kind = fileMediaKind(file)
    const slack = kind === 'image' ? thumbOf(file) : undefined
    const staged = kind === 'image' && slack === undefined ? local.get(file.id) : undefined
    if (staged !== undefined) {
      const src = uploadsUrl(staged.staged_name)
      out.push({
        id: file.id,
        name: file.title || file.name || 'File',
        kind,
        ...(file.mimetype === undefined ? {} : { mimetype: file.mimetype }),
        ...(file.size === undefined ? {} : { size: file.size }),
        width: staged.width,
        height: staged.height,
        thumb: boxOf(src, staged.width, staged.height),
        full: src,
        ...(file.url_private_download === undefined ? {} : { download: file.url_private_download }),
      })
      continue
    }
    if (kind === 'video') {
      const poster = videoOf(file)
      out.push({
        id: file.id,
        name: file.title || file.name || 'File',
        kind,
        ...(file.mimetype === undefined ? {} : { mimetype: file.mimetype }),
        ...(file.size === undefined ? {} : { size: file.size }),
        ...(poster === undefined ? {} : poster),
        ...(file.url_private_download === undefined ? {} : { download: file.url_private_download }),
      })
      continue
    }
    const thumb = slack
    // The viewer shows the original (Slack's `url_private`).
    const full = thumb === undefined ? undefined : file.url_private ?? file.thumb_1024
    out.push({
      id: file.id,
      name: file.title || file.name || 'File',
      kind,
      ...(file.mimetype === undefined ? {} : { mimetype: file.mimetype }),
      ...(file.size === undefined ? {} : { size: file.size }),
      ...(file.original_w === undefined || file.original_h === undefined ? {} : { width: file.original_w, height: file.original_h }),
      ...(thumb === undefined ? {} : { thumb }),
      ...(full === undefined ? {} : { full: `juno://files/${encodeURIComponent(file.id)}/full?url=${encodeURIComponent(full)}` }),
      ...documentOf(file, kind),
      ...(file.url_private_download === undefined ? {} : { download: file.url_private_download }),
    })
  }
  return out
}
