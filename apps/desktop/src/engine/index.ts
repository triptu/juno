/**
 * Entry of the engine utility process. Main forks this file (built to
 * out/main/engine.js) with `partition: 'persist:slack'`, sends the config over
 * parentPort, and hands over one MessagePort per renderer. Everything else
 * is `@juno/engine`, which never imports Electron.
 */
import { Schema } from 'effect'
import { MainToEngine, type EngineToMain } from '@juno/contract'
import { parentPortTransport, startEngine } from '@juno/engine'

const parent = process.parentPort
const decode = Schema.decodeUnknownSync(MainToEngine)
const transport = parentPortTransport(parent)
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
  if (message._tag !== 'config' || started) return
  started = true
  startEngine(transport, message.config).then(
    () => send({ _tag: 'ready' }),
    (cause: unknown) => {
      console.error('engine: failed to start', cause)
      process.exit(1)
    },
  )
})
