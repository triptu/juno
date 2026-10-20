import { accentAtom, persistAccent, persistTheme, themeAtom, type Accent, type Theme } from '@juno/state'
import { useAtom } from '@juno/state/react'
import { AppearanceSettings } from '@juno/views'
import { Session } from './Session'

/** Sign-in and appearance controls, loaded together when the window has no session. */
export function SignedOut() {
  const [theme, setTheme] = useAtom(themeAtom)
  const [accent, setAccent] = useAtom(accentAtom)
  const changeTheme = (next: Theme) => {
    setTheme(next)
    persistTheme(next)
  }
  const changeAccent = (next: Accent) => {
    setAccent(next)
    persistAccent(next)
  }
  return (
    <>
      <Session />
      <AppearanceSettings theme={theme} accent={accent} onThemeChange={changeTheme} onAccentChange={changeAccent} />
    </>
  )
}
