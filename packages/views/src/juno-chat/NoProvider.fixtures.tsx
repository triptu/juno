import { defineFixtures, fixture } from '@juno/ui'
import { NoProvider, type NoProviderProps } from './NoProvider'

const noop = () => {}

export default defineFixtures(
  NoProvider,
  {
    NoProvider: {
      'add-a-provider': fixture<NoProviderProps>({ onAddProvider: noop }),
      'button-focus': fixture<NoProviderProps>({ onAddProvider: noop }, { width: 720, padded: true, focus: '[data-juno-no-provider] button' }),
    },
  },
  { width: 720, padded: true },
)
