import { useRef } from 'react'
import type { EngineStatus as Status } from '@juno/contract'
import { connectionStateAtom, engineStatusAtom, pingCommand, registry, restartEngine, syncNoticeAtom, syncProgressAtom } from '@juno/state'
import { useAtomSet, useAtomValue } from '@juno/state/react'
import { EngineNotice, EngineStatusView, SyncProgress } from '@juno/views'

const phaseLabel = (phase: Status['phase']): string => {
  switch (phase._tag) {
    case 'first-run':
      return 'Engine ready to sign in'
    case 'booting':
      return 'Engine starting'
    case 'catching-up':
      return `Engine catching up, ${phase.done} of ${phase.total}`
    case 'live':
      return 'Engine live'
    case 'offline':
      return 'Engine offline'
    case 'rate-limited':
      return 'Engine rate limited'
    case 'session-expired':
      return 'Engine session expired'
  }
}

/** Wires the engine status live query and the ping command to the view. */
export function EngineStatus() {
  const connection = useAtomValue(connectionStateAtom)
  const status = useAtomValue(engineStatusAtom)
  const pong = useAtomValue(pingCommand)
  const ping = useAtomSet(pingCommand)
  const count = useRef(0)

  const line =
    connection === 'failed'
      ? 'Engine failed'
      : connection === 'reconnecting'
        ? 'Engine restarting'
        : status._tag === 'Success'
          ? phaseLabel(status.value.phase)
          : status._tag === 'Failure'
            ? 'Engine unreachable'
            : 'Connecting to engine'

  return (
    <EngineStatusView
      line={line}
      pong={pong._tag === 'Success' ? `Pong ${pong.value.pong}` : pong._tag === 'Failure' ? 'Ping failed' : undefined}
      busy={connection === 'connected' && status._tag === 'Success' && status.value.syncing}
      onPing={() => ping({ n: ++count.current })}
    />
  )
}

function restart(): void {
  void restartEngine(registry)
}

/**
 * The line under the sidebar's filters: why the rows may be behind Slack
 * (`syncNoticeAtom`), with Restart when the engine stopped; otherwise,
 * during the first sync, its progress (`syncProgressAtom`); otherwise
 * nothing.
 */
export function SyncNotice() {
  const kind = useAtomValue(syncNoticeAtom)
  const progress = useAtomValue(syncProgressAtom)
  if (kind !== undefined) return <EngineNotice kind={kind} onRestart={restart} />
  if (progress === undefined) return null
  return <SyncProgress {...progress} overlay />
}
