/**
 * A tiny client for the tests. Arguments are encoded and responses decoded
 * through @juno/slack schemas, the same way the real client will do it.
 */
import { Schema } from 'effect'
import { WebSocket } from 'ws'
import type { MethodArgs, MethodName, MethodOk, MethodResponse, RtmFrame } from '@juno/slack-schema'
import { decodeRtmFrame, Methods } from '@juno/slack-schema'
import type { Credentials, FakeSlack } from '../src/index.ts'

export interface ApiCall<M extends MethodName> {
  readonly status: number
  readonly retryAfter: string | null
  readonly body: MethodResponse<M>
}

export class TestClient {
  readonly fake: FakeSlack
  readonly credentials: Credentials

  constructor(fake: FakeSlack, credentials = fake.credentials()) {
    this.fake = fake
    this.credentials = credentials
  }

  /** Posts a method as multipart/form-data with `token` first, like the official client. */
  async call<M extends MethodName>(method: M, args: MethodArgs<M>, options: { cookie?: string | null; token?: string | null } = {}): Promise<ApiCall<M>> {
    const encoded = Schema.encodeSync(Methods[method].args)(args as never) as Record<string, string>
    const form = new FormData()
    const token = options.token === undefined ? this.credentials.token : options.token
    if (token !== null) form.set('token', token)
    for (const [key, value] of Object.entries(encoded)) form.set(key, value)
    const cookie = options.cookie === undefined ? this.credentials.cookie : options.cookie
    const response = await fetch(`${this.fake.url}/api/${method}`, {
      method: 'POST',
      body: form,
      headers: cookie === null ? {} : { cookie: `d=${cookie}` },
    })
    const json: unknown = await response.json()
    const body = Schema.decodeUnknownSync(Methods[method].response)(json) as MethodResponse<M>
    return { status: response.status, retryAfter: response.headers.get('retry-after'), body }
  }

  /** Like `call`, but fails the test unless the response is `ok: true`. */
  async ok<M extends MethodName>(method: M, args: MethodArgs<M>): Promise<MethodOk<M>> {
    const result = await this.call(method, args)
    if (!result.body.ok) throw new Error(`${method} failed: ${result.body.error} (HTTP ${result.status})`)
    return result.body as MethodOk<M>
  }

  async edge(method: string, body: Record<string, unknown>, options: { cookie?: string | null } = {}): Promise<unknown> {
    const cookie = options.cookie === undefined ? this.credentials.cookie : options.cookie
    const response = await fetch(`${this.fake.url}/edge/${method}?_x_app_name=client`, {
      method: 'POST',
      body: JSON.stringify({ token: this.credentials.token, ...body }),
      headers: { 'content-type': 'application/json', ...(cookie === null ? {} : { cookie: `d=${cookie}` }) },
    })
    return response.json()
  }

  async control(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
    const response = await fetch(`${this.fake.url}/control/${name}`, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    })
    const json = (await response.json()) as { ok: boolean; result?: unknown; error?: string }
    if (!json.ok) throw new Error(json.error)
    return json.result
  }

  /** Fetches a socket URL from the API and connects with the cookie, as the engine will. */
  async connect(options: { cookie?: string | null; token?: string } = {}): Promise<SocketClient> {
    const { primary_websocket_url } = await this.ok('client.getWebSocketURL', {})
    const url = new URL(primary_websocket_url)
    url.searchParams.set('token', options.token ?? this.credentials.token)
    url.searchParams.set('slack_client', 'desktop')
    const cookie = options.cookie === undefined ? this.credentials.cookie : options.cookie
    const socket = new SocketClient(url.toString(), cookie)
    await socket.opened
    return socket
  }
}

export class SocketClient {
  readonly socket: WebSocket
  readonly frames: RtmFrame[] = []
  readonly opened: Promise<void>
  readonly closed: Promise<{ code: number }>
  #waiters: Array<{ predicate: (frame: RtmFrame) => boolean; resolve: (frame: RtmFrame) => void }> = []

  constructor(url: string, cookie: string | null) {
    this.socket = new WebSocket(url, { headers: cookie === null ? {} : { cookie: `d=${cookie}`, origin: 'https://app.slack.com' } })
    this.opened = new Promise((resolve, reject) => {
      this.socket.once('open', resolve)
      this.socket.once('unexpected-response', (_request, response) => reject(new Error(`upgrade rejected: HTTP ${response.statusCode}`)))
      this.socket.once('error', reject)
    })
    this.closed = new Promise((resolve) => this.socket.once('close', (code) => resolve({ code })))
    this.socket.on('message', (data) => {
      const frame = decodeRtmFrame(JSON.parse(String(data)))
      this.frames.push(frame)
      const index = this.#waiters.findIndex((w) => w.predicate(frame))
      if (index !== -1) {
        const [waiter] = this.#waiters.splice(index, 1)
        waiter?.resolve(frame)
      }
    })
  }

  send(frame: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(frame))
  }

  /** The next frame (already received or still to come) matching `predicate`. */
  next<F extends RtmFrame>(predicate: (frame: RtmFrame) => frame is F, timeoutMs?: number): Promise<F>
  next(predicate: (frame: RtmFrame) => boolean, timeoutMs?: number): Promise<RtmFrame>
  next(predicate: (frame: RtmFrame) => boolean, timeoutMs = 2000): Promise<RtmFrame> {
    const index = this.frames.findIndex(predicate)
    if (index !== -1) {
      const [frame] = this.frames.splice(index, 1)
      return Promise.resolve(frame as RtmFrame)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no matching frame within timeout')), timeoutMs)
      this.#waiters.push({
        predicate,
        resolve: (frame) => {
          clearTimeout(timer)
          this.frames.splice(this.frames.indexOf(frame), 1)
          resolve(frame)
        },
      })
    })
  }

  close(): void {
    this.socket.close()
  }
}

/** The frame members whose `type` can be `T`, for frames whose `type` is a union such as `channel_marked | im_marked`. */
export type FrameOf<T extends RtmFrame['type'], F = RtmFrame> = F extends { type: infer U } ? (T extends U ? F : never) : never

export const isType =
  <T extends RtmFrame['type']>(type: T) =>
  (frame: RtmFrame): frame is FrameOf<T> =>
    frame.type === type
