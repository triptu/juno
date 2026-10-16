/**
 * Supervises the engine utility process (ADR 0001, architecture 2.5).
 *
 * Forks it with the `persist:slack` partition, restarts it on exit with
 * exponential backoff (1 s base, 30 s cap) and gives up after 5 exits in two
 * minutes; the user's Restart starts it again. Hands out MessagePorts: one end to the engine, the other to a
 * renderer. A port requested while the engine is down is held, at most one
 * per renderer, and sent once it reports `ready`, so a renderer reconnecting
 * after a crash just waits. Once the supervisor has given up, a request is
 * answered `failed` and the renderer shows it.
 */
import { app, MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess, type WebContents } from 'electron'
import { join } from 'node:path'
import { Schema } from 'effect'
import { Events, EngineToMain, type EngineConfig, type MainToEngine, type PortRequestResult } from '@juno/contract'

const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 30_000
const CRASH_WINDOW_MS = 120_000
const CRASH_LIMIT = 5

export type SupervisorState = 'starting' | 'ready' | 'restarting' | 'failed' | 'stopped'

const decodeFromEngine = Schema.decodeUnknownSync(EngineToMain)

export class EngineSupervisor {
  private child: UtilityProcess | undefined
  private state: SupervisorState = 'stopped'
  private readonly pendingPorts = new Map<WebContents, MessagePortMain>()
  private readonly exits: Array<number> = []
  private readonly readyListeners = new Set<() => void>()
  private attempt = 0
  private restartTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly config: EngineConfig,
    /** Every message from the engine other than `ready`. */
    private readonly onMessage: (message: EngineToMain) => void = () => {},
  ) {}

  get currentState(): SupervisorState {
    return this.state
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  start(): void {
    if (this.child) return
    this.state = 'starting'
    const child = utilityProcess.fork(join(__dirname, 'engine.js'), [], {
      serviceName: 'juno-engine',
      partition: 'persist:slack',
      stdio: 'inherit',
    })
    this.child = child
    child.on('spawn', () => this.send({ _tag: 'config', config: this.config }))
    child.on('message', (data: unknown) => {
      let message: EngineToMain
      try {
        message = decodeFromEngine(data)
      } catch (cause) {
        console.error('main: bad message from engine', cause)
        return
      }
      if (message._tag === 'ready') {
        this.state = 'ready'
        this.attempt = 0
        for (const port of this.pendingPorts.values()) this.send({ _tag: 'port' }, [port])
        this.pendingPorts.clear()
        for (const listener of this.readyListeners) listener()
      } else {
        this.onMessage(message)
      }
    })
    child.on('exit', (code) => this.onExit(code))
  }

  /** Calls `f` each time the engine reports ready, after a restart too. */
  onReady(f: () => void): void {
    this.readyListeners.add(f)
  }

  /** Connects a renderer: one new channel, one end to each side. */
  connect(target: WebContents): PortRequestResult {
    if (this.state === 'failed' || this.state === 'stopped') return 'failed'
    const { port1, port2 } = new MessageChannelMain()
    if (this.state === 'ready') {
      this.send({ _tag: 'port' }, [port1])
    } else {
      // A renderer that asks again while waiting replaces its earlier request.
      this.pendingPorts.get(target)?.close()
      this.pendingPorts.set(target, port1)
    }
    target.postMessage(Events.enginePort, null, [port2])
    return 'sent'
  }

  /** Ends the engine for good, on app quit. */
  stop(): void {
    this.state = 'stopped'
    this.end()
  }

  /** Starts the engine again after the supervisor gave up on it, with a fresh crash count. Does nothing otherwise. */
  restart(): void {
    if (this.state !== 'failed') return
    this.exits.length = 0
    this.attempt = 0
    this.start()
  }

  /** Stops restarting. Reached after too many crashes; tests call it directly. */
  giveUp(): void {
    this.state = 'failed'
    this.end()
    // Renderers waiting on a port see it close and ask again, and get `failed`.
    for (const port of this.pendingPorts.values()) port.close()
    this.pendingPorts.clear()
  }

  private end(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    this.child?.kill()
    this.child = undefined
  }

  /** Posts a message to the engine. Dropped while it is down; the engine asks again after a restart. */
  send(message: MainToEngine, ports?: Array<MessagePortMain>): void {
    this.child?.postMessage(message, ports)
  }

  private onExit(code: number): void {
    this.child = undefined
    if (this.state === 'stopped' || this.state === 'failed') return
    const now = Date.now()
    this.exits.push(now)
    while (this.exits.length > 0 && now - this.exits[0]! > CRASH_WINDOW_MS) this.exits.shift()
    if (this.exits.length >= CRASH_LIMIT) {
      console.error(`main: engine exited ${CRASH_LIMIT} times in two minutes (last code ${code}); giving up`)
      this.giveUp()
      return
    }
    this.state = 'restarting'
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.attempt, BACKOFF_CAP_MS)
    this.attempt++
    console.warn(`main: engine exited with code ${code}; restarting in ${delay} ms`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (this.state === 'restarting') this.start()
    }, delay)
  }
}

export function createSupervisor(options: { readonly fakeSlackUrl?: string; readonly onMessage?: (message: EngineToMain) => void } = {}): EngineSupervisor {
  const e2e = process.env.JUNO_E2E === '1'
  // Tests and `JUNO_AI=fake` get the deterministic provider. The OpenRouter key
  // comes from the environment for now (ADR 0006: the key stays in memory);
  // without it every AI task answers "no decision" and the app runs as before.
  const ai = e2e || process.env.JUNO_AI === 'fake' ? 'fake' : 'live'
  const openRouterApiKey = e2e ? undefined : process.env.OPENROUTER_API_KEY
  // An e2e run can make the fake AI slow, to watch a check give up at its timeout.
  const fakeAiDelayMillis = e2e ? Number(process.env.JUNO_FAKE_AI_DELAY_MS) : Number.NaN
  // An e2e run can keep production request pacing against the fake, to time a first sync.
  const fakeSlackPaced = e2e && process.env.JUNO_E2E_FAKE_PACED === '1'
  return new EngineSupervisor(
    {
      userData: app.getPath('userData'),
      e2e,
      dev: !app.isPackaged,
      ...(options.fakeSlackUrl === undefined ? {} : { fakeSlackUrl: options.fakeSlackUrl }),
      ...(fakeSlackPaced ? { fakeSlackPaced } : {}),
      ai,
      ...(openRouterApiKey ? { openRouterApiKey } : {}),
      ...(Number.isFinite(fakeAiDelayMillis) ? { fakeAiDelayMillis } : {}),
    },
    options.onMessage,
  )
}
