/**
 * One handler per Web API method. Each takes decoded arguments and returns
 * the success fields (without `ok`) or an `ApiError`. The server encodes the
 * result through the method's schema.
 */
import type { Message, MethodArgs, MethodName, MethodOk, SearchMatch, ThreadView } from '@juno/slack-schema'
import { compareTs, isReply, permalinkPath } from '@juno/slack-schema'
import { isKnownReaction } from './emojiNames.ts'
import { fileObject } from './files.ts'
import { blocksToText } from './richtext.ts'
import { edgeUserObject, type Workspace } from './state.ts'

export class ApiError {
  readonly error: string
  readonly status: number
  readonly retryAfter: number | undefined

  constructor(error: string, status = 200, retryAfter?: number) {
    this.error = error
    this.status = status
    this.retryAfter = retryAfter
  }
}

export interface MethodContext {
  readonly workspace: Workspace
  readonly baseUrl: string
  readonly socketUrl: () => string
  readonly uploadUrl: (fileId: string) => string
}

export type MethodResult<M extends MethodName> = Omit<MethodOk<M>, 'ok'> | ApiError

export type Handlers = { readonly [M in MethodName]: (ctx: MethodContext, args: MethodArgs<M>) => MethodResult<M> }

const DEFAULT_LIMIT = 28
/** `subscriptions.thread.getView` pages are capped server-side (research section 10). */
export const GET_VIEW_PAGE_CAP = 10

function cursorFor(ts: string): string {
  return Buffer.from(`ts:${ts}`).toString('base64')
}

function tsFromCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined || cursor === '') return undefined
  const decoded = Buffer.from(cursor, 'base64').toString('utf8')
  return decoded.startsWith('ts:') ? decoded.slice(3) : undefined
}

function inWindow(ts: string, oldest: string | undefined, latest: string | undefined, inclusive: boolean): boolean {
  if (oldest !== undefined && oldest !== '0' && oldest !== '') {
    const c = compareTs(ts, oldest)
    if (c < 0 || (c === 0 && !inclusive)) return false
  }
  if (latest !== undefined && latest !== '') {
    const c = compareTs(ts, latest)
    if (c > 0 || (c === 0 && !inclusive)) return false
  }
  return true
}

function requireConversation(ctx: MethodContext, channel: string, needMember = false) {
  const conversation = ctx.workspace.conversation(channel)
  if (conversation === undefined) return new ApiError('channel_not_found')
  const member = conversation.members.has(ctx.workspace.selfId)
  if (!member && (needMember || conversation.kind !== 'public')) return new ApiError(needMember ? 'not_in_channel' : 'channel_not_found')
  return conversation
}

function withChannel(ws: Workspace, channel: string, message: Message): Message {
  return ws.withThreadFields({ ...message, channel })
}

