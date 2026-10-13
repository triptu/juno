/**
 * Entry of the agent utility process (ADR 0012). Main forks this file (built
 * to out/main/agent.js) without the Slack partition, sends the config over
 * parentPort, and hands over a port to the engine's AgentHost server, again
 * after every engine restart. Everything else is `@juno/agent`, which never
 * imports Electron.
 */
import { Schema } from 'effect'
import { MainToAgent, type AgentToMain } from '@juno/agent-contract'
import { startAgent, type HostPort } from '@juno/agent'
import type { MessagePortMain } from 'electron'

const parent = process.parentPort
const decode = Schema.decodeUnknownSync(MainToAgent)
// parentPort has no target origin; the unicorn rule is about window.postMessage.
// oxlint-disable-next-line unicorn/require-post-message-target-origin
const send = (message: AgentToMain) => parent.postMessage(message)

function fromMessagePortMain(port: MessagePortMain): HostPort {
  const hostPort: HostPort = {
    postMessage: (message) => port.postMessage(message),
    onMessage: (f) => {
      port.on('message', (event) => f(event.data))
    },
    onClose: (f) => {
      port.on('close', f)
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
      startAgent(message.config, { acquire: nextPort }).then(
        (agent) => send({ _tag: 'ready', host: agent.host }),
        (cause: unknown) => {
          console.error('agent: failed to start', cause)
          process.exit(1)
        },
      )
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
