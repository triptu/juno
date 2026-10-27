import { parseQuery, termMatches, highlightExtract } from './search-query'
/**
 * One handler per Web API method. Each takes decoded arguments and returns
 * the success fields (without `ok`) or an `ApiError`. The server encodes the
 * result through the method's schema.
 */
import { threadIndex } from './threadViews.ts'
import type { CountEntry, Message, MethodArgs, MethodName, MethodOk, SearchMatch, ThreadView } from '@juno/slack-schema'
import { compareTs, isReply, permalinkPath, Ts } from '@juno/slack-schema'
import { fileObject } from './files.ts'
import { withListedReactors } from './reactors.ts'
import { blocksToText } from './richtext.ts'
import { edgeUserObject, NEVER_READ, type Workspace, type ConversationRecord } from './state.ts'

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

export function requireConversation(ctx: MethodContext, channel: string, needMember = false) {
  const conversation = ctx.workspace.conversation(channel)
  if (conversation === undefined) return new ApiError('channel_not_found')
  const member = conversation.members.has(ctx.workspace.selfId)
  if (!member && (needMember || conversation.kind !== 'public')) return new ApiError(needMember ? 'not_in_channel' : 'channel_not_found')
  return conversation
}

/** A message as pages carry it: its channel, thread fields, and reactors cut as Slack cuts them (`reactors.ts`). */
function withChannel(ws: Workspace, channel: string, message: Message): Message {
  return ws.withThreadFields({ ...withListedReactors(message), channel })
}

/** Conditional pages keep paging over all messages, even when their bodies are omitted. */
function conditionalPage(messages: Message[], cached: Readonly<Record<string, Ts>> | undefined, version: (ts: Ts) => Ts) {
  if (cached === undefined) return { messages }
  const unchanged = messages.filter((m) => cached[m.ts] === version(m.ts))
  const bodies = messages.filter((m) => cached[m.ts] !== version(m.ts))
  return {
    messages: bodies,
    unchanged_messages: unchanged.map((m) => m.ts),
    latest_updates: Object.fromEntries(bodies.map((m) => [m.ts, version(m.ts)])),
    deleted: [],
  }
}

