import * as stylex from '@stylexjs/stylex'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import type { KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react'
import { menuKeys } from '@juno/contract/channels'
import { colors, layout, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { focusRing, menuTriggerHandlers, Icon, IconButton, Text } from '@juno/ui'

/** Where a menu opened from the header goes, in CSS pixels from the window's top left. */
export interface MenuAnchor {
  readonly x: number
  readonly y: number
}

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'
/** The menu opens this far under the left island, left-aligned with the title. */
const MENU_GAP = 6
/** Far above the pill's 1, so the title takes all the shortening until it reaches its floor. */
const TITLE_SHRINK = 1000

export interface HeaderTitleButtonProps {
  readonly title: string
  /** Before the title: the Juno mark in the Juno headers. */
  readonly leading?: ReactNode
  /** The menu or popover it opens is showing. */
  readonly expanded: boolean
  /** Primary press, Enter, Space or ↓; and right-click or the context-menu key unless `onMenu` is given. `at` is under the left island, at the title's left edge. */
  readonly onOpen: (at: MenuAnchor) => void
  /** What it opens: a menu (the Juno menu), or a popover with a searchable list (the topic switcher). Default `menu`. */
  readonly popup?: 'menu' | 'dialog'
  /** Right-click and the context-menu key, when they open something else than a click: the topic menu. */
  readonly onMenu?: (at: MenuAnchor) => void
  /**
   * Wrap the button in the page's `h1`. Default true (the topic title). The
   * Juno switcher passes false: it is a menu button, and a Juno page has
   * its own `h1` under it.
   */
  readonly heading?: boolean
  readonly ref?: Ref<HTMLButtonElement>
}

/**
 * The page title as a menu button, inside the page's `h1` unless `heading` is false (inventory 5):
 * the title on one line, then a chevron. It opens the page's menu: the
 * topic's row menu, or the Juno menu. A cut-off title shows in full on
 * hover, as the thread link and sender name do.
 */
export function HeaderTitleButton({ title, leading, expanded, onOpen, popup = 'menu', onMenu, heading = true, ref }: HeaderTitleButtonProps) {
  const under = (target: HTMLElement): MenuAnchor => {
    const island = (target.closest('[data-island]') ?? target).getBoundingClientRect()
    return { x: target.getBoundingClientRect().left, y: island.bottom + MENU_GAP }
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
  const Wrapper = heading ? 'h1' : 'div'
  return (
    <Wrapper {...stylex.props(styles.heading)}>
      <button
        ref={ref}
        type="button"
        aria-haspopup={popup}
        aria-expanded={expanded}
        {...menuTriggerHandlers({ 'aria-haspopup': popup, onClick: (event) => open(event.currentTarget), onKeyDown })}
        onContextMenu={onContextMenu}
        {...stylex.props(styles.reset, focusRing.outside, styles.title, expanded && styles.titleOpen)}
      >
        {leading}
        <Text variant="inherit" truncate tooltipWhenTruncated dir="auto" as="span">
          {title}
        </Text>
        <span {...stylex.props(styles.caret)}>
          <Icon icon={CaretDown} size={12} weight="bold" />
        </span>
      </button>
    </Wrapper>
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
  /** Primary press, Enter or Space. `at` is under the right island, at the button's left edge. */
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
  return <IconButton icon={Sparkle} label="Juno" shortcut={menuKeys('juno.toggle')} size={28} iconSize={16} radius="full" variant="island" pressed={pressed} onClick={onToggle} />
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
    transitionProperty: 'background-color',
    transitionDuration: '0s',
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
    // The island controls' fills (IconButton's `island` variant). Open keeps the hover fill, so opening changes no colour.
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--secondary-default'] },
    },
  },
  titleOpen: {
    backgroundColor: colors['--secondary-default'],
  },
  caret: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
})
