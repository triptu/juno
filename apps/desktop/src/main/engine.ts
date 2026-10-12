/**
 * Supervises the engine utility process (ADR 0001, architecture 2.5).
 *
 * Forks it with the `persist:slack` partition, restarts it on exit with
 * exponential backoff (1 s base, 30 s cap) and gives up after 5 exits in two
 * minutes. Hands out MessagePorts: one end to the engine, the other to a
 * renderer. Ports requested while the engine is down are queued and sent once
 * it reports `ready`, so a renderer reconnecting after a crash just waits.
 */
import { app, MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess, type WebContents } from 'electron'
import { join } from 'node:path'
import { Schema } from 'effect'
import { Events, EngineToMain, type EngineConfig, type MainToEngine } from '@juno/contract'

const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 30_000
const CRASH_WINDOW_MS = 120_000
const CRASH_LIMIT = 5

export type SupervisorState = 'starting' | 'ready' | 'restarting' | 'failed' | 'stopped'

const decodeFromEngine = Schema.decodeUnknownSync(EngineToMain)

export class EngineSupervisor {
  private child: UtilityProcess | undefined
  private state: SupervisorState = 'stopped'
  private readonly pendingPorts: Array<MessagePortMain> = []
  private readonly exits: Array<number> = []
  private attempt = 0
  private restartTimer: NodeJS.Timeout | undefined

  constructor(private readonly config: EngineConfig) {}

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
        for (const port of this.pendingPorts.splice(0)) this.send({ _tag: 'port' }, [port])
      }
    })
    child.on('exit', (code) => this.onExit(code))
  }

  /** Connects a renderer: one new channel, one end to each side. */
  connect(target: WebContents): void {
    const { port1, port2 } = new MessageChannelMain()
    if (this.state === 'ready') this.send({ _tag: 'port' }, [port1])
    else this.pendingPorts.push(port1)
    target.postMessage(Events.enginePort, null, [port2])
  }

  /** Ends the engine for good, on app quit. */
  stop(): void {
    this.state = 'stopped'
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.child?.kill()
    this.child = undefined
  }

  private send(message: MainToEngine, ports?: Array<MessagePortMain>): void {
    this.child?.postMessage(message, ports)
  }

  private onExit(code: number): void {
    this.child = undefined
    if (this.state === 'stopped') return
    const now = Date.now()
    this.exits.push(now)
    while (this.exits.length > 0 && now - this.exits[0]! > CRASH_WINDOW_MS) this.exits.shift()
    if (this.exits.length >= CRASH_LIMIT) {
      this.state = 'failed'
      console.error(`main: engine exited ${CRASH_LIMIT} times in two minutes (last code ${code}); giving up`)
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

export function createSupervisor(): EngineSupervisor {
  return new EngineSupervisor({ userData: app.getPath('userData'), e2e: process.env.JUNO_E2E === '1' })
}
