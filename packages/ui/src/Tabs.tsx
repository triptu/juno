import * as stylex from '@stylexjs/stylex'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { colors, layout, radii, sizes, spacing, weights } from '@juno/tokens/tokens.stylex'
import { Icon, type PhosphorIcon } from './Icon'
import { IconButton } from './IconButton'
import { activateHandlers, type ActivateEvent } from './internal/activate'
import { interactive } from './internal/interactive'
import { variants as typeVariants } from './internal/type'

const HOVER = '@media (hover: hover)'

// A tab squeezed to about its floor (`--tab-min-width`, 120px) has room for
// its icon and six or so characters. Below this width an inactive tab gives
// the close button's space to the label and shows the button over the
// label's end on hover or focus. Container queries cannot read tokens, so
// the breakpoint is a constant here.
const NARROW_TAB = '@container tab (max-width: 140px)'

export interface TabStripProps {
  readonly label?: string
  /** The new-tab button, after the scroller, so it never leaves the screen. */
  readonly trailing?: ReactNode
  /**
   * Keys pressed on a tab that the strip does not handle itself: the owner
   * moves the selection on ArrowLeft, ArrowRight, Home and End (the APG
   * tablist pattern with automatic activation). Delete closes the tab.
   */
  readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  readonly children?: ReactNode
}

/**
 * The 44px strip above the workspace. A window drag region. The tabs sit in
 * a horizontal scroller with no visible scrollbar; the active tab scrolls
 * itself into view when it changes, like browser tabs.
 */
export function TabStrip({ label = 'Tabs', trailing, onKeyDown, children }: TabStripProps) {
  return (
    <div data-tab-strip="" {...stylex.props(styles.strip)}>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} {...stylex.props(styles.scroller)}>
        {children}
      </div>
      {trailing ? (
        <span data-tab-strip-trailing="" {...stylex.props(styles.trailing)}>
          {trailing}
        </span>
      ) : null}
    </div>
  )
}

export interface TabProps {
  readonly icon: PhosphorIcon
  /**
   * Fills the 16px icon slot instead of `icon`: a topic's art, drawn at the
   * slot's size. The slot keeps its size either way, so swapping one for
   * the other never moves the label.
   */
  readonly leading?: ReactNode
  readonly label: string
  readonly active?: boolean
  /** Fires on mouse down (see internal/activate.ts); `metaKey` for ⌘-click. */
  readonly onSelect?: (event: ActivateEvent) => void
  readonly onClose?: () => void
  readonly onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
  /** Accessible name for the close button. Default "Close tab". */
  readonly closeLabel?: string
}

const isTab = (node: Element | null): node is HTMLElement => node instanceof HTMLElement && node.getAttribute('role') === 'tab'

/** Where focus goes when a focused tab closes: the right neighbour, else the left, else the new-tab button. */
function focusTarget(tab: HTMLElement): HTMLElement | undefined {
  const next = tab.nextElementSibling
  if (isTab(next)) return next
  const previous = tab.previousElementSibling
  if (isTab(previous)) return previous
  const trailing = tab.closest('[data-tab-strip]')?.querySelector<HTMLElement>('[data-tab-strip-trailing] button')
  return trailing ?? undefined
}

/**
 * One tab. The active one merges into the page below it and is the only one
 * in the Tab order (roving tabindex); it takes focus when the selection
 * moves while focus is in the strip. The icon stays regular even when
 * active: tab switches do not animate and a filled set is too heavy in a
 * strip.
 */
