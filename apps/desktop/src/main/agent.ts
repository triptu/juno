/**
 * Supervises the agent utility process (ADR 0012) and brokers its port to the
 * engine. The agent is forked without the Slack partition: it never sees
 * Slack cookies. Each time the engine is ready, main makes a new channel and
 * gives one end to the engine (`agentPort`) and the other to the agent
 * (`hostPort`), so the agent follows engine restarts.
 *
 * Off unless JUNO_AGENT=1 until the chat ships (M2, WP13). WP13 adds restart
 * with backoff, the renderer port and the keychain and OAuth requests.
 */
import { app, MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { Schema } from 'effect'
import { AgentToMain, type AgentConfig, type HostHello, type MainToAgent } from '@juno/agent-contract'

export type AgentState = 'stopped' | 'starting' | 'ready' | 'exited'

const decodeFromAgent = Schema.decodeUnknownSync(AgentToMain)

export class AgentSupervisor {
  private child: UtilityProcess | undefined
  private spawned = false
  private pendingPort: MessagePortMain | undefined
  private state: AgentState = 'stopped'
  private hello: HostHello | undefined

  constructor(
    private readonly config: AgentConfig,
    /** Hands one end of a new channel to the engine. */
    private readonly sendToEngine: (port: MessagePortMain) => void,
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
      if (this.pendingPort) this.send({ _tag: 'hostPort' }, [this.pendingPort])
      this.pendingPort = undefined
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
        this.hello = message.host
      }
    })
    child.on('exit', (code) => {
      this.child = undefined
      this.spawned = false
      if (this.state === 'stopped') return
      this.state = 'exited'
      console.warn(`main: agent exited with code ${code}`)
    })
  }

  /** Call when the engine is ready: a new channel between the engine's AgentHost server and the agent. */
  linkHost(): void {
    if (!this.child) return
    const { port1, port2 } = new MessageChannelMain()
    this.sendToEngine(port1)
    if (this.spawned) {
      this.send({ _tag: 'hostPort' }, [port2])
    } else {
      this.pendingPort?.close()
      this.pendingPort = port2
    }
  }

  stop(): void {
    this.state = 'stopped'
    this.child?.kill()
    this.child = undefined
  }

  private send(message: MainToAgent, ports?: Array<MessagePortMain>): void {
    this.child?.postMessage(message, ports)
  }
}

export function createAgentSupervisor(sendToEngine: (port: MessagePortMain) => void): AgentSupervisor {
  return new AgentSupervisor({ agentDir: join(app.getPath('userData'), 'agent'), e2e: process.env.JUNO_E2E === '1' }, sendToEngine)
}
