import { MessageChannel } from 'node:worker_threads'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import type { HostPort } from '@juno/agent'
import type { AgentProvider } from '@juno/agent-contract'
import type { MainToEngine, ProviderChange, ProviderState } from '@juno/contract'
import { memoryTransport } from '@juno/engine'
import type { WebSocket } from 'ws'
import type { FromClientEncoded, FromServerEncoded } from 'effect/rpc/RpcMessage'
import { ProviderStore } from '../../src/main/providers'
import { memoryKeychain, memoryKeychains } from '../../src/main/keychain'
import { appMcpCredentials } from '../../src/main/mcpCredentials'
import { appBackupSecrets } from '../../src/main/backupSecrets'
import { codexExecutable, codexHome } from '../../src/main/codex'
import { createLog } from '../../src/logging'

export interface AgentOptions {
  readonly agent?: boolean
  readonly fakeOpenRouterUrl?: string
  readonly codemode?: boolean
  readonly deviceName?: string
  readonly backupIntervalMs?: number
}

/** Main's provider store and agent configuration, with memory secrets and an in-process host port. */
export class BrowserAgent {
  readonly transport = memoryTransport()
  readonly #keychain = memoryKeychains()
  readonly secrets = appBackupSecrets(this.#keychain)
  readonly #credentials = appMcpCredentials(true, this.#keychain, async () => {})
  readonly #log: ReturnType<typeof createLog>
  readonly providers: ProviderStore
  /** Juno's own Codex home, as main checks it under JUNO_E2E. */
  readonly codex: ReturnType<typeof codexHome>
  #agent: Awaited<ReturnType<typeof import('@juno/agent').startAgent>> | undefined
  #runtime: typeof import('@juno/agent') | undefined
  #connection: ReturnType<typeof import('@juno/agent').providerConnection> | undefined
  #renderers: ReturnType<typeof import('@juno/agent').rendererPorts> | undefined
  #work: Promise<void> = Promise.resolve()
  #started = false
  #engineKey: string | null = null
  readonly #sockets = new Set<WebSocket>()
  #restartRequested = false
  state = 'stopped'

  constructor(readonly userData: string, readonly options: AgentOptions, readonly send: (message: MainToEngine) => void, readonly changed: (state: ProviderState) => void) {
    this.#log = createLog('agent', join(userData, 'logs'))
    this.codex = codexHome(join(userData, 'agent'), codexExecutable(true))
    this.providers = new ProviderStore(userData, {
      openRouter: memoryKeychain(options.agent ? 'sk-or-v1-e2e-launch-0123456789abcdef' : undefined), custom: memoryKeychain(),
    }, undefined, (state, provider, key) => {
      this.#engineKey = key
      send({ _tag: 'aiKey', key })
      changed(state)
      if (this.#started) this.enqueue(() => this.update(provider))
    })
  }

  private enqueue(run: () => Promise<void>): void {
    this.#work = this.#work.then(run).catch((cause: unknown) => {
      this.state = 'failed'
      this.#log.log('ERROR', 'agent failed', { cause })
    })
  }

