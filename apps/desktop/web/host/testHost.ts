/**
 * The browser e2e lane's app host (apps/desktop/e2e/README.md, "Browser
 * lane"): a loaded child process leased per test by the Playwright worker
 * (`e2e/browser/host.ts`). It holds what Electron's main and engine process
 * hold for one window, without Electron:
 *
 * - the engine on the test's data folder, against the worker's fake Slack,
 *   with the e2e scheduling profile and test work passes (`src/engine`);
 * - main's part of the session (`fakeMain.ts`), kept in `web-session.json`
 *   in the data folder so a restart, or a copy of a synced snapshot, keeps it;
 * - one HTTP server on a free port: the built renderer (`dist/renderer/`), the
 *   `/__juno/` files and the engine socket.
 *
 * The worker sends commands over Node IPC (`HostCommand`), each answered by
 * id. The host asks the worker for a new fake Slack session when the page
 * signs in. It loads its modules before the first command, so a worker keeps
 * the process for another test after stopping all of this test's services.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { WebSocketServer } from 'ws'
import type { ReadySession } from '@juno/contract'
import { memoryHost, socketTransport, startEngine, type EngineHandle } from '@juno/engine'
import type { Credentials } from '@juno/fake-slack'
import { createLog } from '../../src/logging'
import { createTestWork, fastTestTiming } from '../../src/engine/testWork'
import { ENGINE_SOCKET_PATH } from '../paths'
import { fakeMain, type SessionStore, type StoredSession } from './fakeMain'
import { serveFile } from './files'
import { createShell } from './system'
import { recordHostCoverage } from './coverage'
import type { AgentOptions } from './agent'
import { AGENT_SOCKET_PATH, SHELL_SOCKET_PATH, type SystemCall } from '../shell'

/** How the engine starts: the launch options the Electron fixture passes main as environment variables. */
export interface EngineOptions extends AgentOptions {
  readonly timing?: 'fast' | 'production'
  readonly aiJobs?: boolean
  readonly fakeAiDelayMillis?: number
  readonly fakeAiRequiresKey?: boolean
  readonly cacheMigration?: boolean
  readonly paced?: boolean
}

export interface HostStart {
  readonly coverage?: string
  readonly userData: string
  readonly fakeUrl: string
  /** Origins a synced snapshot's addresses name, which mean this fake. */
  readonly aliases: ReadonlyArray<string>
  /** The built renderer (`dist/renderer/`). */
  readonly webRoot: string
  readonly engine: EngineOptions
}

export type HostCommand =
  | { readonly type: 'start'; readonly start: HostStart }
  | { readonly type: 'quitEngine' }
  | { readonly type: 'startEngine'; readonly engine?: EngineOptions }
  | { readonly type: 'workPass'; readonly name: 'title' | 'art' | 'home' | 'automated' }
  | { readonly type: 'aiCalls' }
  | { readonly type: 'system'; readonly call: SystemCall }
  | { readonly type: 'stop' }

export type HostMessage =
  | { readonly type: 'loaded' }
  | { readonly type: 'answer'; readonly id: number; readonly value?: unknown; readonly error?: string }
  | { readonly type: 'ask'; readonly id: number; readonly name: 'signIn' }

export type WorkerMessage =
  | { readonly type: 'command'; readonly id: number; readonly command: HostCommand }
  | { readonly type: 'reply'; readonly id: number; readonly value: Credentials }

// The worker may be gone already (a test that timed out); nothing is left to tell.
const send = (message: HostMessage) => {
  if (process.connected) process.send?.(message, undefined, undefined, () => undefined)
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
}

/** A data folder's session file: what `secrets.bin` and the cookie jar hold in the app. */
function fileSessionStore(userData: string): SessionStore {
  const file = join(userData, 'web-session.json')
  const read = (): { stored: StoredSession | null; ready?: ReadySession } => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { stored: StoredSession | null; ready?: ReadySession }) : { stored: null })
  const write = (next: { stored: StoredSession | null; ready?: ReadySession }) => writeFileSync(file, JSON.stringify(next))
  return {
    load: () => read().stored,
    save: (stored) => write({ ...read(), stored }),
    ready: (ready) => write({ stored: read().stored, ...(ready === undefined ? {} : { ready }) }),
  }
}

