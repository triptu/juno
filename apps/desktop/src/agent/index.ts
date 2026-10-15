/**
 * Entry of the agent utility process (ADR 0012). Main forks this file (built
 * to out/main/agent.js) without the Slack partition, sends the config and the
 * OpenRouter key over parentPort, hands over a port to the engine's AgentHost
 * server (again after every engine restart), and a port per renderer for the
 * chat. Everything else is `@juno/agent`, which never imports Electron.
 *
 * The agent opens the turn engine on OpenRouter with the owner's models
 * from Settings › Juno (`openRouterTurns`) and serves the renderer's RPCs
 * on the renderer ports. The key stays in memory (`openRouterKey`).
 */
import { Schema } from 'effect'
import { MainToAgent, type AgentToMain } from '@juno/agent-contract'
import { modelPicker, openRouterKey, openRouterTurns, rendererPorts, startAgent, type HostPort } from '@juno/agent'
import type { MessagePortMain } from 'electron'

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
    },
    onClose: (f) => {
      if (closed) f()
      else port.on('close', f)
    },
    close: () => port.close(),
  }
  port.start()
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

const renderers = rendererPorts()
// The key arrives from main once it has read the keychain; a request waits for it.
const key = openRouterKey()

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
      const picker = modelPicker(message.config.openRouterOrigin === undefined ? {} : { origin: message.config.openRouterOrigin })
      startAgent(message.config, { acquire: nextPort }, { turns: openRouterTurns(key, picker), renderer: renderers }).then(
        (agent) => send({ _tag: 'ready', host: agent.host }),
        (cause: unknown) => {
          console.error('agent: failed to start', cause)
          process.exit(1)
        },
      )
      return
    }
    case 'openRouterKey': {
      key.set(message.key)
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