export const handlers: Handlers = {
  /** Every group; deleted ones only with `include_disabled`, as live. No `users`, no paging. */
  'usergroups.list': (ctx, args) => ({
    usergroups: [...ctx.workspace.usergroups.values()].filter((group) => args.include_disabled === true || (group.date_delete ?? 0) === 0),
  }),

  'auth.test': (ctx) => {
    const ws = ctx.workspace
    const self = ws.users.get(ws.selfId)
    return {
      url: `${ctx.baseUrl}/`,
      team: ws.team.name,
      user: self?.name ?? ws.selfId,
      team_id: ws.team.id,
      user_id: ws.selfId,
      ...(ws.team.enterprise_id === undefined ? {} : { enterprise_id: ws.team.enterprise_id }),
    }
  },

  /**
   * As recorded live: every channel of the workspace (member or not) as
   * metadata only, every DM, and no read state anywhere. Membership and read
   * state come from `client.counts`.
   */
  'client.userBoot': (ctx) => {
    const ws = ctx.workspace
    const self = ws.users.get(ws.selfId)
    if (self === undefined) return new ApiError('user_not_found')
    const records = [...ws.conversations.values()]
    const channels = records.filter((c) => c.kind !== 'im').map((c) => ws.bootChannelObject(c))
    const ims = records.filter((c) => c.kind === 'im').map((c) => ws.imObject(c))
    const cacheTs = `${Math.floor(ws.clock.now() / 1000)}.000000`
    return {
      self: { ...edgeUserObject(self), manual_presence: ws.manualPresence },
      team: { ...ws.team, url: `${ctx.baseUrl}/`, avatar_base_url: `${ctx.baseUrl}/avatars/` },
      prefs: ws.prefs,
      channels,
      ims,
      is_open: records.filter((c) => c.isOpen && (c.kind === 'im' || c.kind === 'mpim')).map((c) => c.id),
      starred: [],
      subteams: { self: ws.selfUsergroups },
      read_only_channels: [],
      thread_only_channels: [],
      has_more_mpdms: false,
      // Ts-formatted strings live, not numbers.
      emoji_cache_ts: cacheTs,
      app_commands_cache_ts: cacheTs,
      paid_features: [],
      can_access_client_v2: true,
      cache_ts: Math.floor(ws.clock.now() / 1000),
    }
  },

  /**
   * The user's own conversations with their read state, as recorded live. A
   * channel the user is not in is not listed. With `counts_last_fetched`
   * only the conversations that changed since then are listed (research
   * section 2 marks this Unknown; the fake takes the strict reading so the
   * sync cannot lean on an incremental answer being complete).
   */
  'client.counts': (ctx, args) => {
    const ws = ctx.workspace
    const wanted = args.channel_ids === undefined ? undefined : new Set(args.channel_ids)
    const since = args.counts_last_fetched
    const records = [...ws.conversations.values()].filter(
      (c) => c.members.has(ws.selfId) && (wanted === undefined || wanted.has(c.id)) && (since === undefined || ws.changedSince(c.id, since)),
    )
    const channels = records.filter((c) => c.kind === 'public' || c.kind === 'private').map((c) => ws.countEntry(c))
    const ims = records.filter((c) => c.kind === 'im').map((c) => ws.countEntry(c))
    const mpims = records.filter((c) => c.kind === 'mpim').map((c) => ws.countEntry(c))
    // `threads` carries no `timestamp` in client.counts (it does in getView's threads_state).
    const { timestamp: _timestamp, ...threads } = ws.threadCounts()
    return {
      channels,
      ims,
      mpims,
      threads,
      channel_badges: {
        channels: channels.filter((c) => c.has_unreads).length,
        dms: [...ims, ...mpims].filter((c) => c.has_unreads).length,
        app_dms: 0,
        thread_mentions: threads.mention_count,
        thread_unreads: Object.values(threads.unread_count_by_channel ?? {}).reduce((a, b) => a + b, 0),
      },
      counts_last_fetched: Math.floor(ws.clock.now() / 1000),
    }
  },

  'dnd.info': () => ({ dnd_enabled: false, next_dnd_start_ts: 0, next_dnd_end_ts: 0, snooze_enabled: false }),

  'users.prefs.get': (ctx, args) => {
    const prefs = ctx.workspace.prefs
    if (args.prefs === undefined) return { prefs }
    return { prefs: Object.fromEntries(args.prefs.split(',').filter((name) => name in prefs).map((name) => [name, prefs[name]])) }
  },

  /** Stores each pref and sends a `pref_change` for it, as Slack is expected to (research section 7). */
  'users.prefs.set': (ctx, args) => {
    let changes: unknown
    try {
      changes = JSON.parse(args.prefs)
    } catch {
      return new ApiError('invalid_prefs')
    }
    if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) return new ApiError('invalid_prefs')
    const ws = ctx.workspace
    for (const [name, value] of Object.entries(changes)) {
      ws.prefs = { ...ws.prefs, [name]: value }
      ws.emit({ type: 'pref_change', name, value })
    }
    return {}
  },

  'client.getWebSocketURL': (ctx) => ({
    primary_websocket_url: ctx.socketUrl(),
    fallback_websocket_url: ctx.socketUrl(),
    ttl_seconds: 60,
    routing_context: 'fake',
  }),

  'api.getFlannelHttpUrl': (ctx) => ({ url: `${ctx.baseUrl}/edge`, ttl_seconds: 3600 }),

  'conversations.history': (ctx, args) => {
    const ws = ctx.workspace
    const conversation = requireConversation(ctx, args.channel)
    if (conversation instanceof ApiError) return conversation
    const inclusive = args.inclusive ?? false
    const before = tsFromCursor(args.cursor)
    const window = ws
      .main(args.channel)
      .filter((m) => inWindow(m.ts, args.oldest, args.latest, inclusive))
      .filter((m) => before === undefined || compareTs(m.ts, before) < 0)
      .toReversed()
    const limit = args.limit ?? DEFAULT_LIMIT
    const page = window.slice(0, limit)
    const hasMore = window.length > limit
    const last = page.at(-1)
    return {
      messages: page.map((m) => withChannel(ws, args.channel, m)),
      has_more: hasMore,
      is_limited: false,
      pin_count: 0,
      channel_actions_count: 0,
      channel_actions_ts: null,
      response_metadata: hasMore && last !== undefined ? { next_cursor: cursorFor(last.ts) } : { next_cursor: '' },
    }
  },

  'conversations.replies': (ctx, args) => {
    const ws = ctx.workspace
    const conversation = requireConversation(ctx, args.channel)
    if (conversation instanceof ApiError) return conversation
    const root = ws.find(args.channel, args.ts)
    if (root === undefined || isReply(root)) return new ApiError('thread_not_found')
    const inclusive = args.inclusive ?? false
    const after = tsFromCursor(args.cursor)
    const thread = [root, ...ws.replies(args.channel, args.ts)]
      .filter((m) => m.ts === root.ts || inWindow(m.ts, args.oldest, args.latest, inclusive))
      .filter((m) => m.ts === root.ts || after === undefined || compareTs(m.ts, after) > 0)
    const limit = args.limit ?? DEFAULT_LIMIT
    const page = thread.slice(0, limit)
    const hasMore = thread.length > limit
    const last = page.at(-1)
    return {
      messages: page.map((m) => withChannel(ws, args.channel, m)),
      has_more: hasMore,
      response_metadata: hasMore && last !== undefined ? { next_cursor: cursorFor(last.ts) } : { next_cursor: '' },
    }
  },

  'conversations.view': (ctx, args) => {
    const ws = ctx.workspace
    const id = args.channel ?? [...ws.conversations.values()].find((c) => c.name === 'general')?.id ?? [...ws.conversations.keys()][0]
    if (id === undefined) return new ApiError('channel_not_found')
    const conversation = requireConversation(ctx, id)
    if (conversation instanceof ApiError) return conversation
    const count = args.count ?? DEFAULT_LIMIT
    const main = ws.main(id).toReversed()
    const messages = main.slice(0, count).map((m) => withChannel(ws, id, m))
    const authors = new Set(messages.map((m) => m.user).filter((u): u is string => u !== undefined))
    return {
      channel: ws.channelObject(conversation),
      messages,
      has_more: main.length > count,
      users: [...authors].flatMap((u) => ws.users.get(u) ?? []),
    }
  },

  'conversations.info': (ctx, args) => {
    const conversation = requireConversation(ctx, args.channel)
    if (conversation instanceof ApiError) return conversation
    return { channel: ctx.workspace.channelObject(conversation) }
  },

  'conversations.mark': (ctx, args) => {
    const conversation = requireConversation(ctx, args.channel, true)
    if (conversation instanceof ApiError) return conversation
    ctx.workspace.markConversation(args.channel, args.ts)
    return {}
  },

  'conversations.open': (ctx, args) => {
    const ws = ctx.workspace
    if (args.channel !== undefined) {
      const conversation = ws.conversation(args.channel)
      if (conversation === undefined || !conversation.members.has(ws.selfId)) return new ApiError('channel_not_found')
      const wasOpen = conversation.isOpen
      conversation.isOpen = true
      return { channel: ws.channelObject(conversation), no_op: wasOpen, already_open: wasOpen }
    }
    const users = (args.users ?? '').split(',').map((u) => u.trim()).filter((u) => u !== '')
    if (users.length === 0) return new ApiError('users_list_not_supplied')
    if (users.some((u) => !ws.users.has(u))) return new ApiError('user_not_found')
    const { conversation, created } = ws.open(users)
    return { channel: ws.channelObject(conversation), no_op: !created, already_open: !created }
  },

  'subscriptions.thread.getView': (ctx, args) => {
    const ws = ctx.workspace
    const views: Array<{ view: ThreadView; latest: string }> = []
    for (const sub of ws.subscriptions.values()) {
      if (!sub.subscribed) continue
      const root = ws.find(sub.channel, sub.threadTs)
      if (root === undefined) continue
      const replies = ws.replies(sub.channel, sub.threadTs)
      if (replies.length === 0) continue
      const latest = replies.at(-1)?.ts ?? root.ts
      if (args.current_ts !== undefined && compareTs(latest, args.current_ts) >= 0) continue
      if (args.channel_id !== undefined && args.channel_id !== sub.channel) continue
      const full = withChannel(ws, sub.channel, root)
      const unread = replies.filter((r) => compareTs(r.ts, sub.lastRead) > 0 && r.user !== ws.selfId)
      views.push({
        latest,
        view: {
          root_msg: { ...full, channel: sub.channel, thread_ts: root.ts, reply_count: replies.length, latest_reply: latest },
          // Live, a thread with unread replies carries `unread_replies` and no `latest_replies`; a read one the reverse (research section 10, "Live checks").
          ...(unread.length > 0
            ? { unread_replies: unread.map((r) => withChannel(ws, sub.channel, r)) }
            : { latest_replies: replies.slice(-3).map((r) => withChannel(ws, sub.channel, r)) }),
        },
      })
    }
    views.sort((a, b) => compareTs(b.latest, a.latest))
    // Slack returns at most 10 threads per page whatever `limit` says (research section 10).
    const limit = Math.min(args.limit ?? GET_VIEW_PAGE_CAP, GET_VIEW_PAGE_CAP)
    const page = views.slice(0, limit)
    const state = ws.threadCounts()
    return {
      threads: page.map((v) => v.view),
      has_more: views.length > limit,
      total_unread_replies: Object.values(state.unread_count_by_channel ?? {}).reduce((a, b) => a + b, 0),
      ...(args.fetch_threads_state === true ? { threads_state: state } : {}),
    }
  },

  'subscriptions.thread.mark': (ctx, args) => {
    const ws = ctx.workspace
    if (ws.find(args.channel, args.thread_ts) === undefined) return new ApiError('thread_not_found')
    ws.markThread(args.channel, args.thread_ts, args.ts, args.read)
    return {}
  },

  'subscriptions.thread.add': (ctx, args) => {
    const ws = ctx.workspace
    if (ws.find(args.channel, args.thread_ts) === undefined) return new ApiError('thread_not_found')
    return { subscription: ws.subscriptionObject(ws.subscribe(args.channel, args.thread_ts, args.last_read)) }
  },

  'subscriptions.thread.remove': (ctx, args) => {
    const ws = ctx.workspace
    if (ws.find(args.channel, args.thread_ts) === undefined) return new ApiError('thread_not_found')
    return { subscription: ws.subscriptionObject(ws.unsubscribe(args.channel, args.thread_ts, args.last_read)) }
  },

  'presence.set': (ctx, args) => {
    ctx.workspace.manualPresence = args.presence
    ctx.workspace.emit({ type: 'manual_presence_change', presence: args.presence, user: ctx.workspace.selfId })
    return {}
  },
  'chat.postMessage': (ctx, args) => {
    const ws = ctx.workspace
    const conversation = requireConversation(ctx, args.channel, true)
    if (conversation instanceof ApiError) return conversation
    if (conversation.archived) return new ApiError('is_archived')
    const text = args.text ?? args.markdown_text
    if ((text === undefined || text === '') && (args.blocks === undefined || args.blocks.length === 0)) return new ApiError('no_text')
    if (text !== undefined && text.length > 40_000) return new ApiError('msg_too_long')
    if (args.thread_ts !== undefined) {
      const root = ws.find(args.channel, args.thread_ts)
      if (root === undefined || isReply(root)) return new ApiError('thread_not_found')
    }
    const message = ws.post({
      channel: args.channel,
      user: ws.selfId,
      // Slack keeps what the client escaped and escapes what it did not.
      ...(text === undefined ? {} : { text, mrkdwn: args.text !== undefined }),
      ...(args.blocks === undefined ? {} : { blocks: args.blocks }),
      ...(args.thread_ts === undefined ? {} : { threadTs: args.thread_ts }),
      ...(args.reply_broadcast === undefined ? {} : { broadcast: args.reply_broadcast }),
      clientMsgId: args.client_msg_id,
    })
    return { channel: args.channel, ts: message.ts, message: withChannel(ws, args.channel, message) }
  },

  'chat.update': (ctx, args) => {
    const ws = ctx.workspace
    const conversation = requireConversation(ctx, args.channel, true)
    if (conversation instanceof ApiError) return conversation
    const existing = ws.find(args.channel, args.ts)
    if (existing === undefined) return new ApiError('message_not_found')
    if (existing.user !== ws.selfId) return new ApiError('cant_update_message')
    const text = args.text ?? args.markdown_text
    if ((text === undefined || text === '') && args.blocks === undefined) return new ApiError('no_text')
    const message = ws.edit(args.channel, args.ts, text ?? '', ws.selfId, args.text !== undefined)
    // chat.update returns a partial message; its timestamp is on the envelope.
    return { channel: args.channel, ts: args.ts, text: message.text ?? '', message: { text: message.text ?? '', user: ws.selfId } }
  },

  'chat.delete': (ctx, args) => {
    const ws = ctx.workspace
    const conversation = requireConversation(ctx, args.channel, true)
    if (conversation instanceof ApiError) return conversation
    const existing = ws.find(args.channel, args.ts)
    if (existing === undefined) return new ApiError('message_not_found')
    if (existing.user !== ws.selfId) return new ApiError('cant_delete_message')
    ws.remove(args.channel, args.ts)
    return { channel: args.channel, ts: args.ts }
  },

  'reactions.add': (ctx, args) => reaction(ctx, args, true),
  'reactions.remove': (ctx, args) => reaction(ctx, args, false),

  'search.modules.messages': (ctx, args) => {
    const ws = ctx.workspace
    const query = parseQuery(args.query)
    const matches: SearchMatch[] = []
    for (const conversation of ws.conversations.values()) {
      if (!conversation.members.has(ws.selfId) && conversation.kind !== 'public') continue
      if (query.channel !== undefined && query.channel !== conversation.name && query.channel !== conversation.id) continue
      for (const message of ws.all(conversation.id)) {
        if (message.subtype === 'tombstone') continue
        const full = withChannel(ws, conversation.id, message)
        const inThread = isReply(full) || (full.reply_count ?? 0) > 0
        if (query.isThread && !inThread) continue
        if (query.after !== undefined && compareTs(full.ts, query.after) <= 0) continue
        if (query.before !== undefined && compareTs(full.ts, query.before) >= 0) continue
        if (query.from !== undefined && full.user !== query.from && ws.users.get(full.user ?? '')?.name !== query.from) continue
        const text = (full.text ?? '').toLowerCase()
        if (!query.terms.every((term) => text.includes(term))) continue
        const user = full.user === undefined ? undefined : ws.users.get(full.user)
        // The module returns one message per item; thread fields require extra_message_data.
        matches.push({
          iid: `${conversation.id}-${full.ts}`,
          team: ws.team.id,
          channel: {
            id: conversation.id,
            name: conversation.name,
            is_archived: conversation.archived,
            is_group: conversation.kind === 'private',
            is_shared: false,
            is_ext_shared: false,
            is_org_shared: false,
            ...(conversation.kind === 'im' ? { user: [...conversation.members].find((id) => id !== ws.selfId) } : {}),
            is_channel: conversation.kind === 'public' || conversation.kind === 'private',
            is_im: conversation.kind === 'im',
            is_mpim: conversation.kind === 'mpim',
            is_private: conversation.kind !== 'public',
          },
          messages: [
            {
              iid: `${conversation.id}-${full.ts}-m`,
              ts: full.ts,
              ...(args.extra_message_data === 1 ? { ...(inThread ? { thread_ts: full.thread_ts ?? full.ts } : {}), ...(full.reply_count === undefined ? {} : { reply_count: full.reply_count }), ...(full.latest_reply === undefined ? {} : { latest_reply: full.latest_reply }) } : {}),
              text: full.text ?? '',
              ...(full.user === undefined ? {} : { user: full.user }),
              ...(user?.name === undefined ? {} : { username: user.name }),
              permalink: `${ctx.baseUrl}${permalinkPath(conversation.id, full.ts, full.thread_ts)}`,
            },
          ],
        })
      }
    }
    // Slack sorts by relevance unless asked for `sort=timestamp`. Relevance is not time order, so the fake
    // uses a stable shuffle of the ids: a client that assumes newest-first without asking gets an arbitrary sample.
    if (args.sort === 'timestamp') {
      const tsOf = (match: SearchMatch) => match.messages?.[0]?.ts ?? match.ts ?? ''
      matches.sort((a, b) => (args.sort_dir === 'asc' ? compareTs(tsOf(a), tsOf(b)) : compareTs(tsOf(b), tsOf(a))))
    } else {
      matches.sort((a, b) => relevance(a.iid ?? '') - relevance(b.iid ?? ''))
    }
    const perPage = args.count ?? 20
    const page = Math.max(1, args.page ?? 1)
    const start = (page - 1) * perPage
    const items = matches.slice(start, start + perPage)
    const pageCount = Math.max(1, Math.ceil(matches.length / perPage))
    return {
      query: args.query,
      module: 'messages',
      items,
      pagination: {
        total_count: matches.length,
        page,
        per_page: perPage,
        page_count: pageCount,
        first: matches.length === 0 ? 0 : start + 1,
        last: start + items.length,
      },
      total: matches.length,
    }
  },

  'files.getUploadURL': (ctx, args) => {
    const ws = ctx.workspace
    const id = `F0${String(ws.files.size + 1).padStart(4, '0')}`
    ws.files.set(id, {
      id,
      name: args.filename,
      length: args.length,
      user: ws.selfId,
      created: ws.clock.now(),
      bytes: undefined,
      mimetype: 'application/octet-stream',
      ...(ws.holdThumbnails ? { thumbsHeld: true } : {}),
    })
    return { upload_url: ctx.uploadUrl(id), file: id }
  },

  'files.completeUpload': (ctx, args) => {
    const ws = ctx.workspace
    const stored = []
    for (const entry of args.files) {
      const file = ws.files.get(entry.id)
      if (file?.bytes === undefined) return new ApiError('file_not_found')
      stored.push({ file, title: entry.title })
    }
    for (const { file, title } of stored) if (title !== undefined && title !== '') file.title = title
    return { files: stored.map(({ file }) => fileObject(ctx.baseUrl, file)) }
  },

  /** Posts one message by self carrying the files, like `chat.postMessage` (same events). */
  'files.share': (ctx, args) => {
    const ws = ctx.workspace
    if (args.files.length === 0) return new ApiError('invalid_arguments')
    const conversation = requireConversation(ctx, args.channel, true)
    if (conversation instanceof ApiError) return conversation
    if (conversation.archived) return new ApiError('is_archived')
    const stored = []
    for (const id of args.files) {
      const file = ws.files.get(id)
      if (file?.bytes === undefined) return new ApiError('file_not_found')
      stored.push(file)
    }
    if (args.thread_ts !== undefined) {
      const root = ws.find(args.channel, args.thread_ts)
      if (root === undefined || isReply(root)) return new ApiError('thread_not_found')
    }
    const files = stored.map((file) => fileObject(ctx.baseUrl, file, conversation.kind === 'public'))
    const text = args.comment ?? (args.blocks === undefined ? undefined : blocksToText(args.blocks))
    ws.post({
      channel: args.channel,
      user: ws.selfId,
      ...(text === undefined ? {} : { text }),
      ...(args.blocks === undefined ? {} : { blocks: args.blocks }),
      ...(args.thread_ts === undefined ? {} : { threadTs: args.thread_ts }),
      ...(args.broadcast === undefined ? {} : { broadcast: args.broadcast }),
      clientMsgId: args.client_msg_id,
      files,
    })
    return { files }
  },

  'files.info': (ctx, args) => {
    if (!ctx.workspace.filesInfoSupported) return new ApiError('unknown_method')
    const file = ctx.workspace.files.get(args.file)
    if (file?.bytes === undefined) return new ApiError('file_not_found')
    return { file: fileObject(ctx.baseUrl, file) }
  },

}

