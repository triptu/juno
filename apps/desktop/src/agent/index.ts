/**
 * Entry of the agent utility process (ADR 0012). Main forks this file (built
 * to out/main/agent.js) without the Slack partition, sends the config and the
 * active model provider over parentPort, hands over a port to the engine's AgentHost
 * server (again after every engine restart), and a port per renderer for the
 * chat. Everything else is `@juno/agent`, which never imports Electron.
 *
 * The agent opens the turn engine on that provider (OpenRouter or an
 * OpenAI-compatible endpoint) with the owner's models from Settings › Juno
 * (`providerTurns`), once main has sent the provider, and serves the
 * renderer's RPCs on the renderer ports. Keys stay in memory.
 * `providerConnection` follows every later provider change.
 *
 * The MCP connections reach main's keychain and the system browser through
 * `credentialBridge`: a `credential` request to main, a `credentialReply`
 * back. OAuth state stays in this process's memory once loaded.
 *
 * The encrypted backup (WP21) reaches main's keychain the same way
 * (`keychainBridge`: `secret`, `secretReply`). After a restore is staged,
 * `restart` tells main and exits; main starts the agent again at once and
 * the next open installs the restore. This Mac's name for the
 * other Mac's banner is the computer name from System Settings.
 */
import { installProcessLog } from '../processLog'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Schema } from 'effect'
import { MainToAgent, type AgentToMain } from '@juno/agent-contract'
import { credentialBridge, keychainBridge, modelPicker, probeSandbox, providerConnection, providerTurns, rendererPorts, reviewModel, startAgent, type CodemodeRunner, type HostPort } from '@juno/agent'
import type { MessagePortMain } from 'electron'

const processLog = installProcessLog('agent')

const parent = process.parentPort
const decode = Schema.decodeUnknownSync(MainToAgent)
// parentPort has no target origin; the unicorn rule is about window.postMessage.
// oxlint-disable-next-line unicorn/require-post-message-target-origin
const send = (message: AgentToMain) => parent.postMessage(message)

function fromMessagePortMain(port: MessagePortMain): HostPort {
  // A renderer port can close before the server attaches; a late listener still hears it.
  let closed = false
  port.on('close', () => (closed = true))
  const hostPort: HostPort = {
    postMessage: (message) => port.postMessage(message),
    onMessage: (f) => {
      port.on('message', (event) => f(event.data))
      // Keep the host's ready frame queued until the RPC client can hear it.
      port.start()
    },
    onClose: (f) => {
      if (closed) f()
      else port.on('close', f)
    },
    close: () => port.close(),
  }
  return hostPort
}

// Host ports in arrival order. The client takes the next one each time its current port closes.
const ports: Array<HostPort> = []
const waiting: Array<(port: HostPort) => void> = []
const nextPort = () =>
  new Promise<HostPort>((resolve) => {
    const port = ports.shift()
    if (port) resolve(port)
    else waiting.push(resolve)
  })

/** "Tushar's MacBook Air", or the host name when System Settings has none. */
function computerName(): string {
  try {
    const name = execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2_000 }).trim()
    if (name !== '') return name
  } catch {
    // Not macOS, or scutil failed: the host name will do.
  }
  return hostname().replace(/\.local$/, '')
}

const renderers = rendererPorts()
const mcp = credentialBridge((requestId, request) => send({ _tag: 'credential', requestId, request }))
const secrets = keychainBridge((requestId, request) => send({ _tag: 'secret', requestId, request }))

let restarting = false
/**
 * After a staged restore. The restore's answer is still on its way to the renderer, so the exit waits a
 * moment. The process exits without a graceful stop: a stop would end the renderer's streams as if they
 * were done, while a closed port makes the renderer ask for the new process's. The store is safe to
 * leave this way (the crash harness kills it at every step), and the exit releases the owner lock.
 */
const restart = () => {
  if (restarting) return
  restarting = true
  setTimeout(() => {
    // Main ends this process when it reads `restart`; exiting here too covers a message that never arrives.
    send({ _tag: 'restart' })
    setTimeout(() => process.exit(0), 1_000).unref()
  }, 200)
}
/**
 * The codemode sandbox's QuickJS binary and worker, which the build writes
 * next to this file (`electron.vite.config.ts`, `codemodeFiles`).
 */
const codemodeRunner: CodemodeRunner = { wasmPath: join(__dirname, 'quickjs.wasm'), workerUrl: pathToFileURL(join(__dirname, 'codemode-worker.js')) }

/** Under Playwright with the flag on: one script in the sandbox, so a test can check it loads in this build. */
function probeCodemode(agentDir: string) {
  void probeSandbox(codemodeRunner).then((result) => {
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, 'codemode-probe.json'), JSON.stringify(result))
  })
}

// The provider arrives from main at spawn and on every change.
const connection = providerConnection()

let started = false
parent.on('message', (event) => {
  let message: MainToAgent
  try {
    message = decode(event.data)
  } catch (cause) {
    console.error('agent: bad message from main', cause)
    return
  }
  switch (message._tag) {
    case 'config': {
      if (started) return
      started = true
      const config = message.config
      if (config.e2e && config.codemode === true) probeCodemode(config.agentDir)
      const picker = modelPicker(connection, { ...(config.openRouterOrigin === undefined ? {} : { origin: config.openRouterOrigin }), codex: { agentDir: config.agentDir, executable: 'codex' } })
      // The engine opens on the saved model of the active provider, so it waits for main to name one.
      void connection
        .get()
        .then(() =>
          startAgent(config, { acquire: nextPort }, {
            logger: processLog.effectLogger,
            turns: {
              ...providerTurns(connection, picker),
              ...(config.codemode === true ? { codemode: codemodeRunner } : {}),
              peopleRefresh: config.peopleRefresh ?? !config.e2e,
              backup: {
                keychain: secrets.keychain,
                deviceName: config.deviceName ?? computerName(),
                restart,
                ...(config.backupIntervalMs === undefined ? {} : { intervalMs: config.backupIntervalMs }),
              },
              // Paths and error codes only: no key, phrase or message text reaches an error the backup throws.
              onReport: (cause) => processLog.log('ERROR', 'process failed', { cause }),
            },
            renderer: renderers,
            // The auto-review of connection calls asks the decision model on the owner's OpenRouter key.
            mcp: { credentials: mcp.credentials, review: reviewModel(connection, config.openRouterOrigin === undefined ? {} : { origin: config.openRouterOrigin }) },
          }),
        )
        .then(
        (agent) => { processLog.log('INFO', 'process ready'); send({ _tag: 'ready', host: agent.host }) },
        (cause: unknown) => {
          console.error('agent: failed to start', cause)
          void processLog.close().finally(() => process.exit(1))
        },
      )
      return
    }
    case 'provider': {
      connection.set(message.provider)
      return
    }
    case 'credentialReply': {
      mcp.answer(message)
      return
    }
    case 'secretReply': {
      secrets.answer(message)
      return
    }
    case 'rendererPort': {
      const raw = event.ports[0]
      if (raw) renderers.add(fromMessagePortMain(raw))
      return
    }
    case 'hostPort': {
      const raw = event.ports[0]
      if (!raw) return
      const port = fromMessagePortMain(raw)
      const resolve = waiting.shift()
      if (resolve) resolve(port)
      else ports.push(port)
      return
    }
  }
})
