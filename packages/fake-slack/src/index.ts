/**
 * @juno/fake-slack: a fake Slack for tests and development.
 *
 * `startFakeSlack()` returns the running fake with its control API. The same
 * controls are reachable over HTTP as `POST /control/<name>` with a JSON body,
 * for tests that drive a built app.
 */
import type { Message, RtmFrame } from '@juno/slack-schema'
import { features } from './features/index.ts'
import { mergeFeatures, type FakeControls } from './features/registry.ts'
import type { Handlers } from './methods.ts'
import { Clock } from './clock.ts'
import { seedWorkspace, SELF_ID, TEAM } from './fixtures.ts'
import { FakeServer, type CallRecord, type ReceivedFrame, type GatedCall, type GateDecision, type Session } from './server.ts'
import { asTs, Workspace, type Subscription } from './state.ts'
import { fileObject, partialFileObject } from './files.ts'
import { samplePng } from './samples.ts'

export { AUTO_AWAY_MILLIS } from './server.ts'
export type { CallRecord, ReceivedFrame, GatedCall, GateDecision, Session } from './server.ts'
export type { Subscription } from './state.ts'
export { Workspace } from './state.ts'
export { CONVERSATIONS, SELF_ID, TEAM, seedWorkspace } from './fixtures.ts'
export { samplePdf, samplePng } from './samples.ts'

export interface FakeSlackOptions {
  /** 0 picks a free port. */
  readonly port?: number
  readonly host?: string
  /** Freeze the clock at this time (ms). Default: real time. */
  readonly now?: number
  /** Replace the default seed. */
  readonly seed?: (workspace: Workspace, avatarBase: string) => void
  /** Every Web API and edge call waits this long before it runs (`setLatency`). Default 0. */
  readonly latencyMillis?: number
  /** Enterprise Grid: the team carries this `enterprise_id`, in `auth.test`, `client.userBoot` and the client page. */
  readonly enterpriseId?: string
}

export interface Credentials {
  readonly url: string
  readonly token: string
  readonly cookie: string
  readonly teamId: string
  readonly userId: string
}

export interface PostMessageInput {
  readonly channel: string
  readonly user?: string
  readonly text: string
  readonly threadTs?: string
  readonly broadcast?: boolean
  readonly clientMsgId?: string
}

export class FakeSlack {
  readonly workspace: Workspace
  readonly server: FakeServer
  readonly url: string
  readonly #controls: FakeControls
  readonly #session: Session
  /** Every frame the workspace emitted since start or `resetCalls()`, whether or not a socket was open. */
  readonly frames: RtmFrame[] = []

  private constructor(workspace: Workspace, server: FakeServer, url: string, controls: FakeControls) {
    this.#controls = controls
    this.workspace = workspace
    this.server = server
    this.url = url
    this.#session = server.newSession(workspace.selfId)
    workspace.onEvent((frame) => this.frames.push(frame))
  }

  static async start(options: FakeSlackOptions = {}): Promise<FakeSlack> {
    const registry = mergeFeatures(features)
    const handlers = registry.methods satisfies Handlers
    const clock = new Clock(options.now)
    const team = options.enterpriseId === undefined ? TEAM : { ...TEAM, enterprise_id: options.enterpriseId, enterprise_name: 'Juno Fake Org' }
    const workspace = new Workspace(clock, SELF_ID, team)
    let fake: FakeSlack | undefined
    const server = new FakeServer(workspace, (name, input) => {
      if (fake === undefined) throw new Error('not started')
      return fake.control(name, input)
    }, handlers, registry.edge)
    const url = await server.listen(options.port ?? 0, options.host ?? '127.0.0.1')
    ;(options.seed ?? seedWorkspace)(workspace, `${url}/avatars`)
    if (options.latencyMillis !== undefined) server.setLatency(options.latencyMillis)
    fake = new FakeSlack(workspace, server, url, registry.controls)
    return fake
  }

  get teamId(): string {
    return this.workspace.team.id
  }

  get selfId(): string {
    return this.workspace.selfId
  }

  /** The default session, for tests that skip the sign-in page. */
  credentials(): Credentials {
    return this.#credentials(this.#session)
  }

