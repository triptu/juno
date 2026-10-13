import { useLayoutEffect } from 'react'
import { accentAtom, appInfoAtom, persistAccent, persistTheme, sessionStatusAtom, themeAtom, type Accent, type Theme } from '@juno/state'
import { useAtom, useAtomValue } from '@juno/state/react'
import { AppearanceSettings, AppInfoView, applyTheme, Shell, type AccentName, type ThemeName } from '@juno/views'
import { EngineStatus } from './containers/EngineStatus'
import { Session } from './containers/Session'

// The contract's names and the tokens' names must be the same set. These
// assignments fail to compile if either side drifts.
const _accentFromContract: AccentName = null as unknown as Accent
const _accentFromTokens: Accent = null as unknown as AccentName
const _themeFromContract: ThemeName = null as unknown as Theme
const _themeFromViews: Theme = null as unknown as ThemeName
void [_accentFromContract, _accentFromTokens, _themeFromContract, _themeFromViews]

/** The root container: wires the shell atoms to the shell views. */
export function App() {
  const [theme, setTheme] = useAtom(themeAtom)
  const [accent, setAccent] = useAtom(accentAtom)
  const appInfo = useAtomValue(appInfoAtom)
  const session = useAtomValue(sessionStatusAtom)

  useLayoutEffect(() => applyTheme(theme, accent), [theme, accent])

  const changeTheme = (next: Theme) => {
    setTheme(next)
    persistTheme(next)
  }

  const changeAccent = (next: Accent) => {
    setAccent(next)
    persistAccent(next)
  }

  const line =
    appInfo._tag === 'Success'
      ? `${appInfo.value.name} ${appInfo.value.version} on ${appInfo.value.platform}, Electron ${appInfo.value.electron}`
      : appInfo._tag === 'Failure'
        ? 'Could not read app info'
        : 'Loading app info'

  // Signed in: the M1 diagnostic shell plus the session line. Otherwise the
  // sign-in page is the whole page. The appearance block stays reachable in
  // both until the Preferences page exists.
  const ready = session._tag === 'Success' && session.value._tag === 'ready'

  return (
    <Shell>
      {ready ? (
        <>
          <AppInfoView line={line} />
          <EngineStatus />
          <Session />
        </>
      ) : (
        <Session />
      )}
      <AppearanceSettings theme={theme} accent={accent} onThemeChange={changeTheme} onAccentChange={changeAccent} />
    </Shell>
  )
}
