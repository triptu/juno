import { Suspense, useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { accentAtom, closeSidebarSheet, densityAtom, topicTitleLinesAtom, junoSetupPendingAtom, openSidebarSheet, privacyAtom, registry, reportAppStateAtom, resolvedThemeAtom, sessionUnknownAtom, signedInAtom, type Accent, type Density, type ResolvedTheme, type Theme } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { applyPrivacy, applyTheme, CodeHighlighterContext, PageNote, SheetOpenContext, Shell, type AccentName, type DensityName, type ThemeName, type ThemePreference } from '@juno/views'
import { chunk, usePreloaded } from './containers/chunks'
import { Frame } from './containers/Frame'
import { followFullScreen } from './containers/fullScreen'
import { Peek } from './containers/Peek'
import { readingOnly } from './containers/readingOnly'
import { followSharingPrivacy } from './containers/privacy'
import { Sidebar } from './containers/Sidebar'
import { Workspace } from './containers/Workspace'
import { applyTopicTitleLines } from './containers/topicTitleLines'
import { codeHighlighter } from './highlight/codeHighlighter'

const signedOut = chunk(() => import('./containers/SignedOut'))
const SignedOut = signedOut.component((module) => module.SignedOut)

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

/** Narrower than this, the demo's panes do not fit (the sidebar alone is at least 312px), so it shows a note instead. */
const NARROW = '(max-width: 899px)'

function onNarrowChange(change: () => void): () => void {
  if (!readingOnly()) return () => {}
  const query = matchMedia(NARROW)
  query.addEventListener('change', change)
  return () => query.removeEventListener('change', change)
}

const narrowNow = (): boolean => readingOnly() && matchMedia(NARROW).matches

/** Privacy mode's one attribute on <html>, set before paint. A leaf, so a toggle re-renders nothing else. */
function PrivacyRoot() {
  const privacy = useAtomValue(privacyAtom)
  useLayoutEffect(() => applyPrivacy(privacy), [privacy])
  useEffect(followSharingPrivacy, [])
  return null
}

/** The root container: the theme, privacy mode, and the shell in its signed-in or signed-out shape. */
export function App() {
  const resolved = useAtomValue(resolvedThemeAtom)
  const accent = useAtomValue(accentAtom)
  const density = useAtomValue(densityAtom)
  const topicTitleLines = useAtomValue(topicTitleLinesAtom)
  const signedIn = useAtomValue(signedInAtom)
  const sessionUnknown = useAtomValue(sessionUnknownAtom)
  const setUpPending = useAtomValue(junoSetupPendingAtom)
  const signedOutReady = usePreloaded(signedOut, signedIn === undefined && !sessionUnknown)
  const narrow = useSyncExternalStore(onNarrowChange, narrowNow)

  useEffect(followFullScreen, [])
  // Main's idle CPU check hears the view and whether a sync runs (processes.ts).
  useEffect(() => registry.mount(reportAppStateAtom), [])

  useEffect(() => {
    if (signedIn !== undefined) return
    const idle = requestIdleCallback(() => {
      void setup.load()
    })
    return () => cancelIdleCallback(idle)
  }, [signedIn])

  useLayoutEffect(() => applyTopicTitleLines(topicTitleLines), [topicTitleLines])

  useLayoutEffect(() => applyTheme(resolved, accent, density), [resolved, accent, density])

  // Signed in: the sidebar and the workspace; Settings holds the
  // appearance settings. Right after a first sign-in with no model set up,
  // "Set up Juno" on the same page first. Otherwise the sign-in page is the
  // whole page, with the appearance block under it. A relaunch with a
  // saved session starts on the shell (signedInAtom), never on this page.
  // The demo in a narrow window is a note, not a squeezed app.
  if (narrow) {
    return (
      <Shell>
        <PageNote title="Juno is a desktop app" body="Open this page on a wider screen to try it." />
      </Shell>
    )
  }
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
        <CodeHighlighterContext value={codeHighlighter}>
          <PrivacyRoot />
          <Frame sidebar={<Sidebar />} peek={<Peek />}>
            <Workspace />
          </Frame>
        </CodeHighlighterContext>
      </SheetOpenContext.Provider>
    )
  }
  // A launch with no saved session paints only the window's background until the engine says whether one is stored.
  if (sessionUnknown) return null
  return (
    <Shell>
      {signedOutReady ? <SignedOut /> : null}
    </Shell>
  )
}