  /** A fresh session, as if the user signed in again. */
  signIn(): Credentials {
    return this.#credentials(this.server.newSession(this.selfId))
  }

  #credentials(session: Session): Credentials {
    return { url: this.url, token: session.token, cookie: session.cookie, teamId: this.teamId, userId: session.userId }
  }

  get calls(): ReadonlyArray<CallRecord> {
    return this.server.calls
  }

  callCount(method?: string): number {
    return this.server.calls.filter((c) => c.kind === 'api' && (method === undefined || c.method === method)).length
  }

  /** Frames Juno sent on the socket since start or `resetCalls()`, other than `ping`: `tickle`, `presence_sub`. */
  get received(): ReadonlyArray<ReceivedFrame> {
    return this.server.received
  }

  /** What colleagues see for the self user now (`FakeServer.selfPresence`). */
  selfPresence(): 'active' | 'away' {
    return this.server.selfPresence()
  }

  resetCalls(): void {
    this.server.calls.length = 0
    this.server.received.length = 0
    this.frames.length = 0
  }

  now(): number {
    return this.workspace.clock.now()
  }

  messages(channel: string): ReadonlyArray<Message> {
    return this.workspace.all(channel)
  }

  // Controls. Each is also reachable as POST /control/<name>.

  /** A message from another user (or self from another client). Emits the socket events. */
  injectMessage(input: PostMessageInput): Message {
    return this.workspace.post({
      channel: input.channel,
      user: input.user ?? 'U0MAYA',
      text: input.text,
      ...(input.threadTs === undefined ? {} : { threadTs: asTs(input.threadTs) }),
      ...(input.broadcast === undefined ? {} : { broadcast: input.broadcast }),
      ...(input.clientMsgId === undefined ? {} : { clientMsgId: input.clientMsgId }),
    })
  }

  editMessage(input: { channel: string; ts: string; text: string; user?: string }): Message {
    return this.workspace.edit(input.channel, input.ts, input.text, input.user ?? this.workspace.find(input.channel, input.ts)?.user ?? this.selfId)
  }

  deleteMessage(input: { channel: string; ts: string }): void {
    this.workspace.remove(input.channel, asTs(input.ts))
  }

  /** Self marks a conversation read from another client. */
  markRead(input: { channel: string; ts: string }): void {
    this.workspace.markConversation(input.channel, asTs(input.ts))
  }

  markThreadRead(input: { channel: string; threadTs: string; ts: string; read?: boolean }): Subscription {
    return this.workspace.markThread(input.channel, asTs(input.threadTs), asTs(input.ts), input.read ?? true)
  }

  /** Self follows a thread from another client. Emits `thread_subscribed`. */
  followThread(input: { channel: string; threadTs: string }): Subscription {
    return this.workspace.subscribe(input.channel, asTs(input.threadTs))
  }

  /** Self unfollows a thread from another client. Emits `thread_unsubscribed`. */
  unfollowThread(input: { channel: string; threadTs: string }): Subscription {
    return this.workspace.unsubscribe(input.channel, asTs(input.threadTs))
  }

  /** The user groups self belongs to (`client.userBoot.subteams.self`). */
  setSelfUsergroups(input: { ids: ReadonlyArray<string> }): void {
    this.workspace.selfUsergroups = [...input.ids]
  }

  /** Adds or changes a user group from another client. Emits `subteam_created` or `subteam_updated`. */
  putUsergroup(input: { id: string; handle: string; name: string; deleted?: boolean }): void {
    this.workspace.putUsergroup(input)
  }

  /** A custom emoji in the workspace, listed by edge `emojis/list` and taken as a reaction name. */
  addEmoji(input: { name: string; url: string }): void {
    this.workspace.emoji.set(input.name, { name: input.name, value: input.url })
  }

  addReaction(input: { channel: string; ts: string; name: string; user?: string }): void {
    const failure = this.workspace.react(input.channel, asTs(input.ts), input.name, input.user ?? 'U0MAYA', true)
    if (failure !== undefined) throw new Error(failure)
  }

  removeReaction(input: { channel: string; ts: string; name: string; user?: string }): void {
    const failure = this.workspace.react(input.channel, asTs(input.ts), input.name, input.user ?? 'U0MAYA', false)
    if (failure !== undefined) throw new Error(failure)
  }

  /**
   * A public channel self is in, with messages posted `ago` minutes back and
   * read up to the last, each with its thread `replies` if it has any. Like
   * the seed, it sends no events: add it before the app signs in.
   */
  addChannel(input: { id: string; name: string; messages: ReadonlyArray<{ user: string; text: string; ago: number; replies?: ReadonlyArray<{ user: string; text: string; ago: number }> }> }): void {
    const now = this.workspace.clock.now()
    this.workspace.addConversation({
      id: input.id,
      name: input.name,
      kind: 'public',
      members: new Set([this.selfId, ...input.messages.flatMap((message) => [message.user, ...(message.replies ?? []).map((reply) => reply.user)])]),
      created: now - 90 * 24 * 60 * 60_000,
      topic: '',
      purpose: '',
      isOpen: true,
      archived: false,
    })
    let last: Message | undefined
    for (const message of input.messages.toSorted((a, b) => b.ago - a.ago)) {
      last = this.workspace.post({ channel: input.id, user: message.user, text: message.text, at: now - message.ago * 60_000, silent: true })
      const root = last.ts
      for (const reply of (message.replies ?? []).toSorted((a, b) => b.ago - a.ago)) {
        this.workspace.post({ channel: input.id, user: reply.user, text: reply.text, at: now - reply.ago * 60_000, threadTs: root, silent: true })
      }
    }
    if (last !== undefined) this.workspace.reads.set(input.id, last.ts)
  }

  /** `user` (self by default) joins a channel. Emits `channel_joined`/`group_joined` to self and `member_joined_channel`. */
  joinChannel(input: { channel: string; user?: string }): void {
    this.workspace.join(input.channel, input.user ?? this.selfId)
  }

  /** `user` (self by default) leaves a channel. Emits `member_left_channel` and, for self, `channel_left`/`group_left`. */
  leaveChannel(input: { channel: string; user?: string }): void {
    this.workspace.leave(input.channel, input.user ?? this.selfId)
  }

  /** Renames a channel from another client. Emits `channel_rename` or `group_rename` with Slack's partial channel object. */
  renameChannel(input: { channel: string; name: string }): void {
    this.workspace.rename(input.channel, input.name)
  }

  typing(input: { channel: string; user?: string; threadTs?: string }): void {
    this.workspace.typing(input.channel, input.user ?? 'U0MAYA', input.threadTs === undefined ? undefined : asTs(input.threadTs))
  }

  /** Sends any frame to every socket, without encoding it. */
  emitFrame(frame: Record<string, unknown>): void {
    this.server.broadcastRaw(frame)
  }

  /** Terminates every socket without a close frame, like a dropped connection. */
  dropSocket(): void {
    this.server.dropSockets()
  }

  /** Drops every socket and refuses new ones until `goOnline`: events in between reach no client. */
  goOffline(): void {
    this.server.refuseSockets = true
    this.server.dropSockets()
  }

  goOnline(): void {
    this.server.refuseSockets = false
  }

  socketCount(): number {
    return this.server.sockets.size
  }

  /** The next `times` calls of `method` (or `*`) get HTTP 429 with Retry-After. */
  force429(input: { method: string; retryAfter?: number; times?: number }): void {
    this.server.force429(input.method, input.retryAfter ?? 30, input.times ?? 1)
  }

  clear429(input: { method?: string } = {}): void {
    this.server.clear429(input.method)
  }

  /** The next `times` calls of `method` answer `ok: false` with `error` (default `internal_error`), for failure paths. */
  forceError(input: { method: string; error?: string; times?: number }): void {
    this.server.forceError(input.method, input.error ?? 'internal_error', input.times ?? 1)
  }

  clearError(input: { method?: string } = {}): void {
    this.server.clearError(input.method)
  }

  /**
   * The next `times` calls of `method` run as usual but their answer waits
   * for `release`. For tests that land events while a page is in flight: the
   * request has started (its `requestedAt` is set), the events arrive, then
   * the page lands. With `reason`, only calls whose `_x_reason` matches
   * are held.
   */
  holdNext(input: { method: string; times?: number; before?: boolean; reason?: string }): void {
    this.server.holdNext(input.method, input.times ?? 1, input.before ?? false, input.reason)
  }

  /** Answers the held calls of `method`, or of every method. */
  release(input: { method?: string } = {}): void {
    this.server.release(input.method)
  }

  heldCount(input: { method?: string } = {}): number {
    return this.server.heldCount(input.method)
  }

  /** The arguments of the held calls, oldest first. */
  heldCalls(input: { method?: string } = {}): ReadonlyArray<Record<string, unknown>> {
    return this.server.heldCalls(input.method)
  }

  /**
   * The next `times` calls of `method` change Slack, then the connection
   * closes with no answer: Slack accepted a call whose answer was lost. The
   * client retries a lost answer, so lose every attempt to fail the call.
   */
  loseResponse(input: { method: string; times?: number }): void {
    this.server.loseResponse(input.method, input.times ?? 1)
  }

  /** Every Web API and edge call waits `ms` before it runs, like a real network. 0 turns it off. */
  setLatency(input: { ms: number }): void {
    this.server.setLatency(input.ms)
  }

  /** File downloads answer after `ms` milliseconds, so images arrive late. 0 turns it off. */
  delayFiles(input: { ms: number }): void {
    this.server.delayFiles(input.ms)
  }

  /**
   * The next `times` (default 1) upload POSTs answer HTTP 500 and store
   * nothing, so a client can show a failed upload and retry. With `after`,
   * that many POSTs succeed first.
   */
  failUploads(input: { times?: number; after?: number } = {}): void {
    this.server.failUploads(input.times ?? 1, input.after ?? 0)
  }

  /** Choose whether files.info is available on this session. Defaults to supported. */
  setFilesInfoSupported(input: { supported: boolean }): void {
    this.workspace.filesInfoSupported = input.supported
  }

  /**
   * Files uploaded from now on, and media from `injectMedia`, come without
   * thumbnails and without a size, on the message and from `files.info`, as
   * live Slack's echo of a fresh upload does, until `releaseThumbnails`.
   */
  holdThumbnails(): void {
    this.workspace.holdThumbnails = true
  }

  /**
   * Slack has made the held thumbnails: stored messages and `files.info`
   * carry them, and each file gets a `file_thumbnail_generated` frame, as
   * live (`event: 'file_change'` or `'file_created'` sends that instead; `'none'` sends nothing).
   * Files uploaded later have thumbnails at once.
   */
  releaseThumbnails(input: { event?: 'file_thumbnail_generated' | 'file_change' | 'file_created' | 'none' } = {}): void {
    const ws = this.workspace
    ws.holdThumbnails = false
    const released = [...ws.files.values()].filter((file) => file.thumbsHeld === true)
    for (const file of released) file.thumbsHeld = false
    const ids = new Set(released.map((file) => file.id))
    for (const [channel, list] of ws.messages) {
      const isPublic = ws.conversations.get(channel)?.kind === 'public'
      list.forEach((message, index) => {
        if (!message.files?.some((file) => file.id !== undefined && ids.has(file.id))) return
        list[index] = { ...message, files: message.files.map((file) => (file.id !== undefined && ids.has(file.id) ? fileObject(this.server.url, ws.files.get(file.id)!, isPublic) : file)) }
      })
    }
    if (input.event === 'none') return
    for (const file of released) ws.emit({ type: input.event ?? 'file_thumbnail_generated', file_id: file.id, ...(input.event === 'file_created' ? { file: { id: file.id } } : {}), event_ts: ws.eventTs() })
  }

  /**
   * A message from another user with images (PNGs) and videos of the sizes
   * given, in order; a video gets a PNG poster of that size and bytes that
   * are not a playable video. Without thumbnails or posters while
   * `holdThumbnails` is on. With `partial`, the socket event carries each
   * file as Slack's partial copy (`file_access: "check_file_info"`, little
   * more than the id), while history and `files.info` have it whole. With
   * `ago` (minutes), the message is that old.
   */
  injectMedia(input: {
    channel: string
    user?: string
    text?: string
    partial?: boolean
    ago?: number
    media: ReadonlyArray<{ name: string; width: number; height: number; kind?: 'image' | 'video' }>
  }): Message {
    const ws = this.workspace
    const user = input.user ?? 'U0MAYA'
    const isPublic = ws.conversations.get(input.channel)?.kind === 'public'
    const stored = input.media.map((each) => {
      const id = `F0${String(ws.files.size + 1).padStart(4, '0')}`
      const picture = samplePng(each.width, each.height)
      const video = each.kind === 'video'
      const bytes = video ? Buffer.from('not a playable video') : picture
      const file = {
        id,
        name: each.name,
        length: bytes.length,
        user,
        created: ws.clock.now(),
        bytes,
        mimetype: video ? 'video/mp4' : 'image/png',
        ...(video ? { poster: { bytes: picture, width: each.width, height: each.height } } : {}),
        ...(ws.holdThumbnails ? { thumbsHeld: true } : {}),
      }
      ws.files.set(id, file)
      return file
    })
    return ws.post({
      channel: input.channel,
      user,
      ...(input.text === undefined ? {} : { text: input.text }),
      files: stored.map((file) => fileObject(this.server.url, file, isPublic)),
      ...(input.ago === undefined ? {} : { at: ws.clock.now() - input.ago * 60_000 }),
      ...(input.partial === true ? { eventFiles: stored.map(partialFileObject) } : {}),
    })
  }

  /** Frames of these types wait for `releaseFrames`, so a test can deliver an event late or never. */
  holdFrames(input: { types: ReadonlyArray<string> }): void {
    this.server.holdFrames(input.types)
  }

  /** Sends (or with `drop`, discards) the oldest `count` held frames; all of them, and stop holding, when `count` is omitted. */
  releaseFrames(input: { count?: number; drop?: boolean } = {}): void {
    this.server.releaseFrames(input.count, input.drop ?? false)
  }

  heldFrames(): ReadonlyArray<RtmFrame> {
    return this.server.heldFrames()
  }

  /**
   * In-process only. Every API call `where` matches stops before Slack runs
   * it and again before its answer, until `decide`. For tests that choose
   * the order in which Slack decides each call (`packages/engine/test/conformance`).
   * Without `where`, the gate opens and waiting calls go on.
   */
  gate(where?: (method: string, args: Readonly<Record<string, string>>) => boolean): void {
    this.server.gate(where)
  }

  /** The calls waiting at the gate, oldest first. */
  gated(): ReadonlyArray<GatedCall> {
    return this.server.gated()
  }

  /** Runs, refuses or drops a call waiting before Slack runs it; answers or loses one waiting for its answer. */
  decide(id: number, decision: GateDecision): void {
    this.server.decide(id, decision)
  }

  /** In-process only. Frames `where` matches wait for `releaseFramesWhere`; undefined stops holding them. */
  holdFramesWhere(where?: (frame: RtmFrame) => boolean): void {
    this.server.holdFramesWhere(where)
  }

  /** Sends, or with `drop` discards, the held frames `where` matches. Answers how many. */
  releaseFramesWhere(where: (frame: RtmFrame) => boolean, drop = false): number {
    return this.server.releaseFramesWhere(where, drop)
  }

  /** Every session stops working: API calls get `invalid_auth`, sockets get `user_session_expiration` and close. */
  expireSession(): void {
    this.server.expireSessions()
  }

  advanceClock(input: { millis: number }): number {
    this.workspace.clock.advance(input.millis)
    return this.now()
  }

  setNow(input: { millis: number }): number {
    this.workspace.clock.set(input.millis)
    return this.now()
  }

  control(name: string, input: Record<string, unknown>): unknown {
    const handler = this.#controls[name]
    if (handler === undefined) throw new Error(`unknown control ${name}`)
    return handler(this, input as never)
  }

  async close(): Promise<void> {
    await this.server.close()
  }
}

export function startFakeSlack(options?: FakeSlackOptions): Promise<FakeSlack> {
  return FakeSlack.start(options)
}
export { writeSlackAppFixture } from './slackApp.ts'
export { largeSeed, LARGE_SEED_DEFAULTS } from './seeds/large.ts'

export { topic300Seed, TOPIC300_MAIN_CHANNEL, TOPIC300_THREAD_CHANNEL } from './seeds/topic300.ts'
export { unfurlFixtures } from './unfurls.ts'
