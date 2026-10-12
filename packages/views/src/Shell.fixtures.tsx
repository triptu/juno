import { defineFixtures, scene } from '@juno/ui'
import { AppInfoView } from './AppInfoView'
import { Shell } from './Shell'
import { ThemeToggleView } from './ThemeToggleView'

export default defineFixtures(
  Shell,
  {
    empty: scene(() => <Shell />),
    'm1-shell': scene(() => (
      <Shell>
        <AppInfoView line="Juno 0.1.0 on darwin, Electron 44.7.0" />
        <ThemeToggleView theme="light" onToggle={() => {}} />
      </Shell>
    )),
  },
  { width: 960, height: 400, padded: false },
)
