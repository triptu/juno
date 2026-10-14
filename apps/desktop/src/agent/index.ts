/**
 * Entry of the agent utility process (ADR 0012). Main forks this file (built
 * to out/main/agent.js) without the Slack partition, sends the config and the
 * OpenRouter key over parentPort, hands over a port to the engine's AgentHost
 * server (again after every engine restart), and a port per renderer for the
 * chat. Everything else is `@juno/agent`, which never imports Electron.
 *
 * The agent opens the turn engine on OpenRouter with the default models
 * (`openRouterTurns`) and serves the renderer's RPCs on the renderer ports.
 */
import { Schema } from 'effect'
import { MainToAgent, type AgentToMain } from '@juno/agent-contract'
import { openRouterTurns, rendererPorts, startAgent, type HostPort } from '@juno/agent'
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
// The key arrives right after the config; a request waits for it, so the first send does not race it.
let openRouterKey: string | null | undefined
const keyWaiters: Array<(key: string | undefined) => void> = []
const apiKey = () =>
  new Promise<string | undefined>((resolve) => {
    if (openRouterKey !== undefined) resolve(openRouterKey ?? undefined)
    else keyWaiters.push(resolve)
  })

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
      startAgent(message.config, { acquire: nextPort }, { turns: openRouterTurns(apiKey), renderer: renderers }).then(
        (agent) => send({ _tag: 'ready', host: agent.host }),
        (cause: unknown) => {
          console.error('agent: failed to start', cause)
          process.exit(1)
        },
      )
      return
    }
    case 'openRouterKey': {
      openRouterKey = message.key
      for (const resolve of keyWaiters.splice(0)) resolve(message.key ?? undefined)
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
