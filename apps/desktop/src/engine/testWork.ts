import type { EngineToMain, MainToEngine } from '@juno/contract'
import { productionTiming, type EngineHostOptions } from '@juno/engine'
import { Effect, Record } from 'effect'

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

/**
 * The e2e scheduling profile for a launch against the fake Slack (e2e README,
 * "Scheduling and setup timings"): the unit harness's 1:20 scale, with
 * explicit catch-ups in place of periodic discovery.
 */
export const fastTestTiming: NonNullable<EngineHostOptions['timing']> = {
  ...Record.map(productionTiming, (millis) => millis / 20),
  // As in the unit harness, explicit catch-ups replace periodic discovery.
  sweepIntervalMillis: 0,
  followPassMillis: 0,
  // The app and the fake run in separate real processes, on a shared runner.
  socketHelloTimeoutMillis: productionTiming.socketHelloTimeoutMillis,
  socketPongTimeoutMillis: productionTiming.socketPongTimeoutMillis,
  // Stands for how far Slack's edge lags its socket, which the fake keeps in real time (`setHuddleInfoLag`).
  huddleInfoSettleMillis: productionTiming.huddleInfoSettleMillis,
}
