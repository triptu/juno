/**
 * @juno/fake-slack: a fake Slack for tests and development.
 *
 * `startFakeSlack()` returns the running fake with its control API. The same
 * controls are reachable over HTTP as `POST /control/<name>` with a JSON body,
 * for tests that drive a built app.
 */
import type { Message, RtmFrame } from '@juno/slack-schema'
import { Clock } from './clock.ts'
import { seedWorkspace, SELF_ID, TEAM } from './fixtures.ts'
import { FakeServer, type CallRecord, type Session } from './server.ts'
import { asTs, Workspace, type Subscription } from './state.ts'

export type { CallRecord, Session } from './server.ts'
export type { ConversationRecord, PostInput, Subscription } from './state.ts'
export { Workspace } from './state.ts'
export { CONVERSATIONS, PEOPLE, SELF_ID, TEAM } from './fixtures.ts'

export interface FakeSlackOptions {
  /** 0 picks a free port. */
  readonly port?: number
  readonly host?: string
  /** Freeze the clock at this time (ms). Default: real time. */
  readonly now?: number
  /** Replace the default seed. */
  readonly seed?: (workspace: Workspace, avatarBase: string) => void
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
  readonly #session: Session
  /** Every frame the workspace emitted since start or `resetCalls()`, whether or not a socket was open. */
  readonly frames: RtmFrame[] = []

  private constructor(workspace: Workspace, server: FakeServer, url: string) {
    this.workspace = workspace
    this.server = server
    this.url = url
    this.#session = server.newSession(workspace.selfId)
    workspace.onEvent((frame) => this.frames.push(frame))
  }

  static async start(options: FakeSlackOptions = {}): Promise<FakeSlack> {
    const clock = new Clock(options.now)
    const team = options.enterpriseId === undefined ? TEAM : { ...TEAM, enterprise_id: options.enterpriseId, enterprise_name: 'Juno Fake Org' }
    const workspace = new Workspace(clock, SELF_ID, team)
    let fake: FakeSlack | undefined
    const server = new FakeServer(workspace, (name, input) => {
      if (fake === undefined) throw new Error('not started')
      return fake.control(name, input)
    })
    const url = await server.listen(options.port ?? 0, options.host ?? '127.0.0.1')
    ;(options.seed ?? seedWorkspace)(workspace, `${url}/avatars`)
    fake = new FakeSlack(workspace, server, url)
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

  resetCalls(): void {
    this.server.calls.length = 0
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

  addReaction(input: { channel: string; ts: string; name: string; user?: string }): void {
    const failure = this.workspace.react(input.channel, asTs(input.ts), input.name, input.user ?? 'U0MAYA', true)
    if (failure !== undefined) throw new Error(failure)
  }

  removeReaction(input: { channel: string; ts: string; name: string; user?: string }): void {
    const failure = this.workspace.react(input.channel, asTs(input.ts), input.name, input.user ?? 'U0MAYA', false)
    if (failure !== undefined) throw new Error(failure)
  }

  /** `user` (self by default) joins a channel. Emits `channel_joined`/`group_joined` to self and `member_joined_channel`. */
  joinChannel(input: { channel: string; user?: string }): void {
    this.workspace.join(input.channel, input.user ?? this.selfId)
  }

  /** `user` (self by default) leaves a channel. Emits `member_left_channel` and, for self, `channel_left`/`group_left`. */
  leaveChannel(input: { channel: string; user?: string }): void {
    this.workspace.leave(input.channel, input.user ?? this.selfId)
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
    const table: Record<string, (input: never) => unknown> = {
      injectMessage: (i) => this.injectMessage(i),
      editMessage: (i) => this.editMessage(i),
      deleteMessage: (i) => this.deleteMessage(i),
      markRead: (i) => this.markRead(i),
      markThreadRead: (i) => this.markThreadRead(i),
      addReaction: (i) => this.addReaction(i),
      removeReaction: (i) => this.removeReaction(i),
      joinChannel: (i) => this.joinChannel(i),
      leaveChannel: (i) => this.leaveChannel(i),
      typing: (i) => this.typing(i),
      emitFrame: (i) => this.emitFrame(i),
      dropSocket: () => this.dropSocket(),
      force429: (i) => this.force429(i),
      clear429: (i) => this.clear429(i),
      expireSession: () => this.expireSession(),
      advanceClock: (i) => this.advanceClock(i),
      setNow: (i) => this.setNow(i),
      resetCalls: () => this.resetCalls(),
      calls: () => this.calls,
      credentials: () => this.credentials(),
      signIn: () => this.signIn(),
      messages: (i: { channel: string }) => this.messages(i.channel),
      now: () => this.now(),
    }
    const handler = table[name]
    if (handler === undefined) throw new Error(`unknown control ${name}`)
    return handler(input as never)
  }

  async close(): Promise<void> {
    await this.server.close()
  }
}

export function startFakeSlack(options?: FakeSlackOptions): Promise<FakeSlack> {
  return FakeSlack.start(options)
}
export { localConfigJson, writeSlackAppFixture, type SlackAppFixtureOptions, type SlackAppFixtureTeam } from './slackApp.ts'
export { largeSeed, LARGE_SEED_DEFAULTS, type LargeSeedOptions, type LargeSeedSummary } from './seeds/large.ts'
