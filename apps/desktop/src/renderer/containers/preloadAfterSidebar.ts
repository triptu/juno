import { registry, sidebarSectionsAtom, signedInAtom } from '@juno/state'
import { afterPaint } from '@juno/state/perf'

/** Idle is possible while the cache query is pending. Wait for its first frame before warming secondary code. */
export function preloadAfterSidebar(load: () => void): () => void {
  let cancelled = false
  let idle: number | undefined
  let queued = false
  const queue = () => {
    if (queued) return
    queued = true
    afterPaint(() => {
      stop()
      if (!cancelled) idle = requestIdleCallback(load, { timeout: 5_000 })
    })
  }
  const stop = registry.subscribe(sidebarSectionsAtom, (sections) => {
    if (sections.ready) queue()
  }, { immediate: true })
  // A signed-out page has no sidebar to wait for.
  if (registry.get(signedInAtom) === undefined) queue()
  return () => {
    cancelled = true
    stop()
    if (idle !== undefined) cancelIdleCallback(idle)
  }
}
