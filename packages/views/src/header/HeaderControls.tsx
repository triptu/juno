import * as stylex from '@stylexjs/stylex'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import type { KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react'
import { menuKeys } from '@juno/contract/channels'
import { colors, layout, motion, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { focusRing, Icon, IconButton, SparkleDuotone, tooltip, type PhosphorIcon } from '@juno/ui'

/** Where a menu opened from the header goes, in CSS pixels from the window's top left. */
export interface MenuAnchor {
  readonly x: number
  readonly y: number
}

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'
// The header's narrow form (inventory 5): a container query on the header
// layer, which is as wide as its area. Container queries cannot read tokens.
const NARROW = '@container (width < 480px)'
/** The menu opens this far under the left island, left-aligned with it. */
const MENU_GAP = 6
/** Far above the pill's 1, so the title takes all the shortening until it reaches its floor. */
const TITLE_SHRINK = 1000

export interface HeaderTitleButtonProps {
  readonly title: string
  /** Before the title: the Juno mark in the Juno headers. */
  readonly leading?: ReactNode
  /** The menu or popover it opens is showing. */
  readonly expanded: boolean
  /** Click, Enter, Space or ↓; and right-click or the context-menu key unless `onMenu` is given. `at` is under the left island. */
  readonly onOpen: (at: MenuAnchor) => void
  /** What it opens: a menu (the Juno menu), or a popover with a searchable list (the topic switcher). Default `menu`. */
  readonly popup?: 'menu' | 'dialog'
  /** Right-click and the context-menu key, when they open something else than a click: the topic menu. */
  readonly onMenu?: (at: MenuAnchor) => void
  readonly ref?: Ref<HTMLButtonElement>
}

/**
 * The page title as a menu button, inside the page's `h1` (inventory 5):
 * the title on one line, then a chevron. It opens the page's menu: the
 * topic's row menu, or the Juno menu.
 */
export function HeaderTitleButton({ title, leading, expanded, onOpen, popup = 'menu', onMenu, ref }: HeaderTitleButtonProps) {
  const under = (target: HTMLElement): MenuAnchor => {
    const island = (target.closest('[data-island]') ?? target).getBoundingClientRect()
    return { x: island.left, y: island.bottom + MENU_GAP }
  }
  const open = (target: HTMLElement) => onOpen(under(target))
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown') return
    event.preventDefault()
    open(event.currentTarget)
  }
  const onContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (onMenu === undefined) open(event.currentTarget)
    else onMenu(under(event.currentTarget))
  }
  return (
    <h1 {...stylex.props(styles.heading)}>
      <button
        ref={ref}
        type="button"
        aria-haspopup={popup}
        aria-expanded={expanded}
        onClick={(event) => open(event.currentTarget)}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        {...stylex.props(styles.reset, focusRing.outside, styles.title, expanded && styles.titleOpen)}
      >
        {leading}
        <span dir="auto" {...stylex.props(styles.titleText)}>
          {title}
        </span>
        <span {...stylex.props(styles.caret)}>
          <Icon icon={CaretDown} size={12} weight="bold" />
        </span>
      </button>
    </h1>
  )
}

export interface IslandButtonProps {
  readonly icon: PhosphorIcon
  /** The visible text in a roomy header, and the accessible name in both forms. */
  readonly label: string
  /** A label this button can turn into (Follow and Resolve): the roomy label keeps the wider of the two widths, so the swap moves nothing. */
  readonly reserve?: string
  /** `at` is under the right island, at the button's left edge, where a menu it opens goes. */
  readonly onClick: (at: MenuAnchor) => void
}

/**
 * A text button in the right island: Follow, Resolve, Reopen. In a narrow
 * header it becomes a 28px icon button by CSS alone; its accessible name
 * never changes.
 */
export function IslandButton({ icon, label, reserve, onClick }: IslandButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      {...tooltip(label)}
      onClick={(event) => onClick(underRightIsland(event.currentTarget))}
      {...stylex.props(styles.reset, focusRing.outside, styles.island, styles.iconOnlyWhenNarrow)}
    >
      <span {...stylex.props(styles.islandIcon)}>
        <Icon icon={icon} size={14} />
      </span>
      {reserve === undefined ? (
        <span {...stylex.props(styles.roomy)}>{label}</span>
      ) : (
        <span {...stylex.props(styles.roomyStack)}>
          <span {...stylex.props(styles.stacked)}>{label}</span>
          <span aria-hidden="true" {...stylex.props(styles.stacked, styles.reserved)}>
            {reserve}
          </span>
        </span>
      )}
    </button>
  )
}

