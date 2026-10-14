import { defineFixtures, fixture } from '@juno/ui'
import { connections } from './fixtures'
import { ConnectionsPage, type ConnectionsPageProps } from './ConnectionsPage'

const noop = () => {}
const page = (props: Pick<ConnectionsPageProps, 'page'>) => fixture<ConnectionsPageProps>({ ...props, onEnabled: noop, onT3Address: noop, onTier: noop })

export default defineFixtures(
  ConnectionsPage,
  {
    Connections: {
      servers: page({ page: connections }),
      empty: page({ page: { connections: [] } }),
    },
  },
  { width: 960, height: 1100, padded: false },
)
