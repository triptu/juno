import { Effect, Layer, Queue, Stream } from 'effect'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Store, type StoreError, workspacePathsFromDir } from '../src/index'

/** A fresh temporary workspace directory, deleted when the scope closes. */
export const tempWorkspaceDir = Effect.acquireRelease(
  Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), 'juno-store-'))),
  (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
)

/** The whole store opened on a fresh temporary workspace directory. */
export const freshStore: Layer.Layer<Layer.Success<ReturnType<typeof Store.layer>>, StoreError> = Layer.unwrap(
  Effect.map(tempWorkspaceDir, (dir) => Store.layer(workspacePathsFromDir(dir))),
)

/**
 * Runs a stream in the background and hands back a queue of its elements, so
 * a test can take the next emission or check that none arrived.
 */
export const collect = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<A>()
    yield* Effect.forkScoped(Stream.runForEach(stream, (a) => Queue.offer(queue, a)))
    return queue
  })

/** Lets forked fibers run so pending emissions land in their queues. */
export const settle = Effect.gen(function* () {
  for (let i = 0; i < 10; i++) yield* Effect.yieldNow
})
