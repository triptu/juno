import { emptyNavigation, searchNavigation } from './navigation'
import type { SearchUpdate } from '@juno/contract'
import { Effect, Queue, Result, Stream } from 'effect'
import type { Run } from '../protocol/live'
import type { OpenWorkspace } from '../workspace'
import { fetchSearch, loadLocal, localHidden, prepareSearch, snapshot, type SearchRun } from './sessionRun'

type Request = { kind: 'more'; offset?: number } | { kind: 'online'; online: boolean } | { kind: 'close' }
interface Controller { run?: SearchRun; generation: number; offer: (request: Request) => void; pending?: { kind: 'more'; offset?: number } }

export function searchSessions(client: SearchRun['client'], link: SearchRun['link']) {
  const active = new Map<string, Controller>()
  const more = (sessionId: string, generation: number, offset?: number) => Effect.sync(() => {
    const controller = active.get(sessionId)
    if (controller === undefined || controller.generation !== generation) return false
    const run = controller.run
    if (run !== undefined && offset !== undefined) {
      run.desiredOffset = Math.max(0, offset)
      const total = snapshot(run).window.totalRows
      if (offset <= run.offset || offset + 100 <= total) {
        run.offset = Math.max(0, Math.min(offset, Math.max(0, total - 1)))
        delete controller.pending
        run.publish()
        return true
      }
    }
    const wake = controller.pending === undefined
    controller.pending = { kind: 'more', ...(offset === undefined ? {} : { offset }) }
    if (wake) controller.offer({ kind: 'more' })
    return true
  })
  const stream = (open: OpenWorkspace, input: SearchRun['input']) => Stream.callback<Run<SearchUpdate, never>>((output) => Effect.gen(function* () {
    const previous = active.get(input.sessionId)
    if (previous !== undefined && previous.generation >= input.generation) return
    previous?.offer({ kind: 'close' })
    const requests = yield* Queue.unbounded<Request>()
    const controller: Controller = { generation: input.generation, offer: (request) => { Queue.offerUnsafe(requests, request) } }
    active.set(input.sessionId, controller)
    yield* Effect.addFinalizer(() => Effect.sync(() => { if (active.get(input.sessionId) === controller) active.delete(input.sessionId) }))
    const current = () => active.get(input.sessionId) === controller
    const started = performance.now()
    const run = yield* prepareSearch(input, client, link, current)
    controller.run = run
    let queryMs = performance.now() - started
    let sent = new Map<string, string>()
    run.publish = () => {
      if (!current()) return
      const at = performance.now()
      const full = snapshot(run)
      const fingerprints = new Map(full.groups.map((group) => [group.id, JSON.stringify(group)]))
      const value = { ...full, groupOrder: full.groups.map((group) => group.id), groups: full.groups.filter((group) => sent.get(group.id) !== fingerprints.get(group.id)) }
      sent = fingerprints
      Queue.offerUnsafe(output, Result.succeed({ value, queryMs: queryMs + performance.now() - at }))
      queryMs = 0
    }
    run.publish()
    yield* Effect.forkChild(Stream.runForEach(link.onlineChanges, (online) => Effect.sync(() => controller.offer({ kind: 'online', online }))))
    yield* localHidden(run)
    if (!input.immediate && run.online) yield* Effect.sleep(400)
    if (run.online && current()) yield* fetchSearch(run)
    run.publish()
    while (current()) {
      const request = yield* Queue.take(requests)
      if (request.kind === 'close') return
      const next = request.kind === 'more' ? controller.pending : request
      if (request.kind === 'more') delete controller.pending
      if (next !== undefined) yield* handleRequest(run, next)
      run.publish()
    }
  }).pipe(Effect.provide(open.context), Effect.orDie))
  const matches = (input: { sessionId: string; generation: number; topicId: string; ts?: string; first?: string; last?: string }) => Effect.suspend(() => {
    const controller = active.get(input.sessionId)
    return controller?.generation === input.generation && controller.run !== undefined
      ? searchNavigation(controller.run.resolved, input)
      : Effect.succeed(emptyNavigation)
  })
  return { stream, more, matches }
}

const handleRequest = (run: SearchRun, request: Exclude<Request, { kind: 'close' }>) => Effect.gen(function* () {
  if (request.kind === 'online') {
    if (run.online === request.online) return
    run.online = request.online
    if (!run.online) run.state = 'offline'
    else if (run.state === 'offline') yield* fetchSearch(run)
  } else {
    if (request.offset !== undefined) run.desiredOffset = Math.max(0, request.offset)
    const offset = run.desiredOffset
    const needsRows = request.offset === undefined || (offset > run.offset && offset + 100 > snapshot(run).window.totalRows)
    if (needsRows) {
      do {
        if (!run.localCoverage.complete) yield* loadLocal(run)
        const needsRemote = request.offset === undefined || run.desiredOffset + 100 > snapshot(run).window.totalRows
        if (needsRemote && (run.pagination.hasMore || run.state === 'slackUnavailable' || run.pagination.page === 0)) yield* fetchSearch(run)
      } while (request.offset !== undefined && run.desiredOffset + 100 > snapshot(run).window.totalRows && (!run.localCoverage.complete || (run.online && run.state === 'done' && run.pagination.hasMore)))
    }
    run.offset = Math.min(run.desiredOffset, Math.max(0, snapshot(run).window.totalRows - 1))
  }
})
