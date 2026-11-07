import * as stylex from '@stylexjs/stylex'
import type { StatusEmoji } from '@juno/contract'
import { colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Emoji } from '@juno/ui'

/**
 * A status emoji: the standard emoji's text, a custom one's image, or, when
 * the workspace no longer has it, a plain square of the same size named
 * for assistive tech, so a long name never pushes the text.
 */
export function EmojiFace({ emoji, size }: { readonly emoji: StatusEmoji; readonly size: 14 | 16 | 20 }) {
  if (emoji.unicode !== undefined) return <Emoji glyph={emoji.unicode} size={size} />
  if (emoji.url !== undefined) return <Emoji url={emoji.url} size={size} />
  return <span role="img" aria-label={`:${emoji.name}:`} data-emoji-missing="" {...stylex.props(styles.missing, missingSizes[size])} />
}

/**
 * A person's status in their avatar's tooltip (SPEC 7, "People"): the
 * emoji and the text, cut with an ellipsis, and under the text when it
 * clears, so a long status keeps the width for its words.
 */
export function StatusLine({ emoji, text, until }: { readonly emoji?: StatusEmoji | undefined; readonly text: string; readonly until?: string | undefined }) {
  return (
    <span data-person-status="" {...stylex.props(styles.statusLine)}>
      {emoji === undefined ? null : <EmojiFace emoji={emoji} size={14} />}
      <span {...stylex.props(styles.statusWords)}>
        <span {...stylex.props(styles.statusText)}>{text}</span>
        {until === undefined ? null : <span {...stylex.props(styles.until)}>{until}</span>}
      </span>
    </span>
  )
}

/**
 * What a person's avatar tooltip says under "Message Jonas": their status, then "Notifications paused" while they have
 * them paused (SPEC 14, "Paused colleagues"), as a quiet line. Nothing when neither holds.
 */
export function PersonDetail({ status, paused }: { readonly status?: { readonly emoji?: StatusEmoji | undefined; readonly text: string; readonly until?: string | undefined } | undefined; readonly paused: boolean }) {
  if (status === undefined && !paused) return null
  return (
    <>
      {status === undefined ? null : <StatusLine emoji={status.emoji} text={status.text} until={status.until} />}
      {paused ? <span data-person-paused="" {...stylex.props(styles.until)}>Notifications paused</span> : null}
    </>
  )
}

const styles = stylex.create({
  missing: {
    display: 'inline-block',
    flexShrink: 0,
    borderRadius: radii['--radius-sm'],
    backgroundColor: colors['--secondary-default'],
  },  statusLine: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },  statusWords: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
  },  statusText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },  until: {
    color: colors['--foreground-muted'],
  },})

const missingSizes = stylex.create({
  14: { width: sizes['--icon-14'], height: sizes['--icon-14'] },
  16: { width: sizes['--icon-16'], height: sizes['--icon-16'] },
  20: { width: sizes['--icon-20'], height: sizes['--icon-20'] },
})
