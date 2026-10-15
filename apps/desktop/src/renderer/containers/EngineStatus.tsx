import { useRef } from 'react'
import type { EngineStatus as Status } from '@juno/contract'
import { connectionStateAtom, engineStatusAtom, pingCommand, registry, restartEngine } from '@juno/state'
import { useAtomSet, useAtomValue } from '@juno/state/react'
import { EngineNotice, EngineStatusView, type EngineNoticeKind } from '@juno/views'

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
 * The line under the sidebar's filters when the rows may be behind Slack:
 * offline, rate limited, or the engine stopped for good (with Restart).
 * Nothing while all is well, and nothing for a restart in progress, which
 * recovers on its own in a few seconds.
 */
export function SyncNotice() {
  const kind = useAtomValue(connectionStateAtom, (connection): 'stopped' | undefined => (connection === 'failed' ? 'stopped' : undefined))
  const phase = useAtomValue(engineStatusAtom, (status): EngineNoticeKind | undefined =>
    status._tag !== 'Success' ? undefined : status.value.phase._tag === 'offline' ? 'offline' : status.value.phase._tag === 'rate-limited' ? 'rate-limited' : undefined,
  )
  const shown = kind ?? phase
  if (shown === undefined) return null
  return <EngineNotice kind={shown} onRestart={restart} />
}
