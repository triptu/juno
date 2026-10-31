import { useEffect, useSyncExternalStore } from 'react'
import type { chunk } from '@juno/views'
import { readingOnly } from './readingOnly'

export { chunk } from '@juno/views'

/**
 * For a part shown only after some input: loads `part` when idle after the
 * caller mounts, and at once when `wanted` comes first. True once it has
 * loaded, so a caller that draws the part only then never suspends.
 * Reading only, nothing warms when idle: the demo can show few of these
 * parts, and one it does show still loads when wanted.
 */
export function usePreloaded(part: Pick<ReturnType<typeof chunk>, 'load' | 'subscribe' | 'ready'>, wanted: boolean, schedule: (load: () => void) => () => void = onIdle): boolean {
  const ready = useSyncExternalStore(part.subscribe, part.ready, part.ready)
  useEffect(() => schedule(() => void part.load()), [part, schedule])
  useEffect(() => {
    if (wanted && !ready) void part.load()
  }, [part, wanted, ready])
  return ready
}

function onIdle(load: () => void): () => void {
  if (readingOnly()) return () => {}
  const idle = requestIdleCallback(load, { timeout: 5_000 })
  return () => cancelIdleCallback(idle)
}
