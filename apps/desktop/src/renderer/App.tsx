import { useLayoutEffect } from 'react'
import { accentAtom, persistAccent, persistTheme, signedInAtom, themeAtom, type Accent, type Theme } from '@juno/state'
import { useAtom, useAtomValue } from '@juno/state/react'
import { AppearanceSettings, applyTheme, Shell, type AccentName, type ThemeName } from '@juno/views'
import { Frame } from './containers/Frame'
import { Peek } from './containers/Peek'
import { Session } from './containers/Session'
import { Sidebar } from './containers/Sidebar'
import { Workspace } from './containers/Workspace'

// The contract's names and the tokens' names must be the same set. These
// assignments fail to compile if either side drifts.
const _accentFromContract: AccentName = null as unknown as Accent
const _accentFromTokens: Accent = null as unknown as AccentName
const _themeFromContract: ThemeName = null as unknown as Theme
const _themeFromViews: Theme = null as unknown as ThemeName
void [_accentFromContract, _accentFromTokens, _themeFromContract, _themeFromViews]

/** The root container: the theme, and the shell in its signed-in or signed-out shape. */
export function App() {
  const [theme, setTheme] = useAtom(themeAtom)
  const [accent, setAccent] = useAtom(accentAtom)
  const signedIn = useAtomValue(signedInAtom)

  useLayoutEffect(() => applyTheme(theme, accent), [theme, accent])

  const changeTheme = (next: Theme) => {
    setTheme(next)
    persistTheme(next)
  }

  const changeAccent = (next: Accent) => {
    setAccent(next)
    persistAccent(next)
  }

  // Signed in: the sidebar and the workspace. Otherwise the sign-in page is
  // the whole page, with the appearance block under it until Preferences
  // exists (signed in, it lives in the account menu).
  if (signedIn !== undefined) {
    return (
      <Frame sidebar={<Sidebar />} peek={<Peek />}>
        <Workspace />
      </Frame>
    )
  }
  return (
    <Shell>
      <Session />
      <AppearanceSettings theme={theme} accent={accent} onThemeChange={changeTheme} onAccentChange={changeAccent} />
    </Shell>
  )
}
