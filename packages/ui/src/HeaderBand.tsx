import * as stylex from '@stylexjs/stylex'
import { colors, layout } from '@juno/tokens/tokens.stylex'

/**
 * The band behind a page header's islands (inventory 5): the page colour,
 * solid to the islands' bottom edge, then fading out, so a list that
 * scrolls under the header never shows through or beside an island. It is
 * static (no blur, no animation), hidden from assistive tech and lets the
 * pointer through. The owner positions it over the top of its area.
 */
export function HeaderBand() {
  return <div aria-hidden data-header-band="" {...stylex.props(styles.band)} />
}

const styles = stylex.create({
  band: {
    position: 'absolute',
    top: 0,
    insetInline: 0,
    height: layout['--header-band'],
    backgroundImage: `linear-gradient(${colors['--background']} ${layout['--header-band-solid']}, transparent)`,
    pointerEvents: 'none',
  },
})
