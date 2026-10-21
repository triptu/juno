import * as stylex from '@stylexjs/stylex'
import { colors, spacing, text } from '@juno/tokens/tokens.stylex'

/** The one line that goes with a picture: a quote, with who said it, or a fact, without (SPEC 12). */
export interface PictureLineView {
  readonly text: string
  readonly by?: string
}

export interface PictureLineProps {
  readonly line: PictureLineView
  /** Home's: centred, under the picture. The gallery's: under a picture in its column. */
  readonly place: 'home' | 'gallery'
}

/**
 * A picture's line in the serif at 18, a step quieter than the picture: a
 * quote in curly quotes with who said it run in after it, quiet in the meta
 * role; a fact as it is. The picture page sets the line larger and gives
 * the speaker a line of their own (`PicturePage`).
 */
export function PictureLine({ line, place }: PictureLineProps) {
  return (
    <p data-picture-line="" {...stylex.props(styles.line, place === 'home' && styles.home)}>
      {line.by === undefined ? line.text : `“${line.text}”`}
      {line.by === undefined ? null : <span {...stylex.props(styles.by)}>{line.by}</span>}
    </p>
  )
}

const styles = stylex.create({
  line: {
    margin: 0,
    fontFamily: text['--text-picture-line-family'],
    fontSize: text['--text-picture-line-size'],
    fontWeight: text['--text-picture-line-weight'],
    lineHeight: text['--text-picture-line-leading'],
    letterSpacing: text['--text-picture-line-tracking'],
    color: colors['--foreground-secondary'],
    textWrap: 'pretty',
    userSelect: 'text',
  },
  home: { textAlign: 'center', textWrap: 'balance' },
  by: {
    marginInlineStart: spacing['--space-1-5'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    fontWeight: text['--text-meta-weight'],
    color: colors['--foreground-muted'],
    whiteSpace: 'nowrap',
  },
})
