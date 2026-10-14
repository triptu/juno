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

// The pinned tab's unread dot sits over the icon's top-right corner with a
// 1.5px ring in the strip's colour (inventory 4). One-off sizes.
const PINNED_DOT_RING = '1.5px'
const PINNED_DOT_OFFSET = '-2px'

export interface TabStripProps {
  readonly label?: string
  /**
   * Controls before the tabs, after the traffic lights' space: Show
   * sidebar, Back and Forward while the sidebar is hidden.
   */
  readonly leading?: ReactNode
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
export function TabStrip({ label = 'Tabs', leading, trailing, onKeyDown, children }: TabStripProps) {
  return (
    <div data-tab-strip="" {...stylex.props(styles.strip, leading !== undefined && styles.stripLeading)}>
      {leading !== undefined ? <span {...stylex.props(styles.leading)}>{leading}</span> : null}
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
  /** Read after the label by assistive technology, for a state the icon shows ("Stealth"). */
  readonly description?: string
  readonly active?: boolean
  /** A pinned tab: 40px, the icon alone, the label as its name and tooltip. Give it no `onClose`. */
  readonly pinned?: boolean
  /**
   * The topic has unread messages: a soft grey dot after the label, or at
   * the icon's corner on a pinned tab. Never shown on the active tab, which
   * marks read when it opens.
   */
  readonly unread?: boolean
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
export function Tab({ icon, leading, label, description, active = false, pinned = false, unread = false, onSelect, onClose, onContextMenu, closeLabel = 'Close tab' }: TabProps) {
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

  const dot = unread && !active
  const describedAs = [description, dot ? 'Unread' : undefined].filter((part) => part !== undefined).join(', ')

  return (
    <div
      ref={ref}
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      aria-description={describedAs === '' ? undefined : describedAs}
      aria-label={pinned ? label : undefined}
      data-pinned={pinned ? '' : undefined}
      data-unread={dot ? '' : undefined}
      title={label}
      onContextMenu={onContextMenu}
      onPointerDown={activate.onPointerDown}
      onClick={activate.onClick}
      onKeyDown={onKeyDown}
      {...stylex.props(interactive.focusRingInset, styles.tab, typeVariants.ui, active ? styles.tabActive : styles.tabInactive, pinned && styles.tabPinned)}
    >
      <span {...stylex.props(styles.iconSlot, pinned && styles.iconSlotPinned)}>
        {leading ?? <Icon icon={icon} size={15} dim />}
        {pinned ? <span aria-hidden {...stylex.props(styles.pinnedDot, dot && styles.dotShown)} /> : null}
      </span>
      {pinned ? null : (
        <>
          <span dir="auto" {...stylex.props(styles.label)}>
            {label}
          </span>
          {/* The dot's slot is always kept, so a dot that comes or goes never moves the label's end. */}
          <span aria-hidden {...stylex.props(styles.dot, dot && styles.dotShown)} />
        </>
      )}
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
  // With the sidebar hidden the strip starts after the traffic lights.
  stripLeading: {
    paddingInlineStart: layout['--titlebar-lights-inset'],
  },
  leading: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
    flexShrink: 0,
    alignSelf: 'center',
    marginInlineEnd: spacing['--space-2'],
    WebkitAppRegion: 'no-drag',
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
  // Icon only, centred, at a fixed width that never shrinks.
  tabPinned: {
    flexBasis: layout['--tab-pinned-width'],
    flexShrink: 0,
    minWidth: layout['--tab-pinned-width'],
    width: layout['--tab-pinned-width'],
    justifyContent: 'center',
    paddingInline: 0,
  },
  iconSlot: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--icon-16'],
    height: sizes['--icon-16'],
    overflow: 'hidden',
  },
  iconSlotPinned: {
    overflow: 'visible',
  },
  dot: {
    flexShrink: 0,
    width: sizes['--tab-unread-dot'],
    height: sizes['--tab-unread-dot'],
    borderRadius: radii['--radius-full'],
    backgroundColor: colors['--foreground-muted'],
    opacity: 0,
  },
  // At the icon's top-right corner, ringed in the strip's colour so it reads apart from the icon.
  pinnedDot: {
    position: 'absolute',
    top: PINNED_DOT_OFFSET,
    right: PINNED_DOT_OFFSET,
    width: sizes['--tab-unread-dot'],
    height: sizes['--tab-unread-dot'],
    borderRadius: radii['--radius-full'],
    backgroundColor: colors['--foreground-muted'],
    boxShadow: `0 0 0 ${PINNED_DOT_RING} ${colors['--background-subtle']}`,
    opacity: 0,
  },
  dotShown: {
    opacity: 1,
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
