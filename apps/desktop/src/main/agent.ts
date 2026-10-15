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
 * The agent runs while a model provider is set up (`providers.ts`): main
 * starts it once the provider store has loaded one, sends every change to
 * the running process, and stops it when none is left. With none, a
 * renderer that asks for a port is told `failed`, and the Juno tab shows
 * "Add a provider".
 *
 * The agent's MCP connections ask main for their OAuth state and to open a
 * sign-in page (`credential`, WP17). `mcpCredentials.ts` answers; the answer
 * goes only to the process that asked, never to one started after it.
 */
import { app, MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess, type WebContents } from 'electron'
import { join } from 'node:path'
import { Schema } from 'effect'
import { AgentToMain, type AgentConfig, type AgentProvider, type CredentialRequest, type HostHello, type MainToAgent } from '@juno/agent-contract'
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
  /** The active provider; the agent runs only while there is one. */
  private provider: AgentProvider | null = null

  constructor(
    private readonly config: AgentConfig,
    /** Hands one end of a new channel to the engine. */
    private readonly sendToEngine: (port: MessagePortMain) => void,
    /** Whether the engine is ready to take a port now. */
    private readonly engineReady: () => boolean,
    /** Answers an MCP credential request (`mcpCredentials.ts`). */
    private readonly credential: (request: CredentialRequest) => Promise<string | null | undefined>,
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
      this.send({ _tag: 'provider', provider: this.provider })
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
      if (message._tag === 'credential') {
        const reply = (answer: Omit<Extract<MainToAgent, { _tag: 'credentialReply' }>, '_tag' | 'requestId'>) => {
          if (this.child === child) child.postMessage({ _tag: 'credentialReply', requestId: message.requestId, ...answer } satisfies MainToAgent)
        }
        // No detail crosses back: a keychain error could echo what it was given.
        this.credential(message.request).then((value) => reply({ ok: true, ...(value === undefined ? {} : { value }) }), () => reply({ ok: false }))
        return
      }
      if (message._tag === 'ready') {
        this.state = 'ready'
        this.attempt = 0
        this.hello = message.host
      }
    })
    child.on('exit', (code) => {
      // A process stopped for a provider change may exit after its successor started.
      if (this.child !== undefined && this.child !== child) return
      this.onExit(code)
    })
  }

  /**
   * The provider to give the agent: starts the agent when there is one and
   * it is not running, hands a running one the change, and stops it when
   * there is none. A change after main gave up starts it again.
   */
  setProvider(provider: AgentProvider | null): void {
    this.provider = provider
    if (provider === null) {
      if (this.state !== 'stopped') this.stop()
      return
    }
    if (this.child) {
      if (this.spawned) this.send({ _tag: 'provider', provider })
      return
    }
    if (this.state === 'restarting') return
    this.exits.length = 0
    this.attempt = 0
    this.start()
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

export function createAgentSupervisor(
  sendToEngine: (port: MessagePortMain) => void,
  engineReady: () => boolean,
  credential: (request: CredentialRequest) => Promise<string | null | undefined>,
): AgentSupervisor {
  const e2e = process.env.JUNO_E2E === '1'
  // Read only under JUNO_E2E, so a real run can never be pointed elsewhere.
  const openRouterOrigin = e2e ? process.env.JUNO_FAKE_OPENROUTER_URL : undefined
  return new AgentSupervisor(
    { agentDir: join(app.getPath('userData'), 'agent'), e2e, ...(openRouterOrigin === undefined ? {} : { openRouterOrigin }) },
    sendToEngine,
    engineReady,
    credential,
  )
}
