/**
 * Supervises the agent utility process (ADR 0012) and brokers its ports. The
 * agent is forked without the Slack partition: it never sees Slack cookies.
 *
 * - The engine: whenever both are up (the engine reports ready, or the agent
 *   spawns while the engine is ready), main makes a new channel and gives
 *   one end to the engine (`agentPort`) and the other to the agent
 *   (`hostPort`), so each follows the other's restarts.
 * - The renderer: on request (`agent.requestPort`), main makes a channel and
 *   gives one end to the renderer and the other to the agent
 *   (`rendererPort`), at once or when the agent next spawns. When the agent
 *   dies the renderer's port closes and the renderer asks again.
 *
 * The agent restarts on exit like the engine (architecture 2.5): exponential
 * backoff from 1 s to 30 s, and it gives up after 5 exits in two minutes.
 * A send the agent had in flight when it died is still answered by the host
 * (`@juno/agent-juno`, single-attempt dispatch).
 *
 * Off unless JUNO_AGENT=1 until the chat ships (M2); a renderer that asks
 * for a port is told `failed`. The OpenRouter key is main's
 * (`keychain.ts`): each new agent process gets the current one once it is
 * loaded, and a running one gets every change. OAuth requests come with
 * Connections (WP17).
 */
import { app, MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess, type WebContents } from 'electron'
import { join } from 'node:path'
import { Schema } from 'effect'
import { AgentToMain, type AgentConfig, type HostHello, type MainToAgent } from '@juno/agent-contract'
import { Events } from '@juno/contract/channels'
import type { PortRequestResult } from '@juno/contract'

const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 30_000
const CRASH_WINDOW_MS = 120_000
const CRASH_LIMIT = 5

export type AgentState = 'stopped' | 'starting' | 'ready' | 'restarting' | 'failed'

const decodeFromAgent = Schema.decodeUnknownSync(AgentToMain)

export class AgentSupervisor {
  private child: UtilityProcess | undefined
  private spawned = false
  private state: AgentState = 'stopped'
  private hello: HostHello | undefined
  private readonly exits: Array<number> = []
  private attempt = 0
  private restartTimer: NodeJS.Timeout | undefined
  /** Renderer ports asked for while the agent was not spawned, by renderer. */
  private readonly pendingRendererPorts = new Map<WebContents, MessagePortMain>()
  /** The OpenRouter key main holds; undefined until the keychain has been read. */
  private openRouterKey: string | null | undefined

  constructor(
    private readonly config: AgentConfig,
    /** Hands one end of a new channel to the engine. */
    private readonly sendToEngine: (port: MessagePortMain) => void,
    /** Whether the engine is ready to take a port now. */
    private readonly engineReady: () => boolean,
  ) {}

  get currentState(): AgentState {
    return this.state
  }

  get host(): HostHello | undefined {
    return this.hello
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  start(): void {
    if (this.child) return
    this.state = 'starting'
    const child = utilityProcess.fork(join(__dirname, 'agent.js'), [], { serviceName: 'juno-agent', stdio: 'inherit' })
    this.child = child
    child.on('spawn', () => {
      this.spawned = true
      this.send({ _tag: 'config', config: this.config })
      if (this.openRouterKey !== undefined) this.send({ _tag: 'openRouterKey', key: this.openRouterKey })
      if (this.engineReady()) this.linkHost()
      for (const port of this.pendingRendererPorts.values()) this.send({ _tag: 'rendererPort' }, [port])
      this.pendingRendererPorts.clear()
    })
    child.on('message', (data: unknown) => {
      let message: AgentToMain
      try {
        message = decodeFromAgent(data)
      } catch (cause) {
        console.error('main: bad message from agent', cause)
        return
      }
      if (message._tag === 'ready') {
        this.state = 'ready'
        this.attempt = 0
        this.hello = message.host
      }
    })
    child.on('exit', (code) => this.onExit(code))
  }

  /** The key to give the agent: now if it runs, and to every process it starts later. */
  setOpenRouterKey(key: string | null): void {
    this.openRouterKey = key
    if (this.child && this.spawned) this.send({ _tag: 'openRouterKey', key })
  }

  /** A new channel between the engine's AgentHost server and the agent. Call when the engine is ready. */
  linkHost(): void {
    if (!this.child || !this.spawned) return
    const { port1, port2 } = new MessageChannelMain()
    this.sendToEngine(port1)
    this.send({ _tag: 'hostPort' }, [port2])
  }

  /** A new channel between a renderer and the agent's RPCs. `failed` when no agent will run. */
  connect(target: WebContents): PortRequestResult {
    if (this.state === 'failed' || this.state === 'stopped') return 'failed'
    const { port1, port2 } = new MessageChannelMain()
    if (this.child && this.spawned) {
      this.send({ _tag: 'rendererPort' }, [port1])
    } else {
      // A renderer that asks again while waiting replaces its earlier request.
      this.pendingRendererPorts.get(target)?.close()
      this.pendingRendererPorts.set(target, port1)
      target.once('destroyed', () => {
        if (this.pendingRendererPorts.get(target) !== port1) return
        port1.close()
        this.pendingRendererPorts.delete(target)
      })
    }
    target.postMessage(Events.agentPort, null, [port2])
    return 'sent'
  }

  stop(): void {
    this.state = 'stopped'
    this.dropPendingRendererPorts()
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    this.child?.kill()
    this.child = undefined
  }

  /** Closing the waiting ends makes each renderer ask again, and hear `failed`. */
  private dropPendingRendererPorts(): void {
    for (const port of this.pendingRendererPorts.values()) port.close()
    this.pendingRendererPorts.clear()
  }

  private send(message: MainToAgent, ports?: Array<MessagePortMain>): void {
    this.child?.postMessage(message, ports)
  }

  private onExit(code: number): void {
    this.child = undefined
    this.spawned = false
    this.hello = undefined
    if (this.state === 'stopped' || this.state === 'failed') return
    const now = Date.now()
    this.exits.push(now)
    while (this.exits.length > 0 && now - this.exits[0]! > CRASH_WINDOW_MS) this.exits.shift()
    if (this.exits.length >= CRASH_LIMIT) {
      console.error(`main: agent exited ${CRASH_LIMIT} times in two minutes (last code ${code}); giving up`)
      this.state = 'failed'
      this.dropPendingRendererPorts()
      return
    }
    this.state = 'restarting'
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.attempt, BACKOFF_CAP_MS)
    this.attempt++
    console.warn(`main: agent exited with code ${code}; restarting in ${delay} ms`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (this.state === 'restarting') this.start()
    }, delay)
  }
}

export function createAgentSupervisor(sendToEngine: (port: MessagePortMain) => void, engineReady: () => boolean): AgentSupervisor {
  const e2e = process.env.JUNO_E2E === '1'
  // Read only under JUNO_E2E, so a real run can never be pointed elsewhere.
  const openRouterOrigin = e2e ? process.env.JUNO_FAKE_OPENROUTER_URL : undefined
  return new AgentSupervisor(
    { agentDir: join(app.getPath('userData'), 'agent'), e2e, ...(openRouterOrigin === undefined ? {} : { openRouterOrigin }) },
    sendToEngine,
    engineReady,
  )
}
