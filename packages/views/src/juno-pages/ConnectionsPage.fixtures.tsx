import { defineFixtures, fixture } from '@juno/ui'
import { connections } from './fixtures'
import { ConnectionsPage, type ConnectionsPageProps } from './ConnectionsPage'

const noop = () => {}
const page = (props: Pick<ConnectionsPageProps, 'page' | 'error'>) => fixture<ConnectionsPageProps>({ ...props, onEnabled: noop, onAction: noop, onT3Address: noop, onTier: noop, onAdd: noop })
const signingIn = { connections: connections.connections.map((row) => (row.id === 'littlebird' ? { ...row, state: 'connecting' as const } : row)) }

export default defineFixtures(
  ConnectionsPage,
  {
    Connections: {
      servers: page({ page: connections }),
      signingIn: page({ page: signingIn }),
      badAddress: page({ page: connections, error: { id: 'new', message: 'Use an https address, or http on this Mac.' } }),
      empty: page({ page: { connections: [] } }),
    },
  },
  { width: 960, height: 880, padded: false },
)