function reaction(ctx: MethodContext, args: MethodArgs<'reactions.add'>, add: boolean): MethodResult<'reactions.add'> {
  const ws = ctx.workspace
  const conversation = requireConversation(ctx, args.channel, true)
  if (conversation instanceof ApiError) return conversation
  if (ws.find(args.channel, args.timestamp) === undefined) return new ApiError('message_not_found')
  if (!isKnownReaction(args.name, new Set(ws.emoji.keys()))) return new ApiError('invalid_name')
  const failure = ws.react(args.channel, args.timestamp, args.name, ws.selfId, add)
  return failure === undefined ? {} : new ApiError(failure)
}

interface ParsedQuery {
  terms: string[]
  isThread: boolean
  after?: string
  before?: string
  channel?: string
  from?: string
}

/** Understands `is:thread`, `after:YYYY-MM-DD`, `before:`, `in:#channel`, `from:@user` and free words. */
function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], isThread: false }
  for (const token of query.split(/\s+/).filter((t) => t !== '')) {
    const [key, value] = token.includes(':') ? [token.slice(0, token.indexOf(':')), token.slice(token.indexOf(':') + 1)] : ['', token]
    if (key === 'is' && value === 'thread') parsed.isThread = true
    else if (key === 'after') parsed.after = `${Math.floor(Date.parse(`${value}T23:59:59.999Z`) / 1000)}.999999`
    else if (key === 'before') parsed.before = `${Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 1000)}.000000`
    else if (key === 'in') parsed.channel = value.replace(/^#/, '')
    else if (key === 'from') parsed.from = value.replace(/^@/, '')
    else parsed.terms.push(token.toLowerCase())
  }
  return parsed
}

/** A stable pseudo-score for a match id (FNV-1a), so relevance order is deterministic but unrelated to time. */
function relevance(id: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}
