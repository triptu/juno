import { defineFixtures, fixture } from '@juno/ui'
import { Workspace } from './Workspace'

export default defineFixtures(
  Workspace,
  {
    Page: {
      'nothing-open': fixture({}),
    },
  },
  { width: 816, height: 560, padded: false },
)
