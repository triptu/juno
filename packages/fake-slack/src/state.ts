/**
 * The workspace: users, conversations, messages, read state and thread
 * subscriptions for one user, plus the mutations that change them. Every
 * mutation emits the socket frames the real server would send. The HTTP
 * handlers and the control API both go through here.
 */
import type {
  Channel,
  CountEntry,
  File,
  Im,
  Message,
  Reaction,
  RtmFrame,
  Team,
  ThreadCounts,
  ThreadSubscription,
  User,
  UserPrefs,
} from '@juno/slack/schemas'
import { compareTs, isReply, millisToTs } from '@juno/slack/schemas'
import type { Clock } from './clock.ts'
import { textToBlocks, toMrkdwn } from './richtext.ts'

export type ConversationKind = 'public' | 'private' | 'im' | 'mpim'

export interface ConversationRecord {
  readonly id: string
  name: string
  readonly kind: ConversationKind
  readonly members: Set<string>
  readonly created: number
  topic: string
  purpose: string
  isOpen: boolean
  archived: boolean
}

export interface Subscription {
  readonly channel: string
  readonly threadTs: string
  lastRead: string
  subscribed: boolean
  readonly dateCreate: number
}

export interface StoredFile {
  readonly id: string
  readonly name: string
  readonly length: number
  readonly user: string
  readonly created: number
  bytes: Buffer | undefined
  mimetype: string
}

export interface PostInput {
  readonly channel: string
  readonly user: string
  readonly text?: string
  readonly blocks?: Message['blocks']
  readonly threadTs?: string
  readonly broadcast?: boolean
  readonly clientMsgId?: string
  readonly files?: ReadonlyArray<File>
  readonly at?: number
  readonly subtype?: string
  /** Fixture-only: skip events and read-state side effects. */
  readonly silent?: boolean
}

export const NEVER_READ = '0000000000.000000'

export class Workspace {
  readonly users = new Map<string, User>()
  readonly conversations = new Map<string, ConversationRecord>()
  readonly messages = new Map<string, Message[]>()
  /** Self's `last_read` per conversation. */
  readonly reads = new Map<string, string>()
  readonly subscriptions = new Map<string, Subscription>()
  readonly files = new Map<string, StoredFile>()
  prefs: UserPrefs = {}
  readonly clock: Clock
  readonly selfId: string
  readonly team: Team
  #lastTs = NEVER_READ
  #sequence = 0
  #listeners = new Set<(frame: RtmFrame) => void>()

  constructor(clock: Clock, selfId: string, team: Team) {
    this.clock = clock
    this.selfId = selfId
    this.team = team
  }

  // Events

