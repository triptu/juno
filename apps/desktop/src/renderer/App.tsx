import { Suspense, useEffect, useLayoutEffect } from 'react'
import { accentAtom, closeSidebarSheet, densityAtom, junoSetupPendingAtom, openSidebarSheet, persistAccent, persistTheme, privacyAtom, registry, resolvedThemeAtom, sessionUnknownAtom, signedInAtom, themeAtom, type Accent, type Density, type ResolvedTheme, type Theme } from '@juno/state'
import { useAtom, useAtomValue } from '@juno/state/react'
import { AppearanceSettings, applyPrivacy, applyTheme, SheetOpenContext, Shell, type AccentName, type DensityName, type ThemeName, type ThemePreference } from '@juno/views'
import { chunk } from './containers/chunks'
import { Frame } from './containers/Frame'
import { followFullScreen } from './containers/fullScreen'
import { Peek } from './containers/Peek'
import { followSharingPrivacy } from './containers/privacy'
import { Session } from './containers/Session'
import { Sidebar } from './containers/Sidebar'
import { Workspace } from './containers/Workspace'

// Warm the setup page while signed out, after the sign-in frame has painted.
const setup = chunk(() => import('./containers/SetUpJuno'))
const SetUpJuno = setup.component((module) => module.SetUpJuno)

/** A sheet over the window holds the sidebar's order until it closes (SPEC 5, "Holding the order"). */
const sheetOpen = { opened: () => openSidebarSheet(registry), closed: () => closeSidebarSheet(registry) }

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
  useEffect(followSharingPrivacy, [])
  return null
}

/** The root container: the theme, privacy mode, and the shell in its signed-in or signed-out shape. */
export function App() {
  const [theme, setTheme] = useAtom(themeAtom)
  const resolved = useAtomValue(resolvedThemeAtom)
  const [accent, setAccent] = useAtom(accentAtom)
  const density = useAtomValue(densityAtom)
  const signedIn = useAtomValue(signedInAtom)
  const sessionUnknown = useAtomValue(sessionUnknownAtom)
  const setUpPending = useAtomValue(junoSetupPendingAtom)

  useEffect(followFullScreen, [])

  useEffect(() => {
    if (signedIn !== undefined) return
    const idle = requestIdleCallback(() => {
      void setup.load()
    })
    return () => cancelIdleCallback(idle)
  }, [signedIn])

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
  // appearance settings. Right after a first sign-in with no model set up,
  // "Set up Juno" on the same page first. Otherwise the sign-in page is the
  // whole page, with the appearance block under it. A relaunch with a
  // saved session starts on the shell (signedInAtom), never on this page.
  if (signedIn !== undefined && setUpPending) {
    return (
      <Shell>
        <Suspense fallback={null}>
          <SetUpJuno />
        </Suspense>
      </Shell>
    )
  }
  if (signedIn !== undefined) {
    return (
      <SheetOpenContext.Provider value={sheetOpen}>
        <PrivacyRoot />
        <Frame sidebar={<Sidebar />} peek={<Peek />}>
          <Workspace />
        </Frame>
      </SheetOpenContext.Provider>
    )
  }
  // A launch with no saved session paints only the window's background until the engine says whether one is stored.
  if (sessionUnknown) return null
  return (
    <Shell>
      <Session />
      <AppearanceSettings theme={theme} accent={accent} onThemeChange={changeTheme} onAccentChange={changeAccent} />
    </Shell>
  )
}
