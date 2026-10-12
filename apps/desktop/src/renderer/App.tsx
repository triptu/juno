import { useLayoutEffect } from 'react'
import { appInfoAtom, persistTheme, themeAtom } from '@juno/state'
import { useAtom, useAtomValue } from '@juno/state/react'
import { AppInfoView, applyTheme, Shell, ThemeToggleView } from '@juno/views'
import { EngineStatus } from './containers/EngineStatus'

/** The root container: wires the shell atoms to the shell views. */
export function App() {
  const [theme, setTheme] = useAtom(themeAtom)
  const appInfo = useAtomValue(appInfoAtom)

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

  return (
    <Shell>
      <AppInfoView line={line} />
      <EngineStatus />
      <ThemeToggleView theme={theme} onToggle={toggleTheme} />
    </Shell>
  )
}
