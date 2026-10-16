/**
 * The HTTP and websocket server. Speaks the transport documented in
 * docs/research/slack-data-access.md sections 1, 4 and 6: multipart POST to
 * /api/<method> with `token` as a form field and the `d` cookie, `ok:false`
 * errors, 429 with Retry-After, the edge API with JSON bodies, and the socket
 * with hello, ping/pong and events. Also the upload url (`/upload/<id>`) and
 * file downloads (`/files/<id>/<name>`).
 */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { Schema } from 'effect'
import { WebSocketServer, type WebSocket } from 'ws'
import type { MethodName, RtmFrame } from '@juno/slack-schema'
import { EdgeEmojisListOk, EdgeUsersInfoArgs, EdgeUsersInfoOk, encodeRtmFrame, isMethodName, Methods } from '@juno/slack-schema'
import { parseCookies, parseFields, parseJson, parseMultipartParts, readBody, type FormFields } from './body.ts'
import { mimetypeOf } from './files.ts'
import { ApiError, handlers, type MethodContext } from './methods.ts'
import { clientPage, signInPage } from './signin.ts'
import type { Workspace } from './state.ts'

export interface Session {
  readonly cookie: string
  readonly token: string
  readonly userId: string
  expired: boolean
}

export interface CallRecord {
  readonly at: number
  readonly kind: 'api' | 'edge' | 'upload' | 'control'
  readonly method: string
  /** Form fields as received, token redacted. */
  readonly args: Readonly<Record<string, string>>
  readonly status: number
  readonly ok: boolean
  readonly error?: string
}

const RECONNECT_URL_FIRST_MILLIS = 200
const RECONNECT_URL_INTERVAL_MILLIS = 30_000

interface RateLimitRule {
  retryAfter: number
  remaining: number
}

interface FailureRule {
  error: string
  remaining: number
}

/**
 * Calls of one method held back until `release`, so a test can land events
 * while a page is in flight. `before` holds a call before its handler runs
 * (Slack has not seen it yet); otherwise the handler runs and the answer waits.
 */
interface HoldRule {
  remaining: number
  readonly before: boolean
  /** Only calls whose `_x_reason` is this are held. */
  readonly reason: string | undefined
  readonly waiting: Array<{ readonly resume: () => void; readonly args: Record<string, unknown> }>
}

/** A call stopped at a gate (`FakeServer.gate`): the test decides what Slack does with it. */
export interface GatedCall {
  readonly id: number
  readonly method: string
  readonly args: Readonly<Record<string, string>>
  /** `before`: Slack has not run it yet. `answer`: Slack ran it, or refused it, and the answer waits. The id stays the same. */
  readonly stage: 'before' | 'answer'
  /** At `answer`: `ran`, or the error Slack refused it with. */
  readonly outcome?: string
}

/**
 * What Slack does with a gated call. At `before`: run it, refuse it with
 * `error` (with `status` 429, a rate limit), or drop it: the connection
 * closes and nothing runs. At `answer`: send the answer, or lose it: the
 * connection closes with no answer.
 */
export type GateDecision = 'run' | 'drop' | 'answer' | 'lose' | { readonly error: string; readonly status?: number; readonly retryAfter?: number }

interface GateWaiter {
  readonly call: GatedCall
  readonly decide: (decision: GateDecision) => void
}

export class FakeServer {
  readonly sessions = new Map<string, Session>()
  readonly calls: CallRecord[] = []
  readonly sockets = new Set<WebSocket>()
  readonly #rateLimits = new Map<string, RateLimitRule>()
  readonly #failures = new Map<string, FailureRule>()
  readonly #holds = new Map<string, HoldRule>()
  readonly #stalls = new Map<string, HoldRule>()
  readonly #lost = new Map<string, number>()
  #gate: ((method: string, args: Readonly<Record<string, string>>) => boolean) | undefined
  readonly #gated = new Map<number, GateWaiter>()
  #gateSerial = 0
  #frameHold: ReadonlySet<string> | undefined
  #frameWhere: ((frame: RtmFrame) => boolean) | undefined
  #fileDelayMs = 0
  #failedUploads = 0
  #uploadsBeforeFailing = 0
  readonly #heldFrames: RtmFrame[] = []
  readonly workspace: Workspace
  readonly #control: (name: string, input: Record<string, unknown>) => unknown
  readonly #http: Server
  readonly #wss = new WebSocketServer({ noServer: true })
  #baseUrl = ''
  #socketSerial = 0

