import * as stylex from '@stylexjs/stylex'
import { accent, colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { chipVariants, personHues } from '../Chip'
import type { TextareaMark } from '../Textarea'

/** The anchor name of the character at `anchorAt`, for a popover placed with CSS anchor positioning. */
const TEXTAREA_ANCHOR = '--textarea-anchor'

/** How the layer under a `Textarea` draws a mark, and the anchor character. */
export const layerStyles = stylex.create({
  // The chip's inset is given back by its margin, so no glyph moves.
  chip: {
    borderRadius: radii['--radius-tag'],
    paddingInline: spacing['--space-0-5'],
    marginInline: `calc(-1 * ${spacing['--space-0-5']})`,
  },
  anchor: {
    anchorName: TEXTAREA_ANCHOR,
  },
  // As links in messages are drawn, with no change of width.
  link: {
    color: accent['--hl-text'],
    textDecorationLine: 'underline',
    textDecorationColor: colors['--link-underline'],
    textUnderlineOffset: sizes['--link-underline-offset'],
  },
})

/** A mark's look: a chip in the person's hue or the channel chip's, or a link. */
export const markLook = (mark: TextareaMark) => (mark.look === 'link' ? layerStyles.link : [layerStyles.chip, mark.look === 'channel' ? chipVariants.filled : personHues[mark.hue ?? 'rose']])
