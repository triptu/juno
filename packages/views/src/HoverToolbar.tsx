import * as stylex from '@stylexjs/stylex'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { Quotes } from '@phosphor-icons/react/dist/icons/Quotes'
import { Smiley } from '@phosphor-icons/react/dist/icons/Smiley'
import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { DEFAULT_QUICK_REACTIONS, type QuickReaction } from '@juno/contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Divider, EmojiButton, IconButton, moveFocus, Surface, Text } from '@juno/ui'
import type { MenuAnchor } from './header/HeaderControls'

export interface HoverToolbarProps {
  /** Main only: adds Start thread or Open thread. */
  readonly main?: boolean
  /** The message already has a thread. */
  readonly hasThread?: boolean
  /** The quick reactions, in order (SPEC 7): up to seven; 👍 ✅ 👀 by default. */
  readonly reactions?: ReadonlyArray<QuickReaction>
  readonly onReact?: (name: string) => void
  /** Opens the emoji picker under the toolbar's bottom right corner. */
  readonly onMoreReactions?: (at: MenuAnchor) => void
  readonly onQuote?: () => void
  /** Start thread or Open thread; `newTab` on ⌘-click or ⌘Enter, which opens it in a background tab. */
  readonly onReply?: (options: { readonly newTab: boolean }) => void
  /** More: the message menu, under the button. */
  readonly onMore?: (at: MenuAnchor) => void
  /**
   * The inline delete confirm (ADR 0010): the toolbar asks "Delete this
   * message?" with Delete and Cancel in place of its buttons. Enter and Esc
   * are the row's keys; the container handles them.
   */
  readonly confirmDelete?: { readonly onConfirm: () => void; readonly onCancel: () => void }
  /** -1 on every row but the list's tabbable one: then no button is in the Tab order. */
  readonly tabIndex?: 0 | -1
}

/** A toolbar button, for the roving tab stop. */
const ITEM = 'button'

/** Below the button, right-aligned with it: where a menu or the picker opens. */
function below(event: MouseEvent<HTMLElement>): MenuAnchor {
  const box = event.currentTarget.getBoundingClientRect()
  return { x: box.right, y: box.bottom }
}

// In a message row (the `message` container in `Message.tsx`), quick reaction
// i shows only while the row is wide enough for the Main toolbar with i + 1
// reactions: 133px of buttons, rule and padding, plus 30px a reaction (a 28px
// button and its 2px gap). So a narrow row drops reactions from the end and
// the toolbar never runs past the row's start; More reactions always shows.
const FITS = [
  '@container message (width < 163px)',
  '@container message (width < 193px)',
  '@container message (width < 223px)',
  '@container message (width < 253px)',
  '@container message (width < 283px)',
  '@container message (width < 313px)',
  '@container message (width < 343px)',
] as const

/**
 * The toolbar that appears over a hovered or focused message (inventory
 * 6.5): quick reactions, More reactions (the emoji picker), Quote, in Main
 * Start thread or Open thread, and More (the message menu). Icon only. The message
 * reserves its place, so showing it moves nothing. While a delete waits for
 * its confirm, the toolbar holds the question instead.
 *
 * One Tab stop (roving tabindex): Tab reaches the button last focused, the
 * first reaction at the start; ← and → move along the buttons, Home and End
 * go to the ends, and Esc goes back to the message.
 */
