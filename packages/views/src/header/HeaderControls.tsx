import * as stylex from '@stylexjs/stylex'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import type { KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react'
import { accent, colors, motion, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { Icon, IconButton, type PhosphorIcon } from '@juno/ui'

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
/** The title never shortens past this; the pill gives way after it. */
const TITLE_MIN_WIDTH = '72px'
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
        {...stylex.props(styles.reset, styles.title, expanded && styles.titleOpen)}
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
  /** Keep the counter's space while its value loads or changes. */
  readonly reserveCount?: boolean

  readonly icon: PhosphorIcon
  /** The visible text in a roomy header. */
  readonly label: string
  /** What a narrow header shows beside the icon ("12" for Threads). Absent: the icon only. */
  readonly narrowLabel?: string
  /** The accessible name, when it differs from `label` ("Threads, 12"). It holds in the narrow form. */
  readonly name?: string
  /** A toggle or a popover's button is down. */
  readonly pressed?: boolean
  readonly expanded?: boolean
  readonly onClick: () => void
}

/**
 * A text button in the right island: Resolve, Reopen, Threads. In a
 * narrow header it becomes a 28px icon button, or the icon and a short
 * label, by CSS alone; its accessible name never changes.
 */
export function IslandButton({ reserveCount = false, icon, label, narrowLabel, name, pressed, expanded, onClick }: IslandButtonProps) {
  return (
    <button
      type="button"
      aria-label={name ?? label}
      title={name ?? label}
      aria-expanded={expanded}
      onClick={onClick}
      {...stylex.props(styles.reset, styles.island, reserveCount && styles.countWidth, narrowLabel === undefined && styles.iconOnlyWhenNarrow, (pressed === true || expanded === true) && styles.islandDown)}
    >
      <span {...stylex.props(styles.islandIcon)}>
        <Icon icon={icon} size={14} />
      </span>
      <span {...stylex.props(styles.roomy)}>{label}</span>
      {narrowLabel === undefined ? null : <span {...stylex.props(styles.narrow)}>{narrowLabel}</span>}
    </button>
  )
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
      onClick={(event) => {
        const button = event.currentTarget.getBoundingClientRect()
        const island = (event.currentTarget.closest('[data-island]') ?? event.currentTarget).getBoundingClientRect()
        onOpen({ x: button.left, y: island.bottom + MENU_GAP })
      }}
    />
  )
}

export interface JunoToggleProps {
  readonly pressed: boolean
  readonly onToggle: () => void
}

/** The right island's Juno button: opens and closes the Juno panel (⌘J does the same). */
export function JunoToggle({ pressed, onToggle }: JunoToggleProps) {
  return <IconButton icon={Sparkle} label="Juno ⌘J" size={28} iconSize={16} iconWeight="duotone" radius="full" variant="island" pressed={pressed} onClick={onToggle} />
}

const styles = stylex.create({
  countWidth: {
    justifyContent: 'flex-start',
    width: { default: sizes['--threads-button-width'], [NARROW]: sizes['--threads-button-narrow-width'] },
  },
  heading: {
    display: 'flex',
    flexGrow: 0,
    flexShrink: TITLE_SHRINK,
    minWidth: TITLE_MIN_WIDTH,
    margin: 0,
    fontSize: 'inherit',
    fontWeight: 'inherit',
  },
  // The element reset and the shared feedback (ui's `interactive`, which is internal to it).
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
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
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
  islandDown: {
    backgroundColor: {
      default: colors['--secondary-hover'],
      ':hover': { default: null, [HOVER]: colors['--secondary-active'] },
    },
  },
  islandIcon: {
    display: 'inline-flex',
    color: colors['--foreground-subtle'],
  },
  roomy: {
    display: { default: 'inline', [NARROW]: 'none' },
  },
  narrow: {
    display: { default: 'none', [NARROW]: 'inline' },
  },
})