export function Tab({ icon, leading, label, active = false, onSelect, onClose, onContextMenu, closeLabel = 'Close tab' }: TabProps) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const tab = ref.current
    if (!active || tab === null) return
    tab.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    const focused = document.activeElement
    if (focused !== tab && isTab(focused) && tab.parentElement?.contains(focused)) tab.focus({ preventScroll: true })
  }, [active])

  const close = () => {
    const tab = ref.current
    if (tab !== null && tab.contains(document.activeElement)) focusTarget(tab)?.focus()
    onClose?.()
  }

  const activate = activateHandlers<HTMLDivElement>(onSelect)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (onClose !== undefined && event.target === event.currentTarget && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault()
      close()
      return
    }
    activate.onKeyDown(event)
  }

  return (
    <div
      ref={ref}
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      title={label}
      onContextMenu={onContextMenu}
      onPointerDown={activate.onPointerDown}
      onClick={activate.onClick}
      onKeyDown={onKeyDown}
      {...stylex.props(interactive.focusRingInset, styles.tab, typeVariants.ui, active ? styles.tabActive : styles.tabInactive)}
    >
      <span {...stylex.props(styles.iconSlot)}>{leading ?? <Icon icon={icon} size={15} dim />}</span>
      <span dir="auto" {...stylex.props(styles.label)}>
        {label}
      </span>
      {onClose ? (
        <span {...stylex.props(styles.close, !active && styles.closeInactive)}>
          <IconButton
            icon={X}
            label={closeLabel}
            size={20}
            iconSize={13}
            tone="muted"
            noTooltip
            onClick={(event) => {
              event.stopPropagation()
              close()
            }}
          />
        </span>
      ) : null}
    </div>
  )
}

const styles = stylex.create({
  strip: {
    display: 'flex',
    alignItems: 'flex-end',
    // Fills the window so the strip and its bottom border run edge to edge,
    // and never gives up height to a tall page under it.
    width: '100%',
    flexShrink: 0,
    boxSizing: 'border-box',
    height: layout['--titlebar-height'],
    paddingInline: spacing['--space-2-5'],
    backgroundColor: colors['--background-subtle'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
    userSelect: 'none',
    WebkitAppRegion: 'drag',
  },
  // The tabs scroll sideways inside the strip. The scroller hangs 1px over
  // the strip's bottom border so the active tab can paint across it.
  scroller: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: spacing['--space-0-5'],
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    height: '100%',
    marginBottom: '-1px',
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollbarWidth: 'none',
    scrollSnapType: 'x proximity',
    overscrollBehaviorX: 'contain',
  },
  trailing: {
    display: 'inline-flex',
    flexShrink: 0,
    marginBottom: spacing['--space-1'],
    marginInlineStart: spacing['--space-1'],
    WebkitAppRegion: 'no-drag',
  },
  tab: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    flexBasis: layout['--tab-width'],
    flexGrow: 0,
    flexShrink: 1,
    minWidth: layout['--tab-min-width'],
    height: layout['--tab-height'],
    paddingInlineStart: spacing['--space-3'],
    paddingInlineEnd: spacing['--space-1-5'],
    borderTopLeftRadius: radii['--radius-lg'],
    borderTopRightRadius: radii['--radius-lg'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    scrollSnapAlign: 'start',
    // Its own width decides whether the close button has room (NARROW_TAB).
    containerType: 'inline-size',
    containerName: 'tab',
    WebkitAppRegion: 'no-drag',
    minHeight: 0,
  },
  tabActive: {
    backgroundColor: colors['--background'],
    borderTopColor: colors['--border-default'],
    borderLeftColor: colors['--border-default'],
    borderRightColor: colors['--border-default'],
    borderBottomColor: colors['--background'],
    color: colors['--foreground-default'],
    fontWeight: weights['--weight-medium'],
  },
  tabInactive: {
    color: {
      default: colors['--foreground-subtle'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
    fontWeight: weights['--weight-regular'],
    // Read by the close button on a narrow tab: shown while the pointer or
    // the keyboard is on the tab.
    '--tab-close-opacity': {
      default: '0',
      ':hover': { default: null, [HOVER]: '1' },
      ':focus-within': '1',
    },
  },
  iconSlot: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--icon-16'],
    height: sizes['--icon-16'],
    overflow: 'hidden',
  },
  label: {
    flexGrow: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  close: {
    display: 'inline-flex',
    flexShrink: 0,
  },
  // On a narrow inactive tab the button leaves the flow and sits over the
  // label's end on the strip's own colour, so appearing moves nothing.
  closeInactive: {
    position: { default: 'static', [NARROW_TAB]: 'absolute' },
    insetInlineEnd: spacing['--space-1-5'],
    paddingInlineStart: { default: 0, [NARROW_TAB]: spacing['--space-1'] },
    backgroundColor: { default: 'transparent', [NARROW_TAB]: colors['--background-subtle'] },
    opacity: { default: 1, [NARROW_TAB]: 'var(--tab-close-opacity)' },
  },
})
