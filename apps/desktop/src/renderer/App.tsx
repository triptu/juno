import { useLayoutEffect } from 'react'
import { appInfoAtom, persistTheme, sessionStatusAtom, themeAtom } from '@juno/state'
import { useAtom, useAtomValue } from '@juno/state/react'
import { AppInfoView, applyTheme, Shell, ThemeToggleView } from '@juno/views'
import { EngineStatus } from './containers/EngineStatus'
import { Session } from './containers/Session'

/** The root container: wires the shell atoms to the shell views. */
export function App() {
  const [theme, setTheme] = useAtom(themeAtom)
  const appInfo = useAtomValue(appInfoAtom)
  const session = useAtomValue(sessionStatusAtom)

  useLayoutEffect(() => applyTheme(theme), [theme])

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    persistTheme(next)
  }

  const line =
    appInfo._tag === 'Success'
      ? `${appInfo.value.name} ${appInfo.value.version} on ${appInfo.value.platform}, Electron ${appInfo.value.electron}`
      : appInfo._tag === 'Failure'
        ? 'Could not read app info'
        : 'Loading app info'

  // Signed in: the M1 diagnostic shell plus the session line. Otherwise the
  // sign-in page is the whole page; the theme toggle stays reachable.
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
      <ThemeToggleView theme={theme} onToggle={toggleTheme} />
    </Shell>
  )
}
