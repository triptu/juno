import { defineFixtures, scene } from '@juno/ui'
import { TitlebarNav, type TitlebarNavProps } from './TitlebarNav'

const noop = () => {}

const base: TitlebarNavProps = { sidebarHidden: false, canGoBack: true, canGoForward: true, onToggleSidebar: noop, onBack: noop, onForward: noop }

const nav = (props: Partial<TitlebarNavProps> = {}) => scene<TitlebarNavProps>(() => <TitlebarNav {...base} {...props} />)

export default defineFixtures(
  TitlebarNav,
  {
    States: {
      'both-ways': nav(),
      'nowhere-to-go': nav({ canGoBack: false, canGoForward: false }),
      'back-only': nav({ canGoForward: false }),
      'sidebar-hidden': nav({ sidebarHidden: true }),
    },
    Interaction: {
      'hover-back': scene(() => <TitlebarNav {...base} />, { hover: '[aria-label="Back ⌘["]' }),
      'focus-sidebar': scene(() => <TitlebarNav {...base} />, { focus: '[aria-label="Hide sidebar ⌃⌘S"]' }),
    },
  },
  { width: 200, height: 60 },
)
