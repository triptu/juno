/**
 * `launch.json`: the few values main needs before the window exists, so the
 * first frame already has the right background and size (performance 2.1).
 * Read synchronously once before `ready`; written asynchronously after.
 * Main keeps one `Launch` value in memory and writes it whole, so a change
 * to one field never overwrites another.
 */
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Schema } from 'effect'
import { nativeTheme } from 'electron'
import { AccentSchema, DEFAULT_THEME, DensitySchema, SidebarLayout, ThemeSchema, type Theme } from '@juno/contract'

export const Launch = Schema.Struct({
  theme: ThemeSchema,
  // Optional so a launch.json written before accents existed still decodes.
  accent: Schema.optionalKey(AccentSchema),
  density: Schema.optionalKey(DensitySchema),
  sidebar: Schema.optionalKey(SidebarLayout),
  bounds: Schema.optionalKey(Schema.Struct({ x: Schema.Int, y: Schema.Int, width: Schema.Int, height: Schema.Int })),
})
export type Launch = typeof Launch.Type

const DEFAULTS: Launch = { theme: DEFAULT_THEME }

/**
 * Page background per theme, the `--background` token from
 * packages/tokens/src/tokens.stylex.ts and themes.stylex.ts. Main cannot
 * import StyleX files, so the two values are repeated here; keep them in sync.
 */
export const BACKGROUND = { light: '#fdfcf8', dark: '#1b1916' } as const

/** The background a window paints in before the page loads. System follows macOS. */
export function backgroundFor(theme: Theme): string {
  return BACKGROUND[theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme]
}

const decode = Schema.decodeUnknownSync(Launch)
const encode = Schema.encodeSync(Launch)

const file = (userData: string) => join(userData, 'launch.json')

export function readLaunch(userData: string): Launch {
  try {
    return decode(JSON.parse(readFileSync(file(userData), 'utf8')))
  } catch {
    return DEFAULTS
  }
}

export function writeLaunch(userData: string, launch: Launch): Promise<void> {
  return writeFile(file(userData), JSON.stringify(encode(launch)), 'utf8').catch((cause: unknown) => {
    console.warn('main: could not write launch.json', cause)
  })
}