/** The last verified session, so the page's first frame is the shell, as `launch.json` gives Electron's. */
function readySession(userData: string): ReadySession | undefined {
  const file = join(userData, 'web-session.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { ready?: ReadySession }).ready : undefined
}

let nextAsk = 0
const asks = new Map<number, (credentials: Credentials) => void>()
const askSignIn = () =>
  new Promise<Credentials>((resolve) => {
    const id = ++nextAsk
    asks.set(id, resolve)
    send({ type: 'ask', id, name: 'signIn' })
  })

interface Running {
  readonly start: HostStart
  engineOptions: EngineOptions
  engine: EngineHandle
  log: ReturnType<typeof createLog>
  testWork: ReturnType<typeof createTestWork>
  cookie: () => string
  readonly shell: ReturnType<typeof createShell>
  readonly calls: Record<string, number>
  readonly transport: ReturnType<typeof socketTransport>
  readonly close: () => Promise<void>
  readonly url: string
  /** Between `quitEngine` and `startEngine`. */
  stopped: boolean
}

let running: Running | undefined
let httpServer: ReturnType<typeof createServer> | undefined
const workReplies = new Map<number, (error: string | undefined) => void>()
let nextWork = 0

async function startEngineOn(start: HostStart, options: EngineOptions, transport: ReturnType<typeof socketTransport>, calls: Record<string, number>, shell: ReturnType<typeof createShell>) {
  const log = createLog('engine', join(start.userData, 'logs'))
  const host = memoryHost()
  shell.connect(host)
  const main = fakeMain(host, { fakeUrl: start.fakeUrl, aliases: start.aliases, store: fileSessionStore(start.userData), signIn: askSignIn })
  // In Electron the engine entry answers main; here the answers come back to `workPass`.
  const work = createTestWork((reply) => workReplies.get(reply.id)?.(reply.error))
  host.onEngine((message) => {
    if (message._tag === 'aiCall') calls[message.task] = (calls[message.task] ?? 0) + 1
  })
  const fast = (options.timing ?? 'fast') === 'fast'
  const engine = await startEngine(
    transport,
    {
      userData: start.userData,
      e2e: true,
      dev: true,
      fakeSlackUrl: start.fakeUrl,
      ai: 'fake',
      ...(options.aiJobs === true ? {} : { aiJobs: false }),
      ...(options.fakeAiRequiresKey === true ? { fakeAiRequiresKey: true } : {}),
      ...(options.fakeAiDelayMillis === undefined ? {} : { fakeAiDelayMillis: options.fakeAiDelayMillis }),
      ...(options.cacheMigration === true ? { cacheMigrationProbe: true } : {}),
      ...(options.paced === true ? { fakeSlackPaced: true } : {}),
    },
    {
      host,
      httpTransport: main.httpTransport,
      agentWrites: 'enabled',
      agentTransport: shell.agent.transport,
      logger: log.effectLogger,
      ...(fast ? { work: work.control, timing: fastTestTiming } : {}),
    },
  )
  await shell.agent.start()
  return { engine, log, testWork: work, cookie: main.cookie }
}

async function serveStatic(webRoot: string, request: IncomingMessage, response: ServerResponse, userData: string): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://host')
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const ready = readySession(userData)
    if (ready !== undefined && !url.searchParams.has('session')) {
      url.searchParams.set('session', JSON.stringify(ready))
      response.writeHead(302, { location: `/${url.search}` })
      response.end()
      return
    }
  }
  const path = normalize(join(webRoot, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)))
  if (!path.startsWith(webRoot + sep) || !existsSync(path)) {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('Not found')
    return
  }
  const hashed = path.includes(`${sep}assets${sep}`)
  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-store' })
  response.end(await readFile(path))
}