/** Under the right island, at `button`'s left edge: where ⋯ opens its menu. */
function underRightIsland(button: HTMLElement): MenuAnchor {
  const box = button.getBoundingClientRect()
  const island = (button.closest('[data-island]') ?? button).getBoundingClientRect()
  return { x: box.left, y: island.bottom + MENU_GAP }
}

export interface MoreButtonProps {
  /** Its menu is showing. */
  readonly expanded: boolean
  /** Click, Enter or Space. `at` is under the right island, at the button's left edge. */
  readonly onOpen: (at: MenuAnchor) => void
}

/** The right island's ⋯: the topic's menu, the same as its sidebar row's (SPEC 5, 7). */
export function MoreButton({ expanded, onOpen }: MoreButtonProps) {
  return (
    <IconButton
      icon={DotsThree}
      label="More"
      size={28}
      iconSize={18}
      iconWeight="bold"
      radius="full"
      variant="island"
      aria-haspopup="menu"
      expanded={expanded}
      onClick={(event) => onOpen(underRightIsland(event.currentTarget))}
    />
  )
}

export interface JunoToggleProps {
  readonly pressed: boolean
  readonly onToggle: () => void
}

/** The right island's Juno button: opens and closes the Juno panel (⌘J does the same). */
export function JunoToggle({ pressed, onToggle }: JunoToggleProps) {
  return <IconButton icon={SparkleDuotone} label="Juno" shortcut={menuKeys('juno.toggle')} size={28} iconSize={16} radius="full" variant="island" pressed={pressed} onClick={onToggle} />
}

const styles = stylex.create({
  heading: {
    display: 'flex',
    flexGrow: 0,
    flexShrink: TITLE_SHRINK,
    minWidth: layout['--header-title-min-width'],
    margin: 0,
    fontSize: 'inherit',
    fontWeight: 'inherit',
  },
  // The element reset and the shared feedback (ui's `interactive`, which is internal to it); the ring is ui's `focusRing`.
  reset: {
    appearance: 'none',
    margin: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colors['--foreground-default'],
    fontFamily: text['--text-meta-family'],
    textAlign: 'start',
    userSelect: 'none',
    cursor: 'default',
    WebkitAppRegion: 'no-drag',
    transitionProperty: 'scale, background-color',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: motion['--ease-out'],
    scale: { default: '1', ':active': motion['--press-scale'] },
  },
  title: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    width: '100%',
    minWidth: 0,
    height: sizes['--control-28'],
    paddingBlock: 0,
    paddingInline: spacing['--space-2'],
    borderRadius: radii['--radius-pill'],
    fontSize: text['--text-body-small-size'],
    fontWeight: weights['--weight-semibold'],
    lineHeight: sizes['--control-28'],
    // The island controls' fills (IconButton's `island` variant): hover, then open or pressed, one step darker each.
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--secondary-default'] },
    },
  },
  titleOpen: {
    backgroundColor: {
      default: colors['--secondary-hover'],
      ':hover': { default: null, [HOVER]: colors['--secondary-active'] },
    },
  },
  titleText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  caret: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  island: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    gap: spacing['--space-1-5'],
    height: sizes['--control-28'],
    minWidth: sizes['--control-28'],
    paddingBlock: 0,
    paddingInline: spacing['--space-2-5'],
    boxSizing: 'border-box',
    borderRadius: radii['--radius-pill'],
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-medium'],
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--secondary-default'] },
    },
  },
  iconOnlyWhenNarrow: {
    paddingInline: { default: spacing['--space-2-5'], [NARROW]: 0 },
  },
  islandIcon: {
    display: 'inline-flex',
    color: colors['--foreground-subtle'],
  },
  roomy: {
    display: { default: 'inline', [NARROW]: 'none' },
  },
  // Both labels in one cell: the cell is as wide as the wider, and only the shown one is painted.
  roomyStack: {
    display: { default: 'inline-grid', [NARROW]: 'none' },
    justifyItems: 'center',
  },
  stacked: {
    gridArea: '1 / 1',
  },
  reserved: {
    visibility: 'hidden',
  },
})
