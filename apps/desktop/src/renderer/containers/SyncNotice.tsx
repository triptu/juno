import { Suspense } from 'react'
import type { SyncFailure } from '@juno/contract'
import { copySyncLog, restartEngine, registry, showToast, syncFailureAtom, syncNoticeAtom, syncProgressAtom } from '@juno/state'
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

function copyLog(): void {
  void copySyncLog().catch(() => false).then((copied) => showToast(registry, { text: copied ? 'Copied the log' : 'Could not copy the log' }))
}

/** A failed sync's reason in plain words, or undefined when there is nothing plainer to say than the card's own line. */
const plainReason = (reason: SyncFailure | undefined): string | undefined => {
  switch (reason?.error) {
    case 'SlackDecodeError':
      return "Slack sent data Juno can't read."
    case 'SlackRejected':
      return 'Slack turned down a request.'
    case 'SlackTransportError':
      return "Slack's servers had a problem."
    case 'SqlError':
    case 'StoreIoError':
      return "Juno couldn't save what it read."
    default:
      return undefined
  }
}

/**
 * The status card at the foot of the sidebar: why the rows may be behind Slack
 * (`syncNoticeAtom`), with Restart when the engine stopped and Copy log when
 * the sync cannot finish; otherwise, during the first sync, its progress
 * (`syncProgressAtom`); otherwise nothing.
 */
export function SyncNotice() {
  const kind = useAtomValue(syncNoticeAtom)
  const reason = plainReason(useAtomValue(syncFailureAtom))
  const progress = useAtomValue(syncProgressAtom)
  if (kind === undefined && progress === undefined) return null
  return (
    <Suspense fallback={null}>
      {kind !== undefined ? <EngineNotice kind={kind} onRestart={restart} {...(reason === undefined ? {} : { reason })} onCopyLog={copyLog} /> : progress === undefined ? null : <SyncProgress {...progress} />}
    </Suspense>
  )
}
