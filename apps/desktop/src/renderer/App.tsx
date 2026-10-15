import { useLayoutEffect } from 'react'
import { accentAtom, densityAtom, persistAccent, persistTheme, privacyAtom, resolvedThemeAtom, signedInAtom, themeAtom, type Accent, type Density, type ResolvedTheme, type Theme } from '@juno/state'
import { useAtom, useAtomValue } from '@juno/state/react'
import { AppearanceSettings, applyPrivacy, applyTheme, Shell, type AccentName, type DensityName, type ThemeName, type ThemePreference } from '@juno/views'
import { Frame } from './containers/Frame'
import { Peek } from './containers/Peek'
import { Session } from './containers/Session'
import { Sidebar } from './containers/Sidebar'
import { Workspace } from './containers/Workspace'

// The contract's names and the tokens' names must be the same set. These
// assignments fail to compile if either side drifts.
const _accentFromContract: AccentName = null as unknown as Accent
const _accentFromTokens: Accent = null as unknown as AccentName
const _themeFromContract: ThemeName = null as unknown as ResolvedTheme
const _themeFromViews: ResolvedTheme = null as unknown as ThemeName
const _preferenceFromContract: ThemePreference = null as unknown as Theme
const _preferenceFromViews: Theme = null as unknown as ThemePreference
const _densityFromContract: DensityName = null as unknown as Density
const _densityFromViews: Density = null as unknown as DensityName
void [_accentFromContract, _accentFromTokens, _themeFromContract, _themeFromViews, _preferenceFromContract, _preferenceFromViews, _densityFromContract, _densityFromViews]

/** Privacy mode's one attribute on <html>, set before paint. A leaf, so a toggle re-renders nothing else. */
function PrivacyRoot() {
  const privacy = useAtomValue(privacyAtom)
  useLayoutEffect(() => applyPrivacy(privacy), [privacy])
  return null
}

/** The root container: the theme, privacy mode, and the shell in its signed-in or signed-out shape. */
export function App() {
  const [theme, setTheme] = useAtom(themeAtom)
  const resolved = useAtomValue(resolvedThemeAtom)
  const [accent, setAccent] = useAtom(accentAtom)
  const density = useAtomValue(densityAtom)
  const signedIn = useAtomValue(signedInAtom)

  useLayoutEffect(() => applyTheme(resolved, accent, density), [resolved, accent, density])

  const changeTheme = (next: Theme) => {
    setTheme(next)
    persistTheme(next)
  }

  const changeAccent = (next: Accent) => {
    setAccent(next)
    persistAccent(next)
  }

  // Signed in: the sidebar and the workspace; Settings holds the
  // appearance settings. Otherwise the sign-in page is the whole page, with
  // the appearance block under it.
  if (signedIn !== undefined) {
    return (
      <>
        <PrivacyRoot />
        <Frame sidebar={<Sidebar />} peek={<Peek />}>
          <Workspace />
        </Frame>
      </>
    )
  }
  return (
    <Shell>
      <Session />
      <AppearanceSettings theme={theme} accent={accent} onThemeChange={changeTheme} onAccentChange={changeAccent} />
    </Shell>
  )
}
