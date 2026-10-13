import * as stylex from '@stylexjs/stylex'
import { ArrowBendUpLeft } from '@phosphor-icons/react/dist/icons/ArrowBendUpLeft'
import { Quotes } from '@phosphor-icons/react/dist/icons/Quotes'
import { Smiley } from '@phosphor-icons/react/dist/icons/Smiley'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Divider, EmojiButton, IconButton, Surface } from '@juno/ui'

export interface QuickReaction {
  /** Slack's name, for example `+1`. */
  readonly name: string
  readonly unicode: string
}

/** The three one-click reactions (SPEC section 7): 👍 ✅ 👀. */
export const quickReactions: ReadonlyArray<QuickReaction> = [
  { name: '+1', unicode: '👍' },
  { name: 'white_check_mark', unicode: '✅' },
  { name: 'eyes', unicode: '👀' },
]

export interface HoverToolbarProps {
  /** Main only: adds Reply in thread. */
  readonly main?: boolean
  readonly reactions?: ReadonlyArray<QuickReaction>
  readonly onReact?: (name: string) => void
  readonly onMoreReactions?: () => void
  readonly onQuote?: () => void
  readonly onReply?: () => void
  readonly tabIndex?: 0 | -1
}

/**
 * The toolbar that appears over a hovered or focused message (inventory
 * 6.5): quick reactions, More reactions, Quote and, in Main, Reply in
 * thread. Icon only. The message reserves its place, so showing it moves
 * nothing. M4 shows it in the gallery; the app mounts it in M6.
 */
export function HoverToolbar({ main = false, reactions = quickReactions, onReact, onMoreReactions, onQuote, onReply, tabIndex = 0 }: HoverToolbarProps) {
  return (
    <Surface kind="toolbar" padding="xs" role="toolbar" aria-label="Message actions" sx={styles.toolbar}>
      {reactions.map((reaction) => (
        <EmojiButton key={reaction.name} emoji={reaction.unicode} label={`React ${reaction.unicode}`} tabIndex={tabIndex} onClick={onReact === undefined ? undefined : () => onReact(reaction.name)} />
      ))}
      <span {...stylex.props(styles.separator)}>
        <Divider vertical inset="none" />
      </span>
      <IconButton icon={Smiley} label="More reactions" size={28} tabIndex={tabIndex} onClick={onMoreReactions} />
      <IconButton icon={Quotes} label="Quote" size={28} tabIndex={tabIndex} onClick={onQuote} />
      {main ? <IconButton icon={ArrowBendUpLeft} label="Reply in thread" size={28} tabIndex={tabIndex} onClick={onReply} /> : null}
    </Surface>
  )
}

const styles = stylex.create({
  toolbar: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
  },
  separator: {
    display: 'inline-flex',
    alignSelf: 'stretch',
    paddingBlock: spacing['--space-1'],
    marginInline: spacing['--space-0-5'],
  },
})
