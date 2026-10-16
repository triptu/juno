/**
 * Screen sharing turns privacy mode on (SPEC section 5, Privacy mode;
 * docs/research/screen-share-detection.md). macOS has no public API that
 * says another app is capturing the screen. The window server's private
 * `SLSIsScreenWatcherPresent` (SkyLight), or `CGSIsScreenWatcherPresent`
 * (CoreGraphics), is true while any process holds a capture stream. Main
 * calls it through koffi every 2 s while the app window is open. Polling
 * keeps the window server's threads out of JavaScript; the change
 * notifications would only make it faster.
 *
 * The signal says that something captures, not who: a screenshot tool, a
 * recorder left running or an always-on screen-context app counts too. So
 * only a change from false to true seen while Juno runs is a share starting;
 * a capture already running at launch is a baseline. A signal true since
 * launch for two minutes means something always captures, and Settings says
 * Juno cannot tell, until the signal goes false. The sidebar footer says why
 * the text is hidden, and Show turns the mode off for this share.
 */

/** Reads whether any process is capturing the screen now. */
export type ScreenProbe = () => boolean

/** The probe and the symbol it calls, for the packaged smoke test. */
export interface LoadedProbe {
  readonly symbol: string
  readonly probe: ScreenProbe
}

/** SkyLight first, as the open-source apps that use it do; CoreGraphics re-exports the same call. */
const SYMBOLS = [
  ['/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight', 'SLSIsScreenWatcherPresent'],
  ['/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics', 'CGSIsScreenWatcherPresent'],
] as const

/**
 * Loads koffi and resolves the first symbol that exists. Undefined off
 * macOS, or when neither resolves: a macOS update removed them, and
 * hiding by hand (⌃⌘H) still works.
 */
export async function loadScreenProbe(): Promise<LoadedProbe | undefined> {
  if (process.platform !== 'darwin') return undefined
  let koffi: typeof import('koffi')
  try {
    koffi = await import('koffi')
  } catch (cause) {
    console.warn('main: screen watch off, koffi did not load', cause)
    return undefined
  }
  for (const [path, symbol] of SYMBOLS) {
    try {
      const present = koffi.load(path).func(`bool ${symbol}()`)
      // One call here, so a symbol that resolves but cannot be called counts as missing.
      present()
      return { symbol, probe: () => present() === true }
    } catch {
      // Try the next name.
    }
  }
  console.warn('main: screen watch off, no screen watcher symbol')
  return undefined
}

/** How often the signal is read while the app window is open. */
export const POLL_MS = 2_000

/**
 * True for this long since the first reading, with no false between: another app captures the
 * screen all the time (a screen-context app or a recorder left running), so a share cannot show.
 */
export const ALWAYS_ON_MS = 2 * 60_000

/** Whether Juno can tell that the screen is shared: `missing` when the call is not there, `alwaysOn` while something always captures. */
export type Detection = 'available' | 'missing' | 'alwaysOn'

export interface ScreenWatchDeps {
  /** Loads the probe once, on the first poll. Under JUNO_E2E a test seam stands in for it. */
  readonly load: () => Promise<ScreenProbe | undefined>
  /** Settings › General, "Hide message text while sharing the screen". */
  readonly enabled: () => boolean
  /** Privacy mode now, and whether this service turned it on and the user has not touched it since. */
  readonly privacy: () => { readonly on: boolean; readonly bySharing: boolean }
  readonly setPrivacy: (on: boolean, bySharing: boolean) => void
  /** The clock; under JUNO_E2E a test can move it on. */
  readonly now?: () => number
}

export interface ScreenWatch {
  /** Polls now and every 2 s after; called when the app window has painted. */
  readonly start: () => void
  /** Stops polling; called when the app window closes. */
  readonly stop: () => void
  /** Reads the signal once and acts on it. */
  readonly poll: () => Promise<void>
  /** What the Settings row says. */
  readonly detection: () => Detection
}

export function createScreenWatch(deps: ScreenWatchDeps): ScreenWatch {
  const now = deps.now ?? Date.now
  // undefined until the first poll loads it; null once it could not.
  let probe: ScreenProbe | null | undefined
  let loading: Promise<void> | undefined
  // The last reading; undefined before the first. The first is a baseline: true at launch is
  // not a share starting, so only a change from false to true seen while Juno runs counts.
  let sharing: boolean | undefined
  // When the first reading was true; cleared for good by the first false.
  let trueSince: number | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const read = async (): Promise<boolean | undefined> => {
    if (probe === undefined) {
      loading ??= deps.load().then((loaded) => { probe = loaded ?? null })
      await loading
    }
    if (probe === null || probe === undefined) return undefined
    try {
      return probe()
    } catch (cause) {
      console.warn('main: screen watch off, the probe failed', cause)
      probe = null
      return undefined
    }
  }

  const poll = async () => {
    const shared = await read()
    if (shared === undefined) return
    const started = sharing === false && shared
    if (sharing === undefined && shared) trueSince = now()
    if (!shared) trueSince = undefined
    sharing = shared
    const { on, bySharing } = deps.privacy()
    // Off only when this service turned it on and the user has not touched it since. A mode the user turned on stays on.
    if (!shared && bySharing) deps.setPrivacy(false, false)
    else if (started && !on && deps.enabled()) deps.setPrivacy(true, true)
  }

  return {
    start: () => {
      if (timer !== undefined || probe === null) return
      void poll()
      timer = setInterval(() => {
        if (probe === null) {
          clearInterval(timer)
          timer = undefined
          return
        }
        void poll()
      }, POLL_MS)
    },
    stop: () => {
      clearInterval(timer)
      timer = undefined
    },
    poll,
    detection: () => (probe === null ? 'missing' : trueSince !== undefined && now() - trueSince >= ALWAYS_ON_MS ? 'alwaysOn' : 'available'),
  }
}
