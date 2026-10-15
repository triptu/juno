import { defineFixtures, fixture } from '@juno/ui'
import { connections } from './fixtures'
import { ConnectionToolsSheet, type ConnectionToolsSheetProps } from './ConnectionToolsSheet'

const noop = () => {}
const [notion, littlebird, t3, docs] = connections.connections
const sheet = (props: Pick<ConnectionToolsSheetProps, 'row' | 'error' | 'initialQuery'>) =>
  fixture<ConnectionToolsSheetProps>({ ...props, onTool: noop, onRule: noop, onT3Address: noop, onClose: noop })

export default defineFixtures(
  ConnectionToolsSheet,
  {
    Configure: {
      tools: sheet({ row: notion! }),
      search: sheet({ row: notion!, initialQuery: 'page' }),
      'no-match': sheet({ row: notion!, initialQuery: 'calendar' }),
      'never-ask': sheet({ row: docs! }),
      't3-code': sheet({ row: t3! }),
      'not-connected': sheet({ row: littlebird! }),
      failed: sheet({ row: notion!, error: 'That did not work. Check the connection and try again.' }),
    },
  },
  { width: 640, height: 760, padded: true, surface: 'subtle' },
)
