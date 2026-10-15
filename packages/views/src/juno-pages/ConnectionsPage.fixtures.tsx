import { defineFixtures, fixture } from '@juno/ui'
import { connections } from './fixtures'
import { ConnectionsPage, type ConnectionsPageProps } from './ConnectionsPage'

const noop = () => {}
const page = (props: Pick<ConnectionsPageProps, 'page' | 'error'>) => fixture<ConnectionsPageProps>({ ...props, onAction: noop, onConfigure: noop, onAdd: noop })
const signingIn = { connections: connections.connections.map((row) => (row.id === 'littlebird' ? { ...row, state: 'connecting' as const } : row)) }

export default defineFixtures(
  ConnectionsPage,
  {
    Connections: {
      servers: page({ page: connections }),
      off: page({ page: { connections: connections.connections.map((row) => ({ ...row, state: 'off', enabled: false, tools: [] })) } }),
      'needs-sign-in': page({ page: { connections: connections.connections.map((row) => ({ ...row, state: 'needsSignIn', enabled: false })) } }),
      signingIn: page({ page: signingIn }),
      failed: page({ page: connections, error: { id: connections.connections[0]!.id, message: 'That did not work. Check the connection and try again.' } }),
      badAddress: page({ page: connections, error: { id: 'new', message: 'Use an https address, or http on this Mac.' } }),
      empty: page({ page: { connections: [] } }),
    },
  },
  { width: 960, height: 880, padded: false },
)
