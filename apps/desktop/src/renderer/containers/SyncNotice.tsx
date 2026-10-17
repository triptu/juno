import { Suspense, useEffect } from 'react'
import { restartEngine, registry, syncNoticeAtom, syncProgressAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { chunk } from './chunks'

// The cards show only while the engine is behind Slack, so they load when idle, after the first paint.
const cards = chunk(() => import('./SyncNoticeCards'))
const EngineNotice = cards.component((module) => module.EngineNotice)
const SyncProgress = cards.component((module) => module.SyncProgress)

/**
 * Preloads the status cards when the sidebar mounts, and loads them at once
 * when `wanted` (a notice before the idle preload). True once they have
 * loaded: until then the sidebar shows no footer, so the card never
 * suspends and its footer never shows empty.
 */
export function useSyncNoticeReady(wanted: boolean): boolean {
  const ready = cards.useReady()
  useEffect(() => {
    const idle = requestIdleCallback(() => void cards.load(), { timeout: 5_000 })
    return () => cancelIdleCallback(idle)
  }, [])
  useEffect(() => {
    if (wanted && !ready) void cards.load()
  }, [wanted, ready])
  return ready
}

function restart(): void {
  void restartEngine(registry)
}

/**
 * The status card at the foot of the sidebar: why the rows may be behind Slack
 * (`syncNoticeAtom`), with Restart when the engine stopped; otherwise,
 * during the first sync, its progress (`syncProgressAtom`); otherwise
 * nothing.
 */
export function SyncNotice() {
  const kind = useAtomValue(syncNoticeAtom)
  const progress = useAtomValue(syncProgressAtom)
  if (kind === undefined && progress === undefined) return null
  return (
    <Suspense fallback={null}>
      {kind !== undefined ? <EngineNotice kind={kind} onRestart={restart} /> : progress === undefined ? null : <SyncProgress {...progress} />}
    </Suspense>
  )
}
