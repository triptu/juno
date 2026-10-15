import * as stylex from '@stylexjs/stylex'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { Quotes } from '@phosphor-icons/react/dist/icons/Quotes'
import { Smiley } from '@phosphor-icons/react/dist/icons/Smiley'
import type { MouseEvent } from 'react'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Divider, EmojiButton, IconButton, Surface, Text } from '@juno/ui'
import type { MenuAnchor } from './header/HeaderControls'

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
  /** Main only: adds Start thread or Open thread. */
  readonly main?: boolean
  /** The message already has a thread. */
  readonly hasThread?: boolean
  readonly reactions?: ReadonlyArray<QuickReaction>
  readonly onReact?: (name: string) => void
  /** Opens the emoji picker under the toolbar's bottom right corner. */
  readonly onMoreReactions?: (at: MenuAnchor) => void
  readonly onQuote?: () => void
  readonly onReply?: () => void
  /** More: the message menu, under the button. */
  readonly onMore?: (at: MenuAnchor) => void
  /**
   * The inline delete confirm (ADR 0010): the toolbar asks "Delete this
   * message?" with Delete and Cancel in place of its buttons. Enter and Esc
   * are the row's keys; the container handles them.
   */
  readonly confirmDelete?: { readonly onConfirm: () => void; readonly onCancel: () => void }
  readonly tabIndex?: 0 | -1
}

/** Below the button, right-aligned with it: where a menu or the picker opens. */
function below(event: MouseEvent<HTMLElement>): MenuAnchor {
  const box = event.currentTarget.getBoundingClientRect()
  return { x: box.right, y: box.bottom }
}

/**
 * The toolbar that appears over a hovered or focused message (inventory
 * 6.5): quick reactions, More reactions (the emoji picker), Quote, in Main
 * Start thread or Open thread, and More (the message menu). Icon only. The message
 * reserves its place, so showing it moves nothing. While a delete waits for
 * its confirm, the toolbar holds the question instead.
 */
export function HoverToolbar({ main = false, hasThread = false, reactions = quickReactions, onReact, onMoreReactions, onQuote, onReply, onMore, confirmDelete, tabIndex = 0 }: HoverToolbarProps) {
  if (confirmDelete !== undefined) {
    return (
      <Surface kind="toolbar" padding="xs" role="group" aria-label="Delete this message?" data-delete-confirm="" sx={[styles.toolbar, styles.confirm]}>
        <Text variant="meta" tone="default" as="span" sx={styles.question}>
          Delete this message?
        </Text>
        <Button variant="ghost" size="sm" tone="subtle" onClick={confirmDelete.onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" kbd="↵" onClick={confirmDelete.onConfirm}>
          Delete
        </Button>
      </Surface>
    )
  }
  return (
    <Surface kind="toolbar" padding="xs" role="toolbar" aria-label="Message actions" sx={styles.toolbar}>
      {reactions.map((reaction) => (
        <EmojiButton key={reaction.name} emoji={reaction.unicode} label={`React ${reaction.unicode}`} tabIndex={tabIndex} onClick={onReact === undefined ? undefined : () => onReact(reaction.name)} />
      ))}
      <span {...stylex.props(styles.separator)}>
        <Divider vertical inset="none" />
      </span>
      <IconButton icon={Smiley} label="More reactions" size={28} tabIndex={tabIndex} onClick={onMoreReactions === undefined ? undefined : (event) => onMoreReactions(below(event))} />
      <IconButton icon={Quotes} label="Quote" size={28} tabIndex={tabIndex} onClick={onQuote} />
      {main ? <IconButton icon={ChatsCircle} label={hasThread ? 'Open thread' : 'Start thread'} size={28} tabIndex={tabIndex} onClick={onReply} /> : null}
      {onMore !== undefined ? <IconButton icon={DotsThree} label="More" size={28} tabIndex={tabIndex} onClick={(event) => onMore(below(event))} /> : null}
    </Surface>
  )
}

const styles = stylex.create({
  toolbar: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
  },
  confirm: {
    gap: spacing['--space-1'],
  },
  question: {
    paddingInline: spacing['--space-2'],
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
  separator: {
    display: 'inline-flex',
    alignSelf: 'stretch',
    paddingBlock: spacing['--space-1'],
    marginInline: spacing['--space-0-5'],
  },
})
