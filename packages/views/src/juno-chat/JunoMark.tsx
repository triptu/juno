import * as stylex from '@stylexjs/stylex'
import { colors, sizes } from '@juno/tokens/tokens.stylex'

/**
 * The mark in the Juno title button (18px): the seated j alone, in
 * `--foreground-subtle`, with no warm layer (inventory 12). The same
 * geometry as `Illustration name="juno"` on its 64-unit grid. Juno's
 * bubbles have no mark beside them (SPEC 13.1).
 */
export function JunoMark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden focusable={false} {...stylex.props(styles.svg)}>
      <circle cx="40" cy="10" r="7" fill="currentColor" />
      <path d="M47.5 25 C47.5 35.5 46 42.5 40.5 46.5 C37.5 48.6 34.5 48.6 31 48.6" fill="none" stroke="currentColor" strokeWidth="8.5" strokeLinecap="round" />
    </svg>
  )
}

const styles = stylex.create({
  svg: {
    display: 'block',
    width: sizes['--avatar-18'],
    height: sizes['--avatar-18'],
    flexShrink: 0,
    color: colors['--foreground-subtle'],
    userSelect: 'none',
  },
})
