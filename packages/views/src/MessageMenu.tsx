import * as stylex from '@stylexjs/stylex'
import { ArrowBendUpLeft } from '@phosphor-icons/react/dist/icons/ArrowBendUpLeft'
import { ArrowBendUpRight } from '@phosphor-icons/react/dist/icons/ArrowBendUpRight'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/icons/ArrowSquareOut'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import { Megaphone } from '@phosphor-icons/react/dist/icons/Megaphone'
import { PencilSimple } from '@phosphor-icons/react/dist/icons/PencilSimple'
import { PushPin } from '@phosphor-icons/react/dist/icons/PushPin'
import { Quotes } from '@phosphor-icons/react/dist/icons/Quotes'
import { Smiley } from '@phosphor-icons/react/dist/icons/Smiley'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import { useLayoutEffect, useState } from 'react'
import type { PreparedEmojiPicker } from '@juno/contract'
import { fonts, layout, menu, sizes } from '@juno/tokens/tokens.stylex'
import { ContextMenu, Icon, SmileyPlus, type ContextMenuEntry, type MenuPoint, type PhosphorIcon } from '@juno/ui'
import { EmojiPicker } from './EmojiPicker'
import { GRID_REACTIONS, type GridReaction, type MessageMenuEntry, type MessageMenuIcon } from './messageMenuModel'

// Six cells a row, as `GRID_REACTIONS` (eleven and More reactions) says. StyleX reads only this module's constants.
const GRID_COLUMNS = 6
// The grid's edge: the row inset less the cell's own room around its emoji, so the first and last emoji line up with the rows' icons.
const GRID_INSET = `calc(${menu['--menu-row-inset']} - (${menu['--menu-cell']} - ${menu['--menu-emoji-size']}) / 2)`

const ICONS: Record<MessageMenuIcon, PhosphorIcon> = {
  thread: ChatsCircle,
  reply: ArrowBendUpLeft,
  quote: Quotes,
  juno: Sparkle,
  copy: Copy,
  forward: ArrowBendUpRight,
  open: ArrowSquareOut,
  bell: Bell,
  edit: PencilSimple,
  delete: Trash,
  pin: PushPin,
  broadcast: Megaphone,
  reactions: Smiley,
}

const withIcons = (items: ReadonlyArray<MessageMenuEntry>): ReadonlyArray<ContextMenuEntry> =>
  items.map((entry) => ('separator' in entry ? entry : { id: entry.id, label: entry.label, icon: ICONS[entry.icon], ...(entry.disabled === true ? { disabled: true } : {}) }))

export interface MessageMenuProps {
  /** The pointer, or under the focused message's first line. */
  readonly anchor: MenuPoint
  /** Up to eleven, in order: the quick reactions, then frequently used, then common emoji. */
  readonly reactions: ReadonlyArray<GridReaction>
  /** The rows under the grid, in groups. */
  readonly items: ReadonlyArray<MessageMenuEntry>
  /** No grid: a message nobody can react to (your own in the Juno chat). */
  readonly noGrid?: boolean
  /** A grid cell or a picked emoji: its name, and its glyph or a custom emoji's image. */
  readonly onReact: (name: string, unicode: string | undefined, url: string | undefined) => void
  /** Every emoji, and the frequently used ones that the picker shows first and ranks a search by. */
  readonly emoji: { readonly data: PreparedEmojiPicker; readonly recent: ReadonlyArray<string> }
  /** A row was chosen; `metaKey` with ⌘ held (Start thread then opens it in a background tab). */
  readonly onSelect: (id: string, how: { readonly metaKey: boolean }) => void
  readonly onClose: () => void
  /** Drawn inside its parent, which stands in for the window: the gallery. */
  readonly inline?: boolean
  /** Turns into the emoji picker as soon as it is placed, with this search. For fixtures; the app opens the menu. */
  readonly initialPicking?: boolean
  readonly initialQuery?: string
}

/**
 * The menu over a message or a Juno bubble (inventory 6.5): a 2 × 6 emoji
 * grid on top, as Messages draws it, then the message's actions in groups.
 * A cell reacts and closes the menu; the last cell, More reactions, turns
 * the menu into the full emoji picker in one motion (`ContextMenu`'s
 * `morph`), drawn in the menu's material. The window has one, shown on demand.
 */
