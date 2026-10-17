/**
 * The keyboard focus ring every control draws (tokens: --focus-ring,
 * --focus-ring-width), on `:focus-visible` only. `outside` sits 2px out
 * from the control and keeps that room when a scroller reveals it; `inset`
 * is drawn inside the edge, for rows and controls flush against others
 * (tabs, segments, list rows), where a ring outside would be clipped.
 */
import * as stylex from '@stylexjs/stylex'
import { accent, sizes } from '@juno/tokens/tokens.stylex'

export const focusRing = stylex.create({
  outside: {
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
  },
  inset: {
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: accent['--focus-ring'],
  },
})
