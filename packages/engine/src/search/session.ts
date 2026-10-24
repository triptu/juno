import type { SearchSnapshot } from '@juno/contract'
import { Effect, Queue, Result, Stream } from 'effect'
import type { Run } from '../protocol/live'
import type { OpenWorkspace } from '../workspace'
import { fetchSearch, loadLocal, localHidden, prepareSearch, snapshot, type SearchRun } from './sessionRun'

type Request = { kind: 'more'; offset?: number } | { kind: 'online'; online: boolean } | { kind: 'close' }
interface Controller { generation: number; offer: (request: Request) => void; busy: boolean }

export function searchSessions(client: SearchRun['client'], link: SearchRun['link']) {
  const active = new Map<string, Controller>()
  const more = (sessionId: string, generation: number, offset?: number) => Effect.sync(() => {
    const controller = active.get(sessionId)
    if (controller === undefined || controller.generation !== generation || controller.busy) return false
    controller.busy = true
    controller.offer({ kind: 'more', ...(offset === undefined ? {} : { offset }) })
    return true
  })
  const stream = (open: OpenWorkspace, input: SearchRun['input']) => Stream.callback<Run<SearchSnapshot, never>>((output) => Effect.gen(function* () {
    const previous = active.get(input.sessionId)
    if (previous !== undefined && previous.generation >= input.generation) return
    previous?.offer({ kind: 'close' })
    const requests = yield* Queue.unbounded<Request>()
    const controller: Controller = { generation: input.generation, offer: (request) => { Queue.offerUnsafe(requests, request) }, busy: true }
    active.set(input.sessionId, controller)
    yield* Effect.addFinalizer(() => Effect.sync(() => { if (active.get(input.sessionId) === controller) active.delete(input.sessionId) }))
    const current = () => active.get(input.sessionId) === controller
    const started = performance.now()
    const run = yield* prepareSearch(input, client, link, current)
    let queryMs = performance.now() - started
    run.publish = () => {
      if (!current()) return
      const at = performance.now()
      const value = snapshot(run)
      Queue.offerUnsafe(output, Result.succeed({ value, queryMs: queryMs + performance.now() - at }))
      queryMs = 0
    }
    run.publish()
    yield* Effect.forkChild(Stream.runForEach(link.onlineChanges, (online) => Effect.sync(() => controller.offer({ kind: 'online', online }))))
    yield* localHidden(run)
    if (!input.immediate && run.online) yield* Effect.sleep(400)
    if (run.online && current()) yield* fetchSearch(run)
    controller.busy = false
    run.publish()
    while (current()) {
      const request = yield* Queue.take(requests)
      if (request.kind === 'close') return
      yield* handleRequest(run, request)
      controller.busy = false
      run.publish()
    }
  }).pipe(Effect.provide(open.context), Effect.orDie))
  return { stream, more }
}

const handleRequest = (run: SearchRun, request: Exclude<Request, { kind: 'close' }>) => Effect.gen(function* () {
  if (request.kind === 'online') {
    if (run.online === request.online) return
    run.online = request.online
    if (!run.online) run.state = 'offline'
    else if (run.state === 'offline') yield* fetchSearch(run)
  } else {
    run.offset = Math.max(0, request.offset ?? run.offset)
    if (!run.localCoverage.complete) { run.localLimit += 200; yield* loadLocal(run) }
    if (run.pagination.hasMore || run.state === 'slackUnavailable' || run.pagination.page === 0) yield* fetchSearch(run)
  }
})
