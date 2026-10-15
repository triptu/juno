import { defineFixtures, fixture } from '@juno/ui'
import { NoProvider, type NoProviderProps } from './NoProvider'

const noop = () => {}

export default defineFixtures(
  NoProvider,
  {
    NoProvider: {
      'add-a-provider': fixture<NoProviderProps>({ onAddProvider: noop }),
      'button-focus': fixture<NoProviderProps>({ onAddProvider: noop }, { width: 720, padded: true, focus: '[data-juno-no-provider] button' }),
      // Under the Juno header, in the tab's 720px column and in the 360px panel.
      'in-the-tab': fixture<NoProviderProps>({ onAddProvider: noop, column: 'page' }, { width: 900, height: 560, padded: false }),
      'in-the-panel': fixture<NoProviderProps>({ onAddProvider: noop, column: 'panel' }, { width: 360, height: 640, padded: false }),
    },
  },
  { width: 720, padded: true },
)