  constructor(workspace: Workspace, control: (name: string, input: Record<string, unknown>) => unknown) {
    this.workspace = workspace
    this.#control = control
    this.#http = createServer((request, response) => {
      this.#handle(request, response).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!response.headersSent) json(response, 500, { ok: false, error: 'internal_error', message })
        else response.end()
      })
    })
    this.#http.on('upgrade', (request, socket, head) => this.#upgrade(request, socket, head))
    workspace.onEvent((frame) => {
      if (this.#frameHold?.has(frame.type) === true || this.#frameWhere?.(frame) === true) this.#heldFrames.push(frame)
      else this.broadcast(frame)
    })
  }

  get url(): string {
    return this.#baseUrl
  }

  async listen(port: number, host: string): Promise<string> {
    await new Promise<void>((resolve) => this.#http.listen(port, host, resolve))
    const address = this.#http.address()
    const actualPort = typeof address === 'object' && address !== null ? address.port : port
    this.#baseUrl = `http://${host}:${actualPort}`
    return this.#baseUrl
  }

  async close(): Promise<void> {
    this.release()
    this.releaseFrames(undefined, true)
    this.dropSockets()
    this.#wss.close()
    await new Promise<void>((resolve, reject) => this.#http.close((error) => (error ? reject(error) : resolve())))
  }

  // Sessions

  newSession(userId: string): Session {
    const session: Session = {
      cookie: `fake-d-${randomBytes(12).toString('hex')}`,
      token: `xoxc-fake-${randomBytes(12).toString('hex')}`,
      userId,
      expired: false,
    }
    this.sessions.set(session.cookie, session)
    return session
  }

  expireSessions(): void {
    for (const session of this.sessions.values()) session.expired = true
    this.broadcast({ type: 'user_session_expiration' })
    this.dropSockets()
  }

  #authenticate(cookie: string | undefined, token: string | undefined): Session | 'not_authed' | 'invalid_auth' {
    if (token === undefined || token === '') return 'not_authed'
    if (cookie === undefined) return 'invalid_auth'
    const session = this.sessions.get(cookie)
    if (session === undefined || session.expired || session.token !== token) return 'invalid_auth'
    return session
  }

  // Rate limits

  force429(method: string, retryAfter: number, times: number): void {
    this.#rateLimits.set(method, { retryAfter, remaining: times })
  }

  clear429(method?: string): void {
    if (method === undefined) this.#rateLimits.clear()
    else this.#rateLimits.delete(method)
  }

  #takeRateLimit(method: string): RateLimitRule | undefined {
    const rule = this.#rateLimits.get(method) ?? this.#rateLimits.get('*')
    if (rule === undefined || rule.remaining <= 0) return undefined
    rule.remaining -= 1
    return rule
  }

  // Forced `ok: false` answers

  /** The next `times` calls of `method` answer `ok: false` with `error`, before the handler runs. */
  forceError(method: string, error: string, times: number): void {
    this.#failures.set(method, { error, remaining: times })
  }

  clearError(method?: string): void {
    if (method === undefined) this.#failures.clear()
    else this.#failures.delete(method)
  }

  #takeFailure(method: string): string | undefined {
    const rule = this.#failures.get(method)
    if (rule === undefined || rule.remaining <= 0) return undefined
    rule.remaining -= 1
    return rule.error
  }

  // Held calls

  /**
   * The next `times` calls of `method` wait for `release`: before their
   * handler runs when `before`, else after it, before answering.
   */
  holdNext(method: string, times: number, before = false, reason?: string): void {
    const rules = before ? this.#stalls : this.#holds
    const existing = rules.get(method)
    if (existing === undefined || existing.reason !== reason) rules.set(method, { remaining: times, before, reason, waiting: [...(existing?.waiting ?? [])] })
    else existing.remaining += times
  }

  #rules(method: string | undefined): Array<[Map<string, HoldRule>, string, HoldRule]> {
    const found: Array<[Map<string, HoldRule>, string, HoldRule]> = []
    for (const rules of [this.#stalls, this.#holds]) for (const [name, rule] of rules) if (method === undefined || name === method) found.push([rules, name, rule])
    return found
  }

  /** Lets every held call of `method` (every method when omitted) go on, and forgets the rule. */
  release(method?: string): void {
    for (const [rules, name, rule] of this.#rules(method)) {
      rules.delete(name)
      for (const held of rule.waiting.splice(0)) held.resume()
    }
  }

  /** How many calls are waiting for `release`. */
  heldCount(method?: string): number {
    return this.#rules(method).reduce((n, [, , rule]) => n + rule.waiting.length, 0)
  }

  /** The arguments of the calls waiting for `release`, oldest first. */
  heldCalls(method?: string): ReadonlyArray<Record<string, unknown>> {
    return this.#rules(method).flatMap(([, , rule]) => rule.waiting.map((held) => held.args))
  }

  #hold(rules: Map<string, HoldRule>, method: string, args: Record<string, unknown>): Promise<void> | undefined {
    const rule = rules.get(method)
    if (rule === undefined || rule.remaining <= 0) return undefined
    if (rule.reason !== undefined && args['_x_reason'] !== rule.reason) return undefined
    rule.remaining -= 1
    return new Promise((resolve) => rule.waiting.push({ resume: resolve, args }))
  }

  // Lost answers

  /** The next `times` calls of `method` run their handler, then the connection closes with no answer. */
  loseResponse(method: string, times: number): void {
    this.#lost.set(method, (this.#lost.get(method) ?? 0) + times)
  }

  #takeLost(method: string): boolean {
    const remaining = this.#lost.get(method) ?? 0
    if (remaining <= 0) return false
    this.#lost.set(method, remaining - 1)
    return true
  }

  // Gated calls

  /**
   * From now on, every API call `where` matches stops twice: before its
   * handler runs and before its answer, until the test `decide`s. Without
   * `where`, the gate opens: waiting calls run and answer.
   */
  gate(where: ((method: string, args: Readonly<Record<string, string>>) => boolean) | undefined): void {
    this.#gate = where
    if (where === undefined) for (const waiter of this.#gated.values()) waiter.decide(waiter.call.stage === 'before' ? 'run' : 'answer')
  }

  /** The calls waiting at the gate, oldest first. */
  gated(): ReadonlyArray<GatedCall> {
    return [...this.#gated.values()].map((waiter) => waiter.call)
  }

  /** Decides a waiting call. A decision that does not fit its stage throws. */
  decide(id: number, decision: GateDecision): void {
    const waiter = this.#gated.get(id)
    if (waiter === undefined) throw new Error(`no gated call ${id}`)
    const before = decision === 'run' || decision === 'drop' || typeof decision === 'object'
    if (before !== (waiter.call.stage === 'before')) throw new Error(`call ${id} is at ${waiter.call.stage}, not a stage for ${JSON.stringify(decision)}`)
    waiter.decide(decision)
  }

  #atGate(call: Omit<GatedCall, 'id'>, id: number): Promise<GateDecision> {
    return new Promise((resolve) => {
      const entry: GatedCall = { id, ...call }
      this.#gated.set(id, {
        call: entry,
        decide: (decision) => {
          this.#gated.delete(id)
          resolve(decision)
        },
      })
    })
  }

  // Held frames

  /** File downloads answer after `ms`, so images arrive late. 0 turns it off. */
  delayFiles(ms: number): void {
    this.#fileDelayMs = ms
  }

  /** After `after` more upload POSTs succeed, the next `times` answer HTTP 500 and store nothing. */
  failUploads(times: number, after = 0): void {
    this.#failedUploads = times
    this.#uploadsBeforeFailing = after
  }

  /** From now on, frames of these types wait for `releaseFrames` instead of reaching the sockets. */
  holdFrames(types: ReadonlyArray<string>): void {
    this.#frameHold = new Set(types)
  }

  /**
   * Sends (or with `drop`, discards) the oldest `count` held frames, all of
   * them when omitted. Without a count, frames stop being held.
   */
  releaseFrames(count?: number, drop = false): void {
    const frames = this.#heldFrames.splice(0, count ?? this.#heldFrames.length)
    if (count === undefined) {
      this.#frameHold = undefined
      this.#frameWhere = undefined
    }
    if (!drop) for (const frame of frames) this.broadcast(frame)
  }

  /** From now on, frames `where` matches wait for `releaseFramesWhere`, besides any `holdFrames` types. Undefined stops. */
  holdFramesWhere(where: ((frame: RtmFrame) => boolean) | undefined): void {
    this.#frameWhere = where
  }

  /** Sends (or with `drop`, discards) the held frames `where` matches, in order. Answers how many. */
  releaseFramesWhere(where: (frame: RtmFrame) => boolean, drop = false): number {
    const frames = this.#heldFrames.filter(where)
    for (const frame of frames) this.#heldFrames.splice(this.#heldFrames.indexOf(frame), 1)
    if (!drop) for (const frame of frames) this.broadcast(frame)
    return frames.length
  }

  /** The frames waiting for `releaseFrames`, oldest first. */
  heldFrames(): ReadonlyArray<RtmFrame> {
    return [...this.#heldFrames]
  }

  // Socket

  socketUrl(): string {
    this.#socketSerial += 1
    return `${this.#baseUrl.replace(/^http/, 'ws')}/websocket/${this.#socketSerial}`
  }

  broadcast(frame: RtmFrame): void {
    const data = JSON.stringify(encodeRtmFrame(frame))
    for (const socket of this.sockets) if (socket.readyState === socket.OPEN) socket.send(data)
  }

  /** Sends a frame as-is, bypassing the schema. For tests that need a malformed or unknown frame. */
  broadcastRaw(frame: unknown): void {
    const data = JSON.stringify(frame)
    for (const socket of this.sockets) if (socket.readyState === socket.OPEN) socket.send(data)
  }

  dropSockets(): void {
    for (const socket of this.sockets) socket.terminate()
    this.sockets.clear()
  }

  /** While true, socket upgrades are refused with 503, so a client stays offline until it is false again. */
  refuseSockets = false

  #upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.refuseSockets) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const url = new URL(request.url ?? '/', this.#baseUrl)
    const cookie = parseCookies(request.headers.cookie)['d']
    const auth = url.pathname.startsWith('/websocket/') ? this.#authenticate(cookie, url.searchParams.get('token') ?? undefined) : 'invalid_auth'
    if (typeof auth === 'string') {
      socket.write(`HTTP/1.1 ${auth === 'not_authed' ? 400 : 401} ${auth}\r\nConnection: close\r\n\r\n`)
      socket.destroy()
      return
    }
    this.#wss.handleUpgrade(request, socket, head, (ws) => this.#connected(ws, auth))
  }

  /**
   * Like the real server (research section 4): `hello` with `start: true`,
   * a `reconnect_url` about 0.2 s later and again every 30 s. The URL is
   * complete (token included), so a client can reconnect with it as it is.
   */
  #connected(ws: WebSocket, session: Session): void {
    this.sockets.add(ws)
    const reconnectUrl = () => {
      if (ws.readyState !== ws.OPEN) return
      const url = new URL(this.socketUrl())
      url.searchParams.set('token', session.token)
      ws.send(JSON.stringify(encodeRtmFrame({ type: 'reconnect_url', url: url.toString() })))
    }
    const first = setTimeout(reconnectUrl, RECONNECT_URL_FIRST_MILLIS).unref()
    const repeat = setInterval(reconnectUrl, RECONNECT_URL_INTERVAL_MILLIS).unref()
    ws.on('close', () => {
      clearTimeout(first)
      clearInterval(repeat)
      this.sockets.delete(ws)
    })
    ws.on('message', (raw) => {
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(String(raw)) as Record<string, unknown>
      } catch {
        return
      }
      if (frame['type'] === 'ping' && typeof frame['id'] === 'number') {
        ws.send(JSON.stringify(encodeRtmFrame({ type: 'pong', reply_to: frame['id'] })))
      } else if (frame['type'] === 'presence_sub' && Array.isArray(frame['ids'])) {
        const users = frame['ids'].filter((id): id is string => typeof id === 'string' && this.workspace.users.has(id))
        const self = users.filter((id) => id === this.workspace.selfId && this.workspace.manualPresence === 'away')
        const others = users.filter((id) => !self.includes(id))
        if (others.length > 0) ws.send(JSON.stringify(encodeRtmFrame({ type: 'presence_change', presence: 'active', users: others })))
        if (self.length > 0) ws.send(JSON.stringify(encodeRtmFrame({ type: 'presence_change', presence: 'away', users: self })))
      }
    })
    ws.send(JSON.stringify(encodeRtmFrame({ type: 'hello', region: 'fake', host_id: 'fake-1', fast_reconnect: false, start: true })))
  }

  // HTTP

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', this.#baseUrl)
    const path = url.pathname
    const method = request.method ?? 'GET'

    if (path.startsWith('/api/') && method === 'POST') return this.#api(path.slice('/api/'.length), request, response)
    if (path.startsWith('/edge/') && method === 'POST') return this.#edge(path.slice('/edge/'.length), request, response)
    if (path.startsWith('/upload/') && (method === 'POST' || method === 'PUT')) return this.#upload(path.slice('/upload/'.length), request, response)
    if (path.startsWith('/files/') && method === 'GET') {
      const cookie = parseCookies(request.headers.cookie)['d']
      const session = cookie === undefined ? undefined : this.sessions.get(cookie)
      if (session === undefined || session.expired) {
        response.writeHead(302, { location: '/signin' })
        response.end()
        return
      }
      return this.#file(path.split('/')[2] ?? '', url.searchParams.get('download') === '1', response)
    }
    if (path.startsWith('/avatars/') && method === 'GET') {
      const cookie = parseCookies(request.headers.cookie)['d']
      const session = cookie === undefined ? undefined : this.sessions.get(cookie)
      if (session === undefined || session.expired) return json(response, 401, { ok: false, error: 'not_authed' })
      return this.#avatar(path.slice('/avatars/'.length).replace(/\.svg$/, ''), response)
    }
    if (path.startsWith('/control/') && method === 'POST') return this.#controlRoute(path.slice('/control/'.length), request, response)
    if ((path === '/' || path === '/signin') && method === 'GET') return html(response, 200, signInPage({}))
    if (path === '/signin' && method === 'POST') return this.#signIn(request, response)
    if (path.startsWith('/client/') && method === 'GET') return this.#client(request, response)
    if (path === '/health') return json(response, 200, { ok: true })
    json(response, 404, { ok: false, error: 'not_found' })
  }

  async #api(method: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const fields = parseFields(request.headers['content-type'], await readBody(request))
    const record = (status: number, body: { ok: boolean; error?: string }) => {
      this.calls.push({ at: this.workspace.clock.now(), kind: 'api', method, args: redact(fields), status, ok: body.ok, ...(body.error === undefined ? {} : { error: body.error }) })
      json(response, status, body)
    }
    const auth = this.#authenticate(parseCookies(request.headers.cookie)['d'], fields['token'])
    if (typeof auth === 'string') return record(200, { ok: false, error: auth })
    const limit = this.#takeRateLimit(method)
    if (limit !== undefined) {
      response.setHeader('Retry-After', String(limit.retryAfter))
      return record(429, { ok: false, error: 'ratelimited' })
    }
    if (!isMethodName(method)) return record(200, { ok: false, error: 'unknown_method' })
    const stalled = this.#hold(this.#stalls, method, redact(fields))
    if (stalled !== undefined) await stalled
    const gated = this.#gate?.(method, redact(fields)) === true
    const lose = () => {
      this.calls.push({ at: this.workspace.clock.now(), kind: 'api', method, args: redact(fields), status: 0, ok: false, error: 'lost' })
      response.socket?.destroy()
    }
    let gateError: { readonly error: string; readonly status?: number; readonly retryAfter?: number } | undefined
    // One id for both stops of a call.
    const gateId = gated ? ++this.#gateSerial : 0
    if (gated) {
      const decision = await this.#atGate({ method, args: redact(fields), stage: 'before' }, gateId)
      if (decision === 'drop') return lose()
      if (typeof decision === 'object') gateError = decision
    }
    const forced = gateError?.error ?? this.#takeFailure(method)
    const result = forced === undefined ? this.#run(method, fields) : undefined
    // The handler has run (state changed, events sent), or a forced error stands in for it; only the answer waits.
    const held = this.#hold(this.#holds, method, redact(fields))
    if (held !== undefined) await held
    // A gate opened meanwhile lets the answer go.
    if (gated && this.#gate !== undefined && (await this.#atGate({ method, args: redact(fields), stage: 'answer', outcome: forced ?? 'ran' }, gateId)) === 'lose') return lose()
    if (this.#takeLost(method)) return lose()
    if (gateError?.status !== undefined) {
      if (gateError.retryAfter !== undefined) response.setHeader('Retry-After', String(gateError.retryAfter))
      return record(gateError.status, { ok: false, error: gateError.error })
    }
    if (forced !== undefined) return record(200, { ok: false, error: forced })
    if (result === undefined) return
    if (result instanceof ApiError) {
      if (result.retryAfter !== undefined) response.setHeader('Retry-After', String(result.retryAfter))
      return record(result.status, { ok: false, error: result.error })
    }
    record(200, result)
  }

  #run<M extends MethodName>(method: M, fields: FormFields): ApiError | { ok: true } {
    const definition = Methods[method]
    // Slack's own error for a presence it does not take (`auto` is the public API's word, not this method's).
    if (method === 'presence.set' && fields['presence'] !== 'active' && fields['presence'] !== 'away') return new ApiError('invalid_presence')
    let args: (typeof definition)['args']['Type']
    try {
      args = Schema.decodeUnknownSync(definition.args)(fields) as (typeof definition)['args']['Type']
    } catch {
      return new ApiError('invalid_arguments')
    }
    const handler = handlers[method] as (ctx: MethodContext, args: unknown) => Record<string, unknown> | ApiError
    const result = handler(this.#context(), args)
    if (result instanceof ApiError) return result
    // Encoding through the schema is what keeps the fake honest: a field the
    // schema does not know is dropped, a wrong type throws.
    const encode = Schema.encodeUnknownSync(definition.ok) as (value: unknown) => { ok: true }
    return encode({ ok: true, ...result })
  }

  #context(): MethodContext {
    return {
      workspace: this.workspace,
      baseUrl: this.#baseUrl,
      socketUrl: () => this.socketUrl(),
      uploadUrl: (fileId) => `${this.#baseUrl}/upload/${fileId}`,
    }
  }

  async #edge(method: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = parseJson(await readBody(request))
    const record = async (status: number, payload: { ok: boolean; error?: string }) => {
      this.calls.push({ at: this.workspace.clock.now(), kind: 'edge', method, args: redact(stringify(body)), status, ok: payload.ok, ...(payload.error === undefined ? {} : { error: payload.error }) })
      await this.#hold(this.#holds, `edge:${method}`, redact(stringify(body)))
      json(response, status, payload)
    }
    const token = typeof body['token'] === 'string' ? body['token'] : undefined
    const auth = this.#authenticate(parseCookies(request.headers.cookie)['d'], token)
    if (typeof auth === 'string') return record(200, { ok: false, error: auth })
    await this.#hold(this.#stalls, `edge:${method}`, redact(stringify(body)))
    const limit = this.#takeRateLimit(`edge:${method}`)
    if (limit !== undefined) {
      response.setHeader('Retry-After', String(limit.retryAfter))
      return record(429, { ok: false, error: 'ratelimited' })
    }
    if (method === 'emojis/list') return record(200, Schema.encodeSync(EdgeEmojisListOk)({ ok: true, results: [...this.workspace.emoji.values()] }))
    if (method !== 'users/info') return record(200, { ok: false, error: 'unknown_method' })
    let args: EdgeUsersInfoArgs
    try {
      args = Schema.decodeUnknownSync(EdgeUsersInfoArgs)(body)
    } catch {
      return record(200, { ok: false, error: 'invalid_arguments' })
    }
    const ids = args.ids ?? Object.keys(args.updated_ids ?? {})
    const results = ids.flatMap((id) => this.workspace.users.get(id) ?? [])
    const failed = ids.filter((id) => !this.workspace.users.has(id))
    await record(200, Schema.encodeSync(EdgeUsersInfoOk)({ ok: true, results, failed_ids: failed, pending_ids: [], invalid_ids: [] }))
  }

  /**
   * The bytes of a file, as the official client sends them: multipart with
   * one field named `file`. A raw body is accepted too. No token or cookie.
   */
  async #upload(fileId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const stored = this.workspace.files.get(fileId)
    const body = await readBody(request)
    const record = (status: number, length: number) =>
      this.calls.push({ at: this.workspace.clock.now(), kind: 'upload', method: fileId, args: { length: String(length) }, status, ok: status === 200 })
    if (this.#failedUploads > 0 && this.#uploadsBeforeFailing > 0) this.#uploadsBeforeFailing -= 1
    else if (this.#failedUploads > 0) {
      this.#failedUploads -= 1
      record(500, body.length)
      response.writeHead(500, { 'content-type': 'text/plain' })
      return void response.end('Internal Server Error')
    }
    if (stored === undefined) {
      record(404, body.length)
      return json(response, 404, { ok: false, error: 'file_not_found' })
    }
    const type = request.headers['content-type'] ?? ''
    const part = type.toLowerCase().startsWith('multipart/form-data') ? parseMultipartParts(type, body).find((p) => p.name === 'file') : undefined
    const bytes = part === undefined ? body : part.data
    stored.bytes = bytes
    stored.mimetype = mimetypeOf(stored.name, bytes, part === undefined ? type : part.contentType)
    record(200, bytes.length)
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('OK - ' + bytes.length)
  }

  /** Serves a file's bytes; `?download=1` asks the browser to save it. Thumb urls get the original bytes. */
  async #file(fileId: string, download: boolean, response: ServerResponse): Promise<void> {
    await this.#hold(this.#stalls, 'file:bytes', { fileId })
    await this.#hold(this.#holds, 'file:bytes', { fileId })
    if (this.#fileDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.#fileDelayMs))
    const stored = this.workspace.files.get(fileId)
    if (stored?.bytes === undefined) return json(response, 404, { ok: false, error: 'file_not_found' })
    response.writeHead(200, {
      'content-type': stored.mimetype,
      'content-length': stored.bytes.length,
      ...(download ? { 'content-disposition': `attachment; filename="${stored.name.replaceAll('"', '')}"` } : {}),
    })
    response.end(stored.bytes)
  }

  #avatar(userId: string, response: ServerResponse): void {
    const user = this.workspace.users.get(userId)
    if (user === undefined) return json(response, 404, { ok: false, error: 'user_not_found' })
    const initials = (user.real_name ?? user.name ?? '?')
      .split(' ')
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><rect width="72" height="72" rx="12" fill="#${user.color ?? '888888'}"/><text x="36" y="44" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#fff">${initials}</text></svg>`
    response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' })
    response.end(svg)
  }

  async #controlRoute(name: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = parseJson(await readBody(request))
    try {
      const result = this.#control(name, input)
      this.calls.push({ at: this.workspace.clock.now(), kind: 'control', method: name, args: stringify(input), status: 200, ok: true })
      json(response, 200, { ok: true, result: result ?? null })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      json(response, 400, { ok: false, error: message })
    }
  }

  async #signIn(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const fields = parseFields(request.headers['content-type'], await readBody(request))
    if ((fields['email'] ?? '') === '') return html(response, 400, signInPage({ error: 'Enter an email.' }))
    const session = this.newSession(this.workspace.selfId)
    // Like the real `d` cookie: HttpOnly, about a year long (a cookie with no
    // expiry would not survive an app relaunch).
    response.writeHead(303, {
      'set-cookie': `d=${session.cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
      location: `/client/${this.workspace.team.id}`,
    })
    response.end()
  }

  #client(request: IncomingMessage, response: ServerResponse): void {
    const cookie = parseCookies(request.headers.cookie)['d']
    const session = cookie === undefined ? undefined : this.sessions.get(cookie)
    if (session === undefined || session.expired) {
      response.writeHead(302, { location: '/signin' })
      response.end()
      return
    }
    html(
      response,
      200,
      clientPage({
        teamId: this.workspace.team.id,
        teamName: this.workspace.team.name,
        domain: this.workspace.team.domain,
        url: `${this.#baseUrl}/`,
        token: session.token,
        userId: session.userId,
        ...(this.workspace.team.enterprise_id === undefined ? {} : { enterpriseId: this.workspace.team.enterprise_id }),
      }),
    )
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-slack-req-id': randomBytes(6).toString('hex'),
  })
  response.end(JSON.stringify(body))
}

function html(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
  response.end(body)
}

function redact(fields: FormFields): FormFields {
  const copy = { ...fields }
  if ('token' in copy) copy['token'] = 'xoxc-redacted'
  return copy
}

function stringify(input: Record<string, unknown>): FormFields {
  const out: FormFields = {}
  for (const [key, value] of Object.entries(input)) out[key] = typeof value === 'string' ? value : JSON.stringify(value)
  return out
}