  async start(): Promise<void> {
    await this.providers.load()
    this.send({ _tag: 'aiKey', key: this.#engineKey })
    this.#started = true
    this.enqueue(() => this.update(this.providers.provider))
    await this.#work
  }

  async set(change: ProviderChange) { return this.providers.set(change) }

  /** A Codex sign-in that worked starts an agent that was off for want of a provider, as main's does. */
  async codexSignIn() {
    const after = await this.codex.signIn()
    if (after === 'signedIn' && this.#started) this.enqueue(() => this.update(this.providers.provider))
    return after
  }

  private async update(provider: AgentProvider | null): Promise<void> {
    this.#connection?.set(provider)
    // A signed-in Codex home runs the agent with no API provider (main's `setProvider`).
    if (provider === null && !existsSync(join(this.userData, 'agent', 'codex', 'auth.json'))) { await this.stopAgent(); return }
    if (this.#agent !== undefined) return
    this.state = 'starting'
    const runtime = this.#runtime ??= await import('@juno/agent')
    const connection = this.#connection = runtime.providerConnection()
    connection.set(provider)
    this.#renderers = runtime.rendererPorts()
    const origin = this.options.fakeOpenRouterUrl
    const agentDir = join(this.userData, 'agent')
    const picker = runtime.modelPicker(connection, { ...(origin === undefined ? {} : { origin }), codex: { agentDir, executable: () => 'codex' } })
    const mcp = runtime.credentialBridge((requestId, request) => {
      void this.#credentials(request).then((value) => mcp.answer({ requestId, ok: true, ...(value === undefined ? {} : { value }) }), () => mcp.answer({ requestId, ok: false }))
    })
    const keychain = runtime.keychainBridge((requestId, request) => {
      void this.secrets.answer(request).then((value) => keychain.answer({ requestId, ok: true, ...(value === undefined ? {} : { value }) }), () => keychain.answer({ requestId, ok: false }))
    })
    const codemode = { wasmPath: join(import.meta.dirname, 'quickjs.wasm'), workerUrl: pathToFileURL(join(import.meta.dirname, 'codemode-worker.mjs')) }
    this.#agent = await runtime.startAgent({ agentDir, e2e: true, ...(origin === undefined ? {} : { openRouterOrigin: origin }), ...(this.options.codemode ? { codemode: true } : {}) }, { acquire: () => this.hostPort() }, {
      logger: this.#log.effectLogger,
      turns: {
        ...runtime.providerTurns(connection, picker), peopleRefresh: false,
        ...(this.options.codemode ? { codemode } : {}),
        backup: { keychain: keychain.keychain, deviceName: this.options.deviceName ?? 'Browser test', restart: () => { this.#restartRequested = true }, ...(this.options.backupIntervalMs === undefined ? {} : { intervalMs: this.options.backupIntervalMs }) },
        onReport: (cause) => this.#log.log('ERROR', 'process failed', { cause }),
      },
      renderer: this.#renderers,
      mcp: { credentials: mcp.credentials, review: runtime.reviewModel(connection, origin === undefined ? {} : { origin }) },
    })
    if (this.options.codemode) {
      const result = await runtime.probeSandbox(codemode)
      mkdirSync(agentDir, { recursive: true })
      writeFileSync(join(agentDir, 'codemode-probe.json'), JSON.stringify(result))
    }
    this.state = 'ready'
  }

  private hostPort(): Promise<HostPort> {
    const { port1, port2 } = new MessageChannel()
    this.transport.add({
      postMessage: (data) => port2.postMessage(data),
      addEventListener: (event, listener) => { if (event === 'message') port2.on('message', (data) => listener({ data })); else port2.on('close', listener) },
      start: () => port2.start(), close: () => port2.close(),
    })
    return Promise.resolve({ postMessage: (data) => port1.postMessage(data), onMessage: (listener) => { port1.on('message', listener) }, onClose: (listener) => { port1.on('close', listener) }, close: () => port1.close() })
  }

  async attach(socket: WebSocket): Promise<void> {
    await this.#work
    if (this.#renderers === undefined || this.state !== 'ready') { socket.close(); return }
    this.#sockets.add(socket)
    socket.on('close', () => this.#sockets.delete(socket))
    const ownershipRequests = new Set<string | number>()
    this.#renderers.add({
      postMessage: (data) => {
        const [, message] = data as readonly [number, FromServerEncoded | undefined]
        const restart = this.#restartRequested && message?._tag === 'Exit' && ownershipRequests.has(message.requestId)
        if (message?._tag === 'Exit') ownershipRequests.delete(message.requestId)
        socket.send(JSON.stringify(data), () => {
          if (!restart) return
          this.#restartRequested = false
          this.enqueue(async () => { await this.stopAgent(); await this.update(this.providers.provider) })
        })
      },
      onMessage: (listener) => { socket.on('message', (data) => {
        const decoded = JSON.parse(data.toString()) as readonly [number, FromClientEncoded | undefined]
        const message = decoded[1]
        if (message?._tag === 'Request' && message.tag === 'agent.settings.ownership') ownershipRequests.add(message.id)
        listener(decoded)
      }) },
      onClose: (listener) => { socket.on('close', listener) },
      close: () => socket.close(),
    })
  }

  private async stopAgent(): Promise<void> {
    // A closed transport makes live queries reconnect; graceful RPC completion would leave them done.
    // The restore reply is flushed before this path closes the requesting socket.
    for (const socket of this.#sockets) socket.close()
    this.#sockets.clear()
    await this.#agent?.stop()
    this.#agent = undefined
    this.#renderers = undefined
    this.state = 'stopped'
  }

  async stop(): Promise<void> { await this.#work; await this.stopAgent() }
  async close(): Promise<void> { await this.stop(); await this.#log.close() }
}
