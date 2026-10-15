import { useState } from 'react'
import { chatCopy, type ConnectionId } from '@juno/agent-contract'
import { registry } from '@juno/state'
import { connectionsPageAtom, junoPageActions } from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'
import { ConnectionToolsSheet, SheetLayer } from '@juno/views'

const actions = junoPageActions(registry)

/**
 * Configure on a connection (SPEC 13.10): its tools with their Enabled
 * switches and auto-review rules, in a sheet over the page. It reads the
 * live Connections page itself, so any page that lists connections (the
 * Juno menu's Connections, or the Settings section) hosts it with the id
 * and a close.
 */
export function ConnectionConfigure({ id, onClose }: { readonly id: ConnectionId; readonly onClose: () => void }) {
  const result = useAtomValue(connectionsPageAtom)
  const [error, setError] = useState<string | undefined>(undefined)
  const row = result._tag === 'Success' ? result.value.connections.find((entry) => entry.id === id) : undefined
  // A removed connection has nothing left to configure.
  if (row === undefined) return null
  const copy = chatCopy.pages.connections
  const report = (outcome: string) => setError(outcome === 'ok' ? undefined : outcome === 'invalid' && row.t3 !== undefined ? copy.invalidAddress : copy.failed)
  return (
    <SheetLayer onClose={onClose}>
      <ConnectionToolsSheet
        row={row}
        {...(error === undefined ? {} : { error })}
        onTool={(tool, change) => void actions.tool(id, tool, change).then(report)}
        onRule={(review) => void actions.rule(id, review).then(report)}
        onT3Address={(_, address) => void actions.t3Address(address).then(report)}
        onClose={onClose}
      />
    </SheetLayer>
  )
}
