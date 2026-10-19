import type { EngineToMain, MainToEngine } from '@juno/contract'
import type { EngineHostOptions } from '@juno/engine'
import { Effect } from 'effect'

type Request = Extract<MainToEngine, { _tag: 'testWork' }>
type Reply = Extract<EngineToMain, { _tag: 'testWorkDone' }>

/** Acknowledges only a serial job pass started after the e2e request. */
export function createTestWork(send: (reply: Reply) => void) {
  const wakes = new Map<string, Effect.Effect<void>>()
  const started = new Map<string, number>()
  const requests = new Map<number, { name: Request['name']; after: number }>()
  const control: NonNullable<EngineHostOptions['work']> = {
    onPass: (name, event) => {
      const count = started.get(name) ?? 0
      if (event === 'started') started.set(name, count + 1)
      else for (const [id, request] of requests) {
        if (request.name === name && count > request.after) {
          requests.delete(id)
          send({ _tag: 'testWorkDone', id })
        }
      }
    },
    onWake: (name, wake) => { if (wake === undefined) wakes.delete(name); else wakes.set(name, wake) },
  }
  return {
    control,
    request: (message: Request) => {
      const wake = wakes.get(message.name)
      if (wake === undefined) send({ _tag: 'testWorkDone', id: message.id, error: `${message.name} job is not ready` })
      else {
        requests.set(message.id, { name: message.name, after: started.get(message.name) ?? 0 })
        void Effect.runPromise(wake)
      }
    },
  }
}