export const coreMethods = {
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
   * channel the user is not in is not listed. An incremental response keeps
   * unchanged conversations as { id, last_read }, matching the live probe.
   * The sync must also tolerate omitted conversations as Unknown.
   */
  'client.counts': (ctx, args) => {
    const ws = ctx.workspace
    const wanted = args.channel_ids === undefined ? undefined : new Set(args.channel_ids)
    const since = args.counts_last_fetched
    // As recorded live, a closed group DM is left out (research section 2).
    const records = [...ws.conversations.values()].filter(
      (c) => c.members.has(ws.selfId) && (c.kind !== 'mpim' || c.isOpen) && (wanted === undefined || wanted.has(c.id)),
    )
    const entry = (c: (typeof records)[number]): CountEntry => {
      const full = ws.countEntry(c)
      return since === undefined || ws.changedSince(c.id, since) ? full : { id: full.id, last_read: full.last_read }
    }
    const channels = records.filter((c) => c.kind === 'public' || c.kind === 'private').map(entry)
    const ims = records.filter((c) => c.kind === 'im').map(entry)
    const mpims = records.filter((c) => c.kind === 'mpim').map(entry)
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
      .filter((m) => compareTs(m.ts, ws.retainedSince.get(args.channel) ?? NEVER_READ) >= 0)
      .filter((m) => before === undefined || compareTs(m.ts, before) < 0)
      .toReversed()
    const limit = args.limit ?? DEFAULT_LIMIT
    const page = window.slice(0, limit)
    const hasMore = window.length > limit
    const last = page.at(-1)
    return {
      ...conditionalPage(page.map((m) => withChannel(ws, args.channel, m)), args.cached_latest_updates, (ts) => ws.messageVersions.get(`${args.channel}:${ts}`) ?? ts),
      has_more: hasMore,
      ...(args.include_mutation_timestamps === true ? { mutation_timestamps: { updated: ws.countEntry(conversation).updated, history_invalid: ws.countEntry(conversation).history_invalid } } : {}),
      is_limited: ws.retainedSince.has(args.channel),
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
      .filter((m) => m.ts === root.ts || compareTs(m.ts, ws.retainedSince.get(args.channel) ?? NEVER_READ) >= 0)
      .filter((m) => m.ts === root.ts || after === undefined || compareTs(m.ts, after) > 0)
    const limit = args.limit ?? DEFAULT_LIMIT
    const page = thread.slice(0, limit)
    const hasMore = thread.length > limit
    const last = page.at(-1)
    return {
      ...conditionalPage(page.map((m) => withChannel(ws, args.channel, m)), args.cached_latest_updates, (ts) => ws.messageVersions.get(`${args.channel}:${ts}`) ?? ts),
      has_more: hasMore,
      is_limited: ws.retainedSince.has(args.channel),
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

  'conversations.create': (ctx, args) => {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(args.name)) return new ApiError('invalid_name_specials')
    const created = ctx.workspace.create(args.name, args.is_private === true ? 'private' : 'public')
    return created === 'name_taken' ? new ApiError('name_taken') : { channel: ctx.workspace.channelObject(created) }
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
    const index = threadIndex(ws)
    const views = index.flatMap(({ sub, root, replies }) => {
      const latest = replies.at(-1)?.ts
      return root === undefined || latest === undefined ? [] : [{ sub, root, replies, latest, order: BigInt(latest.replace('.', '')) }]
    }).filter(({ sub, latest }) =>
      (args.current_ts === undefined || compareTs(latest, args.current_ts) < 0) &&
      (args.channel_id === undefined || args.channel_id === sub.channel),
    ).toSorted((a, b) => a.order > b.order ? -1 : a.order < b.order ? 1 : 0)
    // Slack caps each page at ten; only that page needs full response bodies.
    const limit = Math.min(args.limit ?? GET_VIEW_PAGE_CAP, GET_VIEW_PAGE_CAP)
    const page: ThreadView[] = views.slice(0, limit).map(({ sub, root, replies, latest }) => {
      const full = withChannel(ws, sub.channel, root)
      const unread = replies.filter((r) => compareTs(r.ts, sub.lastRead) > 0 && r.user !== ws.selfId)
      return {
        root_msg: { ...full, channel: sub.channel, thread_ts: root.ts, reply_count: replies.length, latest_reply: latest },
        // An unread thread carries unread_replies; a read thread carries latest_replies.
        ...(unread.length > 0
          ? { unread_replies: unread.map((r) => withChannel(ws, sub.channel, r)) }
          : { latest_replies: replies.slice(-3).map((r) => withChannel(ws, sub.channel, r)) }),
      }
    })
    const state = ws.threadCounts(index)
    return {
      threads: page.map((view) => ws.threadViewRowOverrides.has(view.root_msg.ts) ? ws.threadViewRowOverrides.get(view.root_msg.ts) : view),
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
    if (args.draft_id !== undefined) ws.drafts.sent(args.draft_id, message.ts)
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
    if (args.reply_broadcast === true) {
      // Observed live: content and a broadcast in one call are refused, and so are a root, a message outside a thread and a reply already sent.
      if (text !== undefined || args.blocks !== undefined) return new ApiError('no_dual_broadcast_content_update')
      if (!isReply(existing) || existing.subtype === 'thread_broadcast') return new ApiError('cant_broadcast_message')
      const message = ws.broadcast(args.channel, args.ts)
      const { ts: _ts, ...partial } = withChannel(ws, args.channel, message)
      return { channel: args.channel, ts: args.ts, text: message.text ?? '', message: partial }
    }
    if ((text === undefined || text === '') && args.blocks === undefined) return new ApiError('no_text')
    const message = ws.edit(args.channel, args.ts, text ?? '', ws.selfId, args.text !== undefined, args.blocks)
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

  'search.modules.messages': (ctx, args) => {
    const ws = ctx.workspace
    const query = parseQuery(args.query, ws.users.get(ws.selfId)?.tz ?? 'UTC')
    const matches: SearchMatch[] = []
    for (const conversation of ws.conversations.values()) {
      if (!conversation.members.has(ws.selfId) && conversation.kind !== 'public') continue
      const channelNames = [conversation.id.toLowerCase(), conversation.name.toLowerCase(), ...(conversation.kind === 'im' ? [...conversation.members].filter((id) => id !== ws.selfId).map((id) => id.toLowerCase()) : [])]
      if (query.channels.length > 0 && !query.channels.some((id) => channelNames.includes(id))) continue
      if (query.excludeChannels.some((id) => channelNames.includes(id))) continue
      for (const message of ws.all(conversation.id)) {
        if (message.subtype === 'tombstone') continue
        const full = withChannel(ws, conversation.id, message)
        const inThread = isReply(full) || (full.reply_count ?? 0) > 0
        if (query.thread && !inThread) continue
        if (Number(full.ts) < query.earliest || Number(full.ts) >= query.latest) continue
        const user = full.user === undefined ? undefined : ws.users.get(full.user)
        const names = [full.user, user?.name, user?.real_name, user?.profile?.display_name, full.user === ws.selfId ? 'me' : undefined].flatMap((n) => n === undefined ? [] : [n.toLowerCase()])
        if (query.from.length > 0 && !query.from.some((id) => names.includes(id))) continue
        if (query.excludeFrom.some((id) => names.includes(id))) continue
        if (args.search_exclude_bots && (full.bot_id != null || full.bot_profile !== undefined || full.subtype === 'bot_message' || user?.is_bot)) continue
        const text = [full.text ?? '', ...((full.attachments ?? []).flatMap((a) => [a.title ?? '', a.text ?? '', a.fallback ?? '']))].join(' ')
        if (!query.terms.every((term) => term.negative !== termMatches(text, term.value))) continue
        if (!query.has.every((has) => {
          if (has === 'file') return (full.files?.length ?? 0) > 0
          if (has === 'link') return /https?:\/\//.test((full.text ?? '') + JSON.stringify(full.attachments ?? []))
          if (has === 'reaction') return full.reactions?.some((r) => (r.count ?? 0) > 0) === true
          if (has === 'pin') return (full.pinned_to?.length ?? 0) > 0
          return full.reactions?.some((r) => (r.count ?? 0) > 0 && r.name === has.slice(1, -1)) === true
        })) continue
        matches.push(searchItem(ctx, args, conversation, full, query.terms))
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
    const perPage = args.count !== undefined && [20, 50, 100].includes(args.count) ? args.count : 20
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
      filter_suggestions: {
        from: facets(matches.flatMap((m) => m.messages?.flatMap((m) => m.user === undefined ? [] : [m.user]) ?? [])),
        in: facets(matches.map((m) => typeof m.channel === 'string' ? m.channel : m.channel.id)),
      },
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
    const posted = ws.post({
      channel: args.channel,
      user: ws.selfId,
      ...(text === undefined ? {} : { text }),
      ...(args.blocks === undefined ? {} : { blocks: args.blocks }),
      ...(args.thread_ts === undefined ? {} : { threadTs: args.thread_ts }),
      ...(args.broadcast === undefined ? {} : { broadcast: args.broadcast }),
      clientMsgId: args.client_msg_id,
      files,
    })
    if (args.draft_id !== undefined) ws.drafts.sent(args.draft_id, posted.ts)
    return { files }
  },

  'files.info': (ctx, args) => {
    if (!ctx.workspace.filesInfoSupported) return new ApiError('unknown_method')
    const file = ctx.workspace.files.get(args.file)
    if (file?.bytes === undefined) return new ApiError('file_not_found')
    return { file: fileObject(ctx.baseUrl, file) }
  },

} satisfies Partial<Handlers>

function facets(ids: ReadonlyArray<string>) {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts].map(([id, facet_count]) => ({ id, facet_count })).toSorted((a, b) => b.facet_count - a.facet_count || a.id.localeCompare(b.id))
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

function searchItem(ctx: MethodContext, args: MethodArgs<'search.modules.messages'>, conversation: ConversationRecord, full: Message, terms: ReturnType<typeof parseQuery>['terms']): SearchMatch {
  const ws = ctx.workspace
  const user = full.user === undefined ? undefined : ws.users.get(full.user)
  const inThread = isReply(full) || (full.reply_count ?? 0) > 0
  return {
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
              ...(full.files === undefined ? {} : { files: full.files }),
              ...(full.reactions === undefined ? {} : { reactions: full.reactions }),
              ...(full.attachments === undefined ? {} : { attachments: full.attachments }),
              ...(full.bot_profile === undefined ? {} : { bot_profile: full.bot_profile }),
              ...(full.bot_id == null ? {} : { bot_id: full.bot_id }),
              ...(full.subtype === undefined ? {} : { subtype: full.subtype }),
              ...(args.extracts === 1 ? { extracts: [highlightExtract(full.text ?? '', terms, args.highlight === 1, args.max_extract_len)], blocks_extracts: [], blocks_extracts_typed: [] } : {}),
              ...(full.user === undefined ? {} : { user: full.user }),
              ...(user?.name === undefined ? {} : { username: user.name }),
              permalink: `${ctx.baseUrl}${permalinkPath(conversation.id, full.ts, full.thread_ts)}`,
            },
          ],
        }
}