async function begin(start: HostStart): Promise<{ url: string }> {
  if (running !== undefined) throw new Error('The host already started')
  recordHostCoverage(start.coverage)
  const calls: Record<string, number> = {}
  const server = httpServer ??= createServer()
  const sockets = new WebSocketServer({ noServer: true })
  if (!server.listening) await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const transport = socketTransport({ host: '127.0.0.1', port })
  const shell = createShell(start.userData, start.engine)
  const started = await startEngineOn(start, start.engine, transport, calls, shell)
  server.on('request', (request, response) => {
    const files = { origin: new URL(start.fakeUrl).origin, aliases: start.aliases, cookie: () => running?.cookie() ?? '', userData: start.userData }
    serveFile(request, response, files)
      .then((served) => (served ? undefined : serveStatic(start.webRoot, request, response, start.userData)))
      .catch(() => {
        if (!response.headersSent) response.writeHead(500)
        response.end()
      })
  })
  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://host').pathname
    if (path !== ENGINE_SOCKET_PATH && path !== SHELL_SOCKET_PATH && path !== AGENT_SOCKET_PATH) return socket.destroy()
    sockets.handleUpgrade(request, socket, head, (ws) => {
      if (path === SHELL_SOCKET_PATH) shell.attach(ws)
      else if (path === AGENT_SOCKET_PATH) void shell.agent.attach(ws)
      else running?.transport.add(ws)
    })
  })
  const url = `http://127.0.0.1:${port}/`
  running = {
    start,
    engineOptions: start.engine,
    engine: started.engine,
    log: started.log,
    testWork: started.testWork,
    cookie: started.cookie,
    calls,
    shell,
    transport,
    url,
    stopped: false,
    close: async () => {
      for (const client of sockets.clients) client.terminate()
      await new Promise<void>((resolve) => sockets.close(() => resolve()))
      server.removeAllListeners('request')
      server.removeAllListeners('upgrade')
      server.closeAllConnections()
    },
  }
  return { url }
}

/** Stops the engine, as quitting the app does; the data folder stays for `startEngine`. */
async function quitEngine(): Promise<void> {
  const current = running
  if (current === undefined) throw new Error('The host has not started')
  if (current.stopped) return
  current.stopped = true
  await current.shell.agent.stop()
  await current.engine.stop()
  await current.log.close()
}

/** Starts the engine again on the same folder, as opening the app again does. */
async function startEngineAgain(engine: EngineOptions | undefined): Promise<void> {
  const current = running
  if (current === undefined) throw new Error('The host has not started')
  if (!current.stopped) throw new Error('The engine is still running; quit it first')
  current.engineOptions = { ...current.engineOptions, ...engine }
  const started = await startEngineOn(current.start, current.engineOptions, current.transport, current.calls, current.shell)
  current.stopped = false
  current.engine = started.engine
  current.log = started.log
  current.testWork = started.testWork
  current.cookie = started.cookie
}

function workPass(name: 'title' | 'art' | 'home' | 'automated'): Promise<void> {
  const current = running
  if (current === undefined) return Promise.reject(new Error('The host has not started'))
  return new Promise<void>((resolve, reject) => {
    const id = ++nextWork
    const timer = setTimeout(() => {
      workReplies.delete(id)
      reject(new Error(`${name} pass did not finish within 10 s`))
    }, 10_000)
    workReplies.set(id, (error) => {
      clearTimeout(timer)
      workReplies.delete(id)
      if (error === undefined) resolve()
      else reject(new Error(error))
    })
    current.testWork.request({ _tag: 'testWork', id, name })
  })
}

async function stop(): Promise<void> {
  const current = running
  running = undefined
  if (current === undefined) return
  try {
    if (!current.stopped) {
      await current.shell.agent.stop()
      await current.engine.stop()
      await current.log.close()
    }
  } finally {
    await current.close()
    await current.shell.close()
    asks.clear()
    for (const reply of workReplies.values()) reply('The host stopped')
  }
}

async function run(command: HostCommand): Promise<unknown> {
  switch (command.type) {
    case 'start':
      return begin(command.start)
    case 'quitEngine':
      return quitEngine()
    case 'startEngine':
      return startEngineAgain(command.engine)
    case 'workPass':
      return workPass(command.name)
    case 'aiCalls':
      return { ...running?.calls }
    case 'system': {
      if (running === undefined) throw new Error('The host has not started')
      return Reflect.apply(running.shell.hooks[command.call.name], undefined, command.call.args)
    }
    case 'stop':
      return stop()
  }
}

process.on('message', (message: WorkerMessage) => {
  if (message.type === 'reply') {
    asks.get(message.id)?.(message.value)
    asks.delete(message.id)
    return
  }
  run(message.command).then(
    (value) => send({ type: 'answer', id: message.id, value }),
    (cause: unknown) => send({ type: 'answer', id: message.id, error: cause instanceof Error ? `${cause.message}\n${cause.stack ?? ''}` : String(cause) }),
  )
})
// The worker that forked us went away: nothing else will stop us.
process.on('disconnect', () => {
  void stop().finally(() => process.exit(0))
})
send({ type: 'loaded' })
