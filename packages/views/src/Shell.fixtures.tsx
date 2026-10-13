import { defineFixtures, scene } from '@juno/ui'
import { AppearanceSettings } from './AppearanceSettings'
import { AppInfoView } from './AppInfoView'
import { Shell } from './Shell'

export default defineFixtures(
  Shell,
  {
    Page: {
      'm1-shell': scene(() => (
        <Shell>
          <AppInfoView line="Juno 0.1.0 on darwin, Electron 44.7.0" />
          <AppearanceSettings theme="light" accent="coral" onThemeChange={() => {}} onAccentChange={() => {}} />
        </Shell>
      )),
    },
  },
  { width: 960, height: 400, padded: false },
)
