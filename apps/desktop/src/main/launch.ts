/**
 * `launch.json`: the few values main needs before the window exists, so the
 * first frame already has the right background and size (performance 2.1).
 * Read synchronously once before `ready`; written asynchronously after.
 */
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Schema } from 'effect'

export const Launch = Schema.Struct({
  theme: Schema.Literals(['light', 'dark']),
  bounds: Schema.optionalKey(Schema.Struct({ x: Schema.Int, y: Schema.Int, width: Schema.Int, height: Schema.Int })),
})
export type Launch = typeof Launch.Type

const DEFAULTS: Launch = { theme: 'light' }

/**
 * Page background per theme, the `--background` token from
 * packages/tokens/src/tokens.stylex.ts and themes.stylex.ts. Main cannot
 * import StyleX files, so the two values are repeated here; keep them in sync.
 */
export const BACKGROUND = { light: '#fdfcf8', dark: '#131415' } as const

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