export function MessageMenu({ anchor, reactions, items, noGrid = false, onReact, emoji, onSelect, onClose, inline = false, initialPicking = false, initialQuery = '' }: MessageMenuProps) {
  const [picking, setPicking] = useState(false)
  // A fixture opens as the picker: placed as the menu first, so the picker has a menu to grow from. It turns before the
  // first paint, which only an effect after placement can do.
  useLayoutEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (initialPicking) setPicking(true)
  }, [initialPicking])
  const grid = noGrid ? undefined : <ReactionGrid reactions={reactions} onReact={onReact} onMore={() => setPicking(true)} spaced={items.length > 0} />
  return (
    <ContextMenu
      anchor={anchor}
      items={withIcons(items)}
      label="Message actions"
      header={grid}
      onSelect={onSelect}
      onClose={onClose}
      {...(noGrid ? {} : { panelWidth: layout['--emoji-picker-width'] })}
      morph={picking ? <EmojiPicker data={emoji.data} recent={emoji.recent} material="menu" initialQuery={initialQuery} onPick={onReact} onClose={onClose} /> : undefined}
      inline={inline}
    />
  )
}

interface ReactionGridProps {
  readonly reactions: ReadonlyArray<GridReaction>
  readonly onReact: (name: string, unicode: string | undefined, url: string | undefined) => void
  readonly onMore: () => void
  /** Rows follow: a little room under the grid. */
  readonly spaced: boolean
}

/** The menu's emoji grid. Its cells are the menu's to move through (`data-menu-cell`), with the arrows in two dimensions. */
function ReactionGrid({ reactions, onReact, onMore, spaced }: ReactionGridProps) {
  return (
    <div role="group" aria-label="React" data-menu-columns={GRID_COLUMNS} data-reaction-grid="" {...stylex.props(styles.grid, spaced && styles.spaced)}>
      {reactions.slice(0, GRID_REACTIONS).map((reaction) => (
        <button
          key={reaction.name}
          type="button"
          tabIndex={-1}
          data-menu-cell=""
          data-grid-reaction={reaction.name}
          aria-pressed={reaction.selected}
          aria-label={`React ${reaction.url === undefined ? reaction.unicode : `:${reaction.name}:`}`}
          onClick={() => onReact(reaction.name, reaction.url === undefined ? reaction.unicode : undefined, reaction.url)}
          {...stylex.props(styles.cell, reaction.selected && styles.selected)}
        >
          {reaction.url === undefined ? (
            <span aria-hidden {...stylex.props(styles.glyph)}>
              {reaction.unicode}
            </span>
          ) : (
            <img src={reaction.url} alt="" draggable={false} decoding="async" {...stylex.props(styles.image)} />
          )}
        </button>
      ))}
      <button type="button" tabIndex={-1} data-menu-cell="" data-grid-more="" aria-label="More reactions" aria-haspopup="dialog" onClick={onMore} {...stylex.props(styles.cell, styles.more)}>
        <Icon icon={SmileyPlus} size={16} />
      </button>
    </div>
  )
}

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: `repeat(${GRID_COLUMNS}, ${menu['--menu-cell']})`,
    justifyContent: 'space-between',
    columnGap: menu['--menu-cell-gap'],
    rowGap: menu['--menu-cell-row-gap'],
    paddingInline: GRID_INSET,
  },
  spaced: {
    marginBottom: menu['--menu-separator-gap'],
  },
  // Plain :focus: the menu's highlight is focus, from the pointer or the arrows. Over a chosen cell it darkens the fill.
  cell: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: menu['--menu-cell'],
    height: menu['--menu-cell'],
    padding: 0,
    borderWidth: 0,
    borderRadius: menu['--menu-cell-radius'],
    outline: 'none',
    cursor: 'default',
    backgroundColor: 'transparent',
    backgroundImage: { default: 'none', ':focus': `linear-gradient(${menu['--menu-cell-hover']}, ${menu['--menu-cell-hover']})` },
  },
  selected: {
    backgroundColor: menu['--menu-cell-selected'],
  },
  more: {
    color: menu['--menu-icon'],
  },
  // In the emoji font in a square of its size, so the cell centres the square, not the menu font's line box; the
  // shift puts Apple Color Emoji's ink on the square's centre (`--emoji-14-shift`).
  glyph: {
    width: menu['--menu-emoji-size'],
    height: menu['--menu-emoji-size'],
    color: menu['--menu-emoji'],
    fontFamily: fonts['--font-emoji'],
    fontSize: menu['--menu-emoji-size'],
    lineHeight: 1,
    transform: `translateY(${sizes['--emoji-14-shift']})`,
  },
  image: {
    width: menu['--menu-emoji-size'],
    height: menu['--menu-emoji-size'],
    objectFit: 'contain',
  },
})
