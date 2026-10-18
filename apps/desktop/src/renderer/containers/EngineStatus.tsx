import { useRef } from 'react'
import type { EngineStatus as Status } from '@juno/contract'
import { connectionStateAtom, engineStatusAtom, pingCommand } from '@juno/state'
import { useAtomSet, useAtomValue } from '@juno/state/react'
import { EngineStatusView } from '@juno/views'

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

/** The engine's line for About and Copy diagnostics: "Engine live". */
export function useEngineLine(): { readonly line: string; readonly busy: boolean } {
  const connection = useAtomValue(connectionStateAtom)
  const status = useAtomValue(engineStatusAtom)
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
  return { line, busy: connection === 'connected' && status._tag === 'Success' && status.value.syncing }
}

/** Wires the engine status live query and the ping command to the view, for Settings › About. */
export function EngineStatus() {
  const { line, busy } = useEngineLine()
  const pong = useAtomValue(pingCommand)
  const ping = useAtomSet(pingCommand)
  const count = useRef(0)

  return (
    <EngineStatusView
      line={line}
      pong={pong._tag === 'Success' ? `Pong ${pong.value.pong}` : pong._tag === 'Failure' ? 'Ping failed' : undefined}
      busy={busy}
      onPing={() => ping({ n: ++count.current })}
    />
  )
}
