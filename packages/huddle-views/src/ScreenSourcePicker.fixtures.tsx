import { defineFixtures, fixture } from '@juno/ui'
import { manyWindows, noop, sources } from './fixtures/data'
import { ScreenSourcePicker, type ScreenSourcePickerProps } from './ScreenSourcePicker'

const base: ScreenSourcePickerProps = {
  permission: 'granted',
  sources,
  onChoose: noop,
  onShare: noop,
  onCancel: noop,
  onAllow: noop,
  onOpenSettings: noop,
  hidesText: true,
}

const picker = (props: Partial<ScreenSourcePickerProps> = {}) => ({ ...base, ...props })

export default defineFixtures(
  ScreenSourcePicker,
  {
    Sources: {
      'first screen chosen': fixture(picker()),
      'window chosen': fixture(picker({ chosen: 'window:3' })),
      'one screen': fixture(picker({ sources: sources.filter((source) => source.id === 'screen:1' || source.kind === 'window').slice(0, 3) })),
      'many windows': fixture(picker({ sources: manyWindows })),
      'text stays': fixture(picker({ hidesText: false })),
      loading: fixture(picker({ sources: undefined })),
    },
    Permission: {
      'not asked': fixture(picker({ permission: 'unknown', sources: undefined })),
      denied: fixture(picker({ permission: 'denied', sources: undefined })),
    },
    Interaction: {
      'tile hover': fixture(picker(), { hover: '[aria-label="Studio Display"]' }),
      'tile focus': fixture(picker(), { focus: '[aria-label="Built-in display"]' }),
    },
  },
  { width: 640 },
)
