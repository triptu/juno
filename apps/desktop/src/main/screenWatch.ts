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
 * The signal says that something captures, not who: a screenshot tool or a
 * recorder left running counts too. So the sidebar footer says why the
 * text is hidden, and Show still turns the mode off for this share.
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

export interface ScreenWatchDeps {
  /** Loads the probe once, on the first poll. Under JUNO_E2E a test seam stands in for it. */
  readonly load: () => Promise<ScreenProbe | undefined>
  /** Settings › General, "Hide message text while sharing the screen". */
  readonly enabled: () => boolean
  /** Privacy mode now, and whether this service turned it on and the user has not touched it since. */
  readonly privacy: () => { readonly on: boolean; readonly bySharing: boolean }
  readonly setPrivacy: (on: boolean, bySharing: boolean) => void
}

export interface ScreenWatch {
  /** Polls now and every 2 s after; called when the app window has painted. */
  readonly start: () => void
  /** Stops polling; called when the app window closes. */
  readonly stop: () => void
  /** Reads the signal once and acts on it. */
  readonly poll: () => Promise<void>
  /** False once the probe could not load; the Settings row then says it is not available. */
  readonly available: () => boolean
}

export function createScreenWatch(deps: ScreenWatchDeps): ScreenWatch {
  // undefined until the first poll loads it; null once it could not.
  let probe: ScreenProbe | null | undefined
  let loading: Promise<void> | undefined
  // Counted from false, so a share already running when Juno opens hides the text.
  let sharing = false
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
    const started = shared && !sharing
    sharing = shared
    const { on, bySharing } = deps.privacy()
    // Off only when this service turned it on and the user has not touched it since; that also
    // covers a share that ended while Juno was closed. A mode the user turned on stays on.
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
    available: () => probe !== null,
  }
}
