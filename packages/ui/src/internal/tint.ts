/**
 * Icon tints (tokens `iconTints`): an accent's colour for an icon, readable
 * on the page and on a selected fill in both themes. `Button iconTint`
 * colours its leading icon; `Swatch tint` draws the choice.
 */
import * as stylex from '@stylexjs/stylex'
import { iconTints } from '@juno/tokens/tokens.stylex'
import type { AccentName } from '../theme'

export type IconTint = AccentName | 'neutral'

export const tintColors = stylex.create({
  neutral: { color: iconTints['--icon-tint-neutral'] },
  coral: { color: iconTints['--icon-tint-coral'] },
  ink: { color: iconTints['--icon-tint-ink'] },
  marigold: { color: iconTints['--icon-tint-marigold'] },
  teal: { color: iconTints['--icon-tint-teal'] },
  midnight: { color: iconTints['--icon-tint-midnight'] },
  emerald: { color: iconTints['--icon-tint-emerald'] },
  claret: { color: iconTints['--icon-tint-claret'] },
  cyan: { color: iconTints['--icon-tint-cyan'] },
})

export const tintFills = stylex.create({
  neutral: { backgroundColor: iconTints['--icon-tint-neutral'] },
  coral: { backgroundColor: iconTints['--icon-tint-coral'] },
  ink: { backgroundColor: iconTints['--icon-tint-ink'] },
  marigold: { backgroundColor: iconTints['--icon-tint-marigold'] },
  teal: { backgroundColor: iconTints['--icon-tint-teal'] },
  midnight: { backgroundColor: iconTints['--icon-tint-midnight'] },
  emerald: { backgroundColor: iconTints['--icon-tint-emerald'] },
  claret: { backgroundColor: iconTints['--icon-tint-claret'] },
  cyan: { backgroundColor: iconTints['--icon-tint-cyan'] },
})
