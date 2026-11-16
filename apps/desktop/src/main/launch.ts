/**
 * `launch.json`: the few values main needs before the window exists, so the
 * first frame already has the right background and size (performance 2.1).
 * Read synchronously once before `ready`; written asynchronously after.
 * Main keeps one `Launch` value in memory and writes it whole, so a change
 * to one field never overwrites another. Writes run one at a time through a
 * temporary file and a rename, so the file is never half written, and main
 * waits for the last one before it quits.
 */
import { readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Schema } from 'effect'
import { AccentSchema, DEFAULT_ACCENT, DEFAULT_DENSITY, DEFAULT_SIDEBAR, DEFAULT_THEME, DensitySchema, TopicTitleLinesSchema, ReadySession, SidebarLayout, ThemeSchema } from '@juno/contract'

export const Launch = Schema.Struct({
  theme: ThemeSchema,
  autoUpdate: Schema.optionalKey(Schema.Boolean),
  notificationPermissionAsked: Schema.optionalKey(Schema.Boolean),
  // Optional so a launch.json written before accents existed still decodes.
  accent: Schema.optionalKey(AccentSchema),
  density: Schema.optionalKey(DensitySchema),
  topicTitleLines: Schema.optionalKey(TopicTitleLinesSchema),
  // Privacy mode (SPEC section 5) as the user left it: message text blurred for screen sharing. It stays on
  // across a relaunch. A mode the screen watch turned on is not saved.
  privacy: Schema.optionalKey(Schema.Boolean),
  // Settings › General, "Hide message text while sharing the screen". On when absent.
  hideWhileSharing: Schema.optionalKey(Schema.Boolean),
  sidebar: Schema.optionalKey(SidebarLayout),
  bounds: Schema.optionalKey(Schema.Struct({ x: Schema.Int, y: Schema.Int, width: Schema.Int, height: Schema.Int })),
  // The session the engine last verified, with no secrets, so a relaunch paints the shell first and never the
  // sign-in page. Removed on sign-out and when Slack rejects the session.
  session: Schema.optionalKey(ReadySession),
})
export type Launch = typeof Launch.Type

const DEFAULTS: Launch = { theme: DEFAULT_THEME }

/**
 * Page background per theme, the `--background` token from
 * packages/tokens/src/tokens.stylex.ts and themes.stylex.ts. Main cannot
 * import StyleX files, so the two values are repeated here; keep them in sync.
 */
export const BACKGROUND = { light: '#fdfcf8', dark: '#1b1916' } as const

/**
 * Windows' window buttons per theme: the `--tab-strip` fill they sit on and
 * the `--foreground-default` they are drawn in, from the same two files.
 */
export const TAB_STRIP = {
  light: { color: '#f4f2ec', symbolColor: '#23211a' },
  dark: { color: '#0d0c0a', symbolColor: '#eeebe2' },
} as const

const decode = Schema.decodeUnknownSync(Launch)
const encode = Schema.encodeSync(Launch)

const file = (userData: string) => join(userData, 'launch.json')

/**
 * The saved values, each field on its own: one field main cannot read (an
 * accent from a newer version, a bad width) falls back alone, and the rest,
 * privacy mode above all, are kept. An unreadable file gives the defaults.
 */
export function readLaunch(userData: string): Launch {
  let saved: unknown
  try {
    saved = JSON.parse(readFileSync(file(userData), 'utf8'))
  } catch {
    return DEFAULTS
  }
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return DEFAULTS
  let launch: Launch = DEFAULTS
  for (const [key, value] of Object.entries(saved)) {
    try {
      const field = (decode({ ...DEFAULTS, [key]: value }) as Record<string, unknown>)[key]
      if (field !== undefined) launch = { ...launch, [key]: field }
    } catch {
      console.warn(`main: ignoring launch.json field ${key}`)
    }
  }
  return launch
}

/** `launch` with the verified session for the next launch's first frame, or without one. Writes it only when it changed. */
export function withSession(launch: Launch, session: ReadySession | undefined, writer: LaunchWriter): Launch {
  if (JSON.stringify(session) === JSON.stringify(launch.session)) return launch
  const { session: _previous, ...rest } = launch
  const next = session === undefined ? rest : { ...rest, session }
  writer.write(next)
  return next
}

export interface LaunchWriter {
  /** Queues a write of the whole value. */
  readonly write: (launch: Launch) => void
  /** Resolves once every queued write has finished; undefined when none is queued. */
  readonly pending: () => Promise<void> | undefined
}

export function launchWriter(userData: string): LaunchWriter {
  const target = file(userData)
  const temporary = `${target}.tmp`
  let last: Promise<void> | undefined
  return {
    write: (launch) => {
      const contents = JSON.stringify(encode(launch))
      const next = (last ?? Promise.resolve())
        .then(() => writeFile(temporary, contents, 'utf8'))
        .then(() => rename(temporary, target))
        .catch((cause: unknown) => {
          console.warn('main: could not write launch.json', cause)
        })
        .finally(() => {
          if (last === next) last = undefined
        })
      last = next
    },
    pending: () => last,
  }
}

/**
 * What the page starts with: the saved launch values, with privacy mode as it is now. The screen
 * watch may have turned it on (`privacySharing`), which is not saved, so only a reload sees it.
 */
export type PageLaunch = Launch & { readonly privacySharing?: boolean }

/**
 * The page reads `?platform=` (the keys and words it shows, `@juno/ui` `platform.ts`), `?theme=`, `?accent=`, `?density=`, `?privacy=` and `?sidebar=` so its first render matches the window background, the saved
 * accent, density and privacy mode, and the saved sidebar. `?session=` is the last verified session, so a relaunch renders the shell first. `?fullscreen=1` is a reload in full screen, so the title bars start without the
 * traffic lights' room. `?tour=manual` (tests only) keeps the welcome card from showing by itself.
 */
export function pageUrl(base: string, launch: PageLaunch, fullScreen: boolean): string {
  const url = new URL(base)
  url.searchParams.set('platform', process.platform)
  url.searchParams.set('theme', launch.theme)
  url.searchParams.set('accent', launch.accent ?? DEFAULT_ACCENT)
  url.searchParams.set('density', launch.density ?? DEFAULT_DENSITY)
  if (launch.topicTitleLines !== undefined) url.searchParams.set('topicTitleLines', launch.topicTitleLines)
  // `sharing` when it is on because the screen is shared, so the footer says why from the first frame.
  if (launch.privacy === true) url.searchParams.set('privacy', launch.privacySharing === true ? 'sharing' : 'on')
  const sidebar = launch.sidebar ?? DEFAULT_SIDEBAR
  url.searchParams.set('sidebar', `${sidebar.width}${sidebar.collapsed ? '-hidden' : ''}`)
  if (launch.session !== undefined) url.searchParams.set('session', JSON.stringify(launch.session))
  if (fullScreen) url.searchParams.set('fullscreen', '1')
  // Under JUNO_E2E the welcome card shows only when asked, unless the test wants it to show by itself (JUNO_E2E_TOUR).
  if (process.env.JUNO_E2E === '1' && process.env.JUNO_E2E_TOUR !== '1') url.searchParams.set('tour', 'manual')
  return url.toString()
}
