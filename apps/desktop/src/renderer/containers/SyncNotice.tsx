import { Suspense } from 'react'
import { restartEngine, registry, syncNoticeAtom, syncProgressAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { chunk, usePreloaded } from './chunks'

// The cards show only while the engine is behind Slack, so they load when idle, after the first paint.
const cards = chunk(() => import('./SyncNoticeCards'))
const EngineNotice = cards.component((module) => module.EngineNotice)
const SyncProgress = cards.component((module) => module.SyncProgress)

/**
 * True once the cards have loaded: until then the sidebar shows no footer,
 * so the card never suspends and its footer never shows empty. `wanted`: a
 * notice before the idle preload.
 */
export function useSyncNoticeReady(wanted: boolean): boolean {
  return usePreloaded(cards, wanted)
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
