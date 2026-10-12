/**
 * Overrides for text that sits on a secondary fill. Muted text fails 4.5:1 on
 * `--secondary-*` (tokens.md 1.7), so a container with such a fill applies
 * `onSecondaryFill` and every muted descendant becomes subtle, in both
 * themes, without each feature row re-implementing the rule.
 *
 * Import through `@juno/tokens/fills.stylex` (StyleX needs the `.stylex`
 * subpath for theme files).
 */
import * as stylex from '@stylexjs/stylex'
import { colors } from './tokens.stylex'

export const onSecondaryFill = stylex.createTheme(colors, {
  '--foreground-muted': colors['--foreground-subtle'],
})