export function HoverToolbar({ main = false, hasThread = false, reactions = DEFAULT_QUICK_REACTIONS, onReact, onMoreReactions, onQuote, onReply, onMore, confirmDelete, tabIndex = 0 }: HoverToolbarProps) {
  const keys = [...reactions.map((reaction) => `react:${reaction.name}`), 'more-reactions', 'quote', ...(main ? ['reply'] : []), ...(onMore === undefined ? [] : ['more'])]
  const [focused, setFocused] = useState<string | undefined>(undefined)
  const stop = focused !== undefined && keys.includes(focused) ? focused : keys[0]
  const tab = (key: string) => (key === stop ? tabIndex : -1)
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
    <Surface
      kind="toolbar"
      padding="xs"
      role="toolbar"
      aria-label="Message actions"
      onFocus={(event) => {
        const key = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-toolbar-item]')?.dataset['toolbarItem'] : undefined
        if (key !== undefined && key !== focused) setFocused(key)
      }}
      onKeyDown={(event) => toolbarKey(event)}
      sx={styles.toolbar}
    >
      {reactions.map((reaction, i) => (
        <span key={reaction.name} data-quick-reaction={reaction.name} {...stylex.props(fitAt[Math.min(i, fitAt.length - 1)])}>
          <EmojiButton emoji={reaction.unicode} {...(reaction.url === undefined ? {} : { src: reaction.url })} label={`React ${reaction.url === undefined ? reaction.unicode : `:${reaction.name}:`}`} data-toolbar-item={`react:${reaction.name}`} tabIndex={tab(`react:${reaction.name}`)} onClick={onReact === undefined ? undefined : () => onReact(reaction.name)} />
        </span>
      ))}
      <span {...stylex.props(styles.separator)}>
        <Divider vertical inset="none" />
      </span>
      <IconButton icon={Smiley} label="More reactions" size={28} data-toolbar-item="more-reactions" tabIndex={tab('more-reactions')} onClick={onMoreReactions === undefined ? undefined : (event) => onMoreReactions(below(event))} />
      <IconButton icon={Quotes} label="Quote" size={28} data-toolbar-item="quote" tabIndex={tab('quote')} onClick={onQuote} />
      {main ? (
        <IconButton
          icon={ChatsCircle}
          label={hasThread ? 'Open thread' : 'Start thread'}
          size={28}
          data-toolbar-item="reply"
          tabIndex={tab('reply')}
          // ⌘-click leaves focus where it was: the thread opens behind this tab.
          onMouseDown={(event) => event.metaKey && event.preventDefault()}
          onClick={onReply === undefined ? undefined : (event) => onReply({ newTab: event.metaKey })}
          onKeyDown={onReply === undefined ? undefined : (event) => replyKey(event, onReply)}
        />
      ) : null}
      {onMore !== undefined ? <IconButton icon={DotsThree} label="More" size={28} data-toolbar-item="more" tabIndex={tab('more')} onClick={(event) => onMore(below(event))} /> : null}
    </Surface>
  )
}

/** ← → Home End move along the buttons; Esc goes back to the message row. */
function toolbarKey(event: KeyboardEvent<HTMLElement>): void {
  if (event.key === 'Escape') {
    const row = event.currentTarget.closest<HTMLElement>('[data-message-row]')
    if (row === null) return
    event.preventDefault()
    event.stopPropagation()
    row.focus()
    return
  }
  moveFocus(event, ITEM)
}

/** ⌘Enter on Start thread or Open thread opens it in a new tab, as ⌘-click does. */
function replyKey(event: KeyboardEvent<HTMLButtonElement>, onReply: (options: { readonly newTab: boolean }) => void): void {
  if (event.key !== 'Enter' || !event.metaKey) return
  event.preventDefault()
  event.stopPropagation()
  onReply({ newTab: true })
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

// Each reaction's wrapper adds no box of its own; it leaves when the row is too narrow (FITS).
const fits = stylex.create({
  0: { display: { default: 'contents', [FITS[0]]: 'none' } },
  1: { display: { default: 'contents', [FITS[1]]: 'none' } },
  2: { display: { default: 'contents', [FITS[2]]: 'none' } },
  3: { display: { default: 'contents', [FITS[3]]: 'none' } },
  4: { display: { default: 'contents', [FITS[4]]: 'none' } },
  5: { display: { default: 'contents', [FITS[5]]: 'none' } },
  6: { display: { default: 'contents', [FITS[6]]: 'none' } },
})
const fitAt = [fits[0], fits[1], fits[2], fits[3], fits[4], fits[5], fits[6]]
