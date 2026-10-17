import { useEffect } from 'react'
import type { chunk } from '@juno/views'

export { chunk } from '@juno/views'

/**
 * For a part shown only after some input: loads `part` when idle after the
 * caller mounts, and at once when `wanted` comes first. True once it has
 * loaded, so a caller that draws the part only then never suspends.
 */
export function usePreloaded(part: Pick<ReturnType<typeof chunk>, 'load' | 'useReady'>, wanted: boolean): boolean {
  const ready = part.useReady()
  useEffect(() => {
    const idle = requestIdleCallback(() => void part.load(), { timeout: 5_000 })
    return () => cancelIdleCallback(idle)
  }, [part])
  useEffect(() => {
    if (wanted && !ready) void part.load()
  }, [part, wanted, ready])
  return ready
}
