/**
 * Entry of the engine utility process. Main forks this file (built to
 * out/main/engine.js) with `partition: 'persist:slack'`, sends the config over
 * parentPort, and hands over one MessagePort per renderer. This file owns the
 * one parentPort listener; everything else is `@juno/engine`, which never
 * imports Electron.
 */
import { Schema } from 'effect'
import { MainToEngine, type EngineToMain } from '@juno/contract'
import { electronTransport, startEngine } from '@juno/engine'

const parent = process.parentPort
const decode = Schema.decodeUnknownSync(MainToEngine)
const transport = electronTransport()
// parentPort has no target origin; the unicorn rule is about window.postMessage.
// oxlint-disable-next-line unicorn/require-post-message-target-origin
const send = (message: EngineToMain) => parent.postMessage(message)

let started = false
parent.on('message', (event) => {
  let message: MainToEngine
  try {
    message = decode(event.data)
  } catch (cause) {
    console.error('engine: bad message from main', cause)
    return
  }
  switch (message._tag) {
    case 'config': {
      if (started) return
      started = true
      startEngine(transport, message.config).then(
        () => send({ _tag: 'ready' }),
        (cause: unknown) => {
          console.error('engine: failed to start', cause)
          process.exit(1)
        },
      )
      return
    }
    case 'port': {
      const port = event.ports[0]
      if (port) transport.add(port)
      return
    }
  }
})