  onEvent(listener: (frame: RtmFrame) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  emit(frame: RtmFrame): void {
    for (const listener of this.#listeners) listener(frame)
  }

  // Timestamps

  /** A ts for `at` (default now), always greater than the last one issued. */
  nextTs(at?: number): string {
    let ts = millisToTs(at ?? this.clock.now(), this.#sequence++ % 1000)
    if (compareTs(ts, this.#lastTs) <= 0) {
      const [seconds, fraction] = this.#lastTs.split('.') as [string, string]
      ts = `${seconds}.${String(Number(fraction) + 1).padStart(6, '0')}`
    }
    this.#lastTs = ts
    return ts
  }

  eventTs(): string {
    return this.nextTs()
  }

  // Lookup

  conversation(id: string): ConversationRecord | undefined {
    return this.conversations.get(id)
  }

  isMember(channel: string): boolean {
    return this.conversations.get(channel)?.members.has(this.selfId) ?? false
  }

  /** Messages of a conversation, oldest first, replies included. */
  all(channel: string): Message[] {
    let list = this.messages.get(channel)
    if (list === undefined) {
      list = []
      this.messages.set(channel, list)
    }
    return list
  }

  /** Main messages: roots and unthreaded messages, plus broadcast replies. */
  main(channel: string): Message[] {
    return this.all(channel).filter((m) => !isReply(m) || m.subtype === 'thread_broadcast')
  }

  find(channel: string, ts: string): Message | undefined {
    return this.all(channel).find((m) => m.ts === ts)
  }

  replies(channel: string, threadTs: string): Message[] {
    return this.all(channel).filter((m) => m.thread_ts === threadTs && m.ts !== threadTs)
  }

  subscription(channel: string, threadTs: string): Subscription | undefined {
    return this.subscriptions.get(`${channel}:${threadTs}`)
  }

  mentionsSelf(message: Message): boolean {
    const text = message.text ?? ''
    return text.includes(`<@${this.selfId}>`) || /<!(here|channel|everyone)>/.test(text)
  }

  // Shapes for the wire

  channelObject(c: ConversationRecord): Channel {
    const main = this.main(c.id)
    const latest = main.at(-1)
    return {
      id: c.id,
      name: c.name,
      name_normalized: c.name,
      is_channel: c.kind === 'public' || c.kind === 'private',
      is_group: false,
      is_im: c.kind === 'im',
      is_mpim: c.kind === 'mpim',
      is_private: c.kind === 'private' || c.kind === 'mpim',
      is_archived: c.archived,
      is_general: c.name === 'general',
      is_member: c.members.has(this.selfId),
      is_open: c.isOpen,
      is_shared: false,
      is_org_shared: false,
      created: Math.floor(c.created / 1000),
      creator: [...c.members][0] ?? this.selfId,
      updated: c.created,
      context_team_id: this.team.id,
      topic: { value: c.topic, creator: this.selfId, last_set: Math.floor(c.created / 1000) },
      purpose: { value: c.purpose, creator: this.selfId, last_set: Math.floor(c.created / 1000) },
      members: [...c.members],
      num_members: c.members.size,
      last_read: this.reads.get(c.id) ?? NEVER_READ,
      ...(latest === undefined ? {} : { latest: latest.ts }),
      ...(c.kind === 'im' ? { user: this.imPartner(c) } : {}),
    }
  }

  imObject(c: ConversationRecord): Im {
    const latest = this.main(c.id).at(-1)
    return {
      id: c.id,
      user: this.imPartner(c),
      is_im: true,
      is_open: c.isOpen,
      is_user_deleted: false,
      is_org_shared: false,
      created: Math.floor(c.created / 1000),
      updated: c.created,
      priority: 0,
      context_team_id: this.team.id,
      last_read: this.reads.get(c.id) ?? NEVER_READ,
      ...(latest === undefined ? {} : { latest: latest.ts }),
    }
  }

  imPartner(c: ConversationRecord): string {
    return [...c.members].find((id) => id !== this.selfId) ?? this.selfId
  }

  countEntry(c: ConversationRecord): CountEntry {
    const lastRead = this.reads.get(c.id) ?? NEVER_READ
    const main = this.main(c.id)
    const unread = main.filter((m) => compareTs(m.ts, lastRead) > 0 && m.user !== this.selfId)
    const direct = c.kind === 'im' || c.kind === 'mpim'
    const mentions = direct ? unread.length : unread.filter((m) => this.mentionsSelf(m)).length
    const latest = main.at(-1)
    return {
      id: c.id,
      last_read: lastRead,
      latest: latest?.ts ?? null,
      has_unreads: unread.length > 0,
      mention_count: mentions,
      mention_count_display: mentions,
      updated: latest?.ts ?? lastRead,
    }
  }

  threadCounts(): ThreadCounts {
    const unreadByChannel: Record<string, number> = {}
    const mentionsByChannel: Record<string, number> = {}
    for (const sub of this.subscriptions.values()) {
      if (!sub.subscribed) continue
      const unread = this.replies(sub.channel, sub.threadTs).filter(
        (m) => compareTs(m.ts, sub.lastRead) > 0 && m.user !== this.selfId,
      )
      if (unread.length === 0) continue
      unreadByChannel[sub.channel] = (unreadByChannel[sub.channel] ?? 0) + unread.length
      const mentions = unread.filter((m) => this.mentionsSelf(m)).length
      if (mentions > 0) mentionsByChannel[sub.channel] = (mentionsByChannel[sub.channel] ?? 0) + mentions
    }
    const mentionCount = Object.values(mentionsByChannel).reduce((a, b) => a + b, 0)
    return {
      has_unreads: Object.keys(unreadByChannel).length > 0,
      mention_count: mentionCount,
      unread_count_by_channel: unreadByChannel,
      mention_count_by_channel: mentionsByChannel,
      timestamp: this.#lastTs,
    }
  }

  subscriptionObject(sub: Subscription): ThreadSubscription {
    return {
      type: 'thread',
      channel: sub.channel,
      thread_ts: sub.threadTs,
      last_read: sub.lastRead,
      date_create: Math.floor(sub.dateCreate / 1000),
      active: sub.subscribed,
    }
  }

  /** A thread root as `subscriptions.thread.getView` and history show it: with its counters. */
  withThreadFields(message: Message): Message {
    const replies = this.replies(message.channel ?? '', message.ts)
    if (replies.length === 0) return message
    const sub = this.subscription(message.channel ?? '', message.ts)
    const users = [...new Set(replies.map((r) => r.user).filter((u): u is string => u !== undefined))]
    const latest = replies.at(-1)?.ts ?? message.ts
    return {
      ...message,
      thread_ts: message.ts,
      reply_count: replies.length,
      reply_users_count: users.length,
      reply_users: users,
      latest_reply: latest,
      subscribed: sub?.subscribed ?? false,
      ...(sub?.subscribed === true
        ? {
            last_read: sub.lastRead,
            unread_count: replies.filter((r) => compareTs(r.ts, sub.lastRead) > 0 && r.user !== this.selfId).length,
          }
        : {}),
    }
  }

  // Mutations

  addUser(user: User): void {
    this.users.set(user.id, user)
  }

  addConversation(record: ConversationRecord): void {
    this.conversations.set(record.id, record)
    if (!this.reads.has(record.id)) this.reads.set(record.id, NEVER_READ)
  }

  /** Stores a message. Replies update their root and, unless silent, the real-time side effects run. */
  post(input: PostInput): Message {
    const conversation = this.conversations.get(input.channel)
    if (conversation === undefined) throw new Error(`No conversation ${input.channel}`)
    const ts = this.nextTs(input.at)
    const user = this.users.get(input.user)
    const text = input.text === undefined ? '' : toMrkdwn(input.text)
    const blocks = input.blocks ?? (input.text === undefined ? undefined : textToBlocks(input.text))
    const root = input.threadTs === undefined ? undefined : this.find(input.channel, input.threadTs)
    if (input.threadTs !== undefined && root === undefined) throw new Error(`No thread ${input.threadTs}`)
    const message: Message = {
      type: 'message',
      ts,
      user: input.user,
      text,
      team: this.team.id,
      ...(blocks === undefined ? {} : { blocks }),
      ...(user?.is_bot === true
        ? { bot_id: `B${user.id.slice(1)}`, bot_profile: { id: `B${user.id.slice(1)}`, name: user.real_name ?? user.name ?? '', team_id: this.team.id } }
        : {}),
      ...(input.clientMsgId === undefined ? {} : { client_msg_id: input.clientMsgId }),
      ...(input.files === undefined ? {} : { files: input.files, upload: true }),
      ...(input.subtype === undefined ? {} : { subtype: input.subtype }),
      ...(root === undefined
        ? {}
        : {
            thread_ts: root.ts,
            parent_user_id: root.user ?? '',
            ...(input.broadcast === true ? { subtype: 'thread_broadcast', root: stripRoot(root) } : {}),
          }),
    }
    const list = this.all(input.channel)
    list.push(message)
    list.sort((a, b) => compareTs(a.ts, b.ts))

    if (root !== undefined) this.#touchRoot(input.channel, root.ts)

    if (input.silent === true) return message

    // Posting marks the sender's own view read, and replying follows the thread.
    if (input.user === this.selfId) {
      if (root === undefined) this.reads.set(input.channel, ts)
      else this.#subscribe(input.channel, root.ts, ts, false)
    }

    this.emit({ ...message, type: 'message', channel: input.channel, event_ts: ts })
    if (root !== undefined) {
      const updated = this.withThreadFields({ ...this.find(input.channel, root.ts)!, channel: input.channel })
      this.emit({
        type: 'message',
        subtype: 'message_replied',
        channel: input.channel,
        ts: this.eventTs(),
        event_ts: ts,
        hidden: true,
        message: {
          ts: updated.ts,
          thread_ts: updated.ts,
          ...(updated.user === undefined ? {} : { user: updated.user }),
          reply_count: updated.reply_count ?? 0,
          reply_users: updated.reply_users ?? [],
          reply_users_count: updated.reply_users_count ?? 0,
          latest_reply: updated.latest_reply ?? updated.ts,
        },
      })
    }
    this.#notify(conversation, message)
    return message
  }

  edit(channel: string, ts: string, text: string, editor: string): Message {
    const list = this.all(channel)
    const index = list.findIndex((m) => m.ts === ts)
    const previous = list[index]
    if (previous === undefined) throw new Error('message_not_found')
    const editTs = this.eventTs()
    const message: Message = {
      ...previous,
      text: toMrkdwn(text),
      blocks: textToBlocks(text),
      edited: { user: editor, ts: editTs },
    }
    list[index] = message
    this.emit({
      type: 'message',
      subtype: 'message_changed',
      channel,
      ts: editTs,
      event_ts: editTs,
      hidden: true,
      message: { ...message, channel },
      previous_message: previous,
    })
    return message
  }

  remove(channel: string, ts: string): void {
    const list = this.all(channel)
    const index = list.findIndex((m) => m.ts === ts)
    const previous = list[index]
    if (previous === undefined) throw new Error('message_not_found')
    const replies = this.replies(channel, ts)
    if (replies.length > 0) {
      // A root with replies becomes a tombstone, as in Slack.
      list[index] = { type: 'message', subtype: 'tombstone', ts, text: 'This message was deleted.', thread_ts: ts, hidden: true }
    } else {
      list.splice(index, 1)
      this.subscriptions.delete(`${channel}:${ts}`)
    }
    const eventTs = this.eventTs()
    if (isReply(previous) && previous.thread_ts !== undefined) this.#touchRoot(channel, previous.thread_ts)
    this.emit({
      type: 'message',
      subtype: 'message_deleted',
      channel,
      ts: eventTs,
      deleted_ts: ts,
      event_ts: eventTs,
      hidden: true,
      previous_message: previous,
    })
  }

  /** Marks a conversation read at `ts` (self, from any client). */
  markConversation(channel: string, ts: string): void {
    const conversation = this.conversations.get(channel)
    if (conversation === undefined) throw new Error('channel_not_found')
    this.reads.set(channel, ts)
    const entry = this.countEntry(conversation)
    const type =
      conversation.kind === 'im'
        ? 'im_marked'
        : conversation.kind === 'mpim'
          ? 'mpim_marked'
          : conversation.kind === 'private'
            ? 'group_marked'
            : 'channel_marked'
    const unread = this.main(channel).filter((m) => compareTs(m.ts, ts) > 0).length
    this.emit({
      type,
      channel,
      ts,
      unread_count: unread,
      unread_count_display: unread,
      mention_count: entry.mention_count,
      mention_count_display: entry.mention_count,
      event_ts: this.eventTs(),
    })
  }

  markThread(channel: string, threadTs: string, ts: string, read: boolean): Subscription {
    const sub = this.#subscribe(channel, threadTs, undefined, true)
    if (read) {
      sub.lastRead = ts
    } else {
      // Mark unread from `ts`: last_read becomes the reply before it, or the root.
      const before = this.replies(channel, threadTs).filter((r) => compareTs(r.ts, ts) < 0).at(-1)
      sub.lastRead = before?.ts ?? threadTs
    }
    this.emit({ type: 'thread_marked', subscription: this.subscriptionObject(sub), event_ts: this.eventTs() })
    return sub
  }

  subscribe(channel: string, threadTs: string, lastRead?: string): Subscription {
    const sub = this.#subscribe(channel, threadTs, lastRead, true)
    sub.subscribed = true
    this.emit({ type: 'thread_subscribed', subscription: this.subscriptionObject(sub), event_ts: this.eventTs() })
    return sub
  }

  unsubscribe(channel: string, threadTs: string, lastRead?: string): Subscription {
    const sub = this.#subscribe(channel, threadTs, lastRead, true)
    sub.subscribed = false
    this.emit({ type: 'thread_unsubscribed', subscription: this.subscriptionObject(sub), event_ts: this.eventTs() })
    return sub
  }

  react(channel: string, ts: string, name: string, user: string, add: boolean): 'already_reacted' | 'no_reaction' | undefined {
    const list = this.all(channel)
    const index = list.findIndex((m) => m.ts === ts)
    const message = list[index]
    if (message === undefined) throw new Error('message_not_found')
    const current = message.reactions ?? []
    const existing = current.find((r) => r.name === name)
    const has = existing?.users?.includes(user) === true
    if (add && has) return 'already_reacted'
    if (!add && !has) return 'no_reaction'
    const users = add ? [...(existing?.users ?? []), user] : (existing?.users ?? []).filter((u) => u !== user)
    const updated: Reaction = { name, users, count: users.length }
    const reactions: Reaction[] =
      existing === undefined ? [...current, updated] : current.map((r) => (r.name === name ? updated : r)).filter((r) => (r.count ?? 0) > 0)
    list[index] = reactions.length === 0 ? omitReactions(message) : { ...message, reactions }
    this.emit({
      type: add ? 'reaction_added' : 'reaction_removed',
      user,
      reaction: name,
      ...(message.user === undefined ? {} : { item_user: message.user }),
      item: { type: 'message', channel, ts },
      event_ts: this.eventTs(),
    })
    return undefined
  }

  /** Finds or creates the DM or group DM with `users` (self is implied). */
  open(users: ReadonlyArray<string>): { conversation: ConversationRecord; created: boolean } {
    const members = new Set([this.selfId, ...users])
    const kind: ConversationKind = members.size <= 2 ? 'im' : 'mpim'
    for (const c of this.conversations.values()) {
      if (c.kind === kind && c.members.size === members.size && [...members].every((m) => c.members.has(m))) {
        const wasOpen = c.isOpen
        c.isOpen = true
        if (!wasOpen) this.emit({ type: kind === 'im' ? 'im_open' : 'mpim_open', channel: c.id, user: this.selfId })
        return { conversation: c, created: false }
      }
    }
    const others = [...members].filter((m) => m !== this.selfId)
    const id = `${kind === 'im' ? 'D' : 'G'}${String(this.conversations.size + 1).padStart(3, '0')}NEW`
    const record: ConversationRecord = {
      id,
      name: kind === 'im' ? '' : `mpdm-${others.map((u) => this.users.get(u)?.name ?? u).join('--')}-1`,
      kind,
      members,
      created: this.clock.now(),
      topic: '',
      purpose: '',
      isOpen: true,
      archived: false,
    }
    this.addConversation(record)
    this.emit(
      kind === 'im'
        ? { type: 'im_created', channel: this.imObject(record), user: this.selfId }
        : { type: 'mpim_joined', channel: this.channelObject(record), user: this.selfId },
    )
    return { conversation: record, created: true }
  }

  typing(channel: string, user: string, threadTs?: string): void {
    this.emit({ type: 'user_typing', channel, user, ...(threadTs === undefined ? {} : { thread_ts: threadTs }) })
  }

  // Internals

  #subscribe(channel: string, threadTs: string, lastRead: string | undefined, keepFlag: boolean): Subscription {
    const key = `${channel}:${threadTs}`
    let sub = this.subscriptions.get(key)
    if (sub === undefined) {
      sub = { channel, threadTs, lastRead: lastRead ?? threadTs, subscribed: true, dateCreate: this.clock.now() }
      this.subscriptions.set(key, sub)
    } else {
      if (lastRead !== undefined) sub.lastRead = lastRead
      if (!keepFlag) sub.subscribed = true
    }
    return sub
  }

  /** Recomputes a root's reply counters after a reply was added or removed. */
  #touchRoot(channel: string, rootTs: string): void {
    const list = this.all(channel)
    const index = list.findIndex((m) => m.ts === rootTs)
    const root = list[index]
    if (root === undefined) return
    const replies = this.replies(channel, rootTs)
    const users = [...new Set(replies.map((r) => r.user).filter((u): u is string => u !== undefined))]
    const { reply_count: _c, reply_users: _u, reply_users_count: _n, latest_reply: _l, thread_ts: _t, ...rest } = root
    list[index] =
      replies.length === 0
        ? rest
        : {
            ...rest,
            thread_ts: rootTs,
            reply_count: replies.length,
            reply_users: users,
            reply_users_count: users.length,
            latest_reply: replies.at(-1)?.ts ?? rootTs,
          }
  }

  /** The server's notification candidate: DMs, mentions, and replies in followed threads, never from self. */
  #notify(conversation: ConversationRecord, message: Message): void {
    if (message.user === this.selfId) return
    const direct = conversation.kind === 'im' || conversation.kind === 'mpim'
    const sub = message.thread_ts === undefined ? undefined : this.subscription(conversation.id, message.thread_ts)
    const followed = sub?.subscribed === true && isReply(message)
    if (!direct && !this.mentionsSelf(message) && !followed) return
    const sender = this.users.get(message.user ?? '')
    const name = sender?.real_name ?? sender?.name ?? message.user ?? 'Someone'
    const where = conversation.kind === 'public' ? `#${conversation.name}` : conversation.kind === 'private' ? `#${conversation.name} (private)` : 'a direct message'
    this.emit({
      type: 'desktop_notification',
      channel: conversation.id,
      msg: message.ts,
      ts: message.ts,
      ...(message.thread_ts === undefined ? {} : { thread_ts: message.thread_ts }),
      ...(message.user === undefined ? {} : { user: message.user }),
      title: this.team.name,
      subtitle: direct ? name : `${name} in ${where}`,
      content: message.text ?? '',
      is_shared: false,
      is_channel_invite: false,
      is_mpdm: conversation.kind === 'mpim',
      event_ts: this.eventTs(),
    })
  }
}

function stripRoot(root: Message): Omit<Message, 'root'> {
  const { root: _root, ...rest } = root
  return rest
}

function omitReactions(message: Message): Message {
  const { reactions: _reactions, ...rest } = message
  return rest
}
