import * as stylex from '@stylexjs/stylex'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { useId, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { colors, layout, radii, shadows, sizes, spacing, weights } from '@juno/tokens/tokens.stylex'
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

/** The tab element inside a tab's box (`data-tab`), the box being a tablist child. */
const tabIn = (box: Element | null): HTMLElement | null => box?.querySelector<HTMLElement>(':scope > [role="tab"]') ?? null

/** Where focus goes when a focused tab closes: the right neighbour, else the left, else the new-tab button. */
function focusTarget(box: HTMLElement): HTMLElement | undefined {
  const next = tabIn(box.nextElementSibling)
  if (next !== null) return next
  const previous = tabIn(box.previousElementSibling)
  if (previous !== null) return previous
  const trailing = box.closest('[data-tab-strip]')?.querySelector<HTMLElement>('[data-tab-strip-trailing] button')
  return trailing ?? undefined
}

/**
 * One tab. The active one merges into the page below it and is the only one
 * in the Tab order (roving tabindex); it takes focus when the selection
 * moves while focus is in the strip. The icon stays regular even when
 * active: tab switches do not animate and a filled set is too heavy in a
 * strip.
 *
 * The close button is the tab's sibling in a plain box, not its child, so no
 * control sits inside another. It is never a Tab stop: Delete and ⌘W close a
 * focused tab. The tab names it with `aria-actions`, which VoiceOver offers
 * as the tab's action, and the pointer clicks it where it always was.
 */
export function Tab({ icon, leading, label, active = false, pinned = false, unread = false, onSelect, onClose, onContextMenu, closeLabel = 'Close tab' }: TabProps) {
  const ref = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const closeId = useId()

  useLayoutEffect(() => {
    const tab = ref.current
    if (!active || tab === null) return
    tab.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    const focused = document.activeElement
    if (focused !== tab && isTab(focused) && tab.closest('[role="tablist"]')?.contains(focused)) tab.focus({ preventScroll: true })
  }, [active])

  const close = () => {
    const box = boxRef.current
    if (box !== null && box.contains(document.activeElement)) focusTarget(box)?.focus()
    onClose?.()
  }

  // A press does not focus the tab: the page it shows takes focus, as in Safari. The keyboard still moves focus in the strip.
  const activate = activateHandlers<HTMLDivElement>(onSelect, { keepFocus: true })
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (onClose !== undefined && event.target === event.currentTarget && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault()
      close()
      return
    }
    activate.onKeyDown(event)
  }

  const dot = unread && !active

  return (
    <div
      ref={boxRef}
      data-tab=""
      {...stylex.props(styles.box, active ? styles.boxActive : styles.boxInactive, pinned && styles.boxPinned)}
    >
      <div
        ref={ref}
        role="tab"
        tabIndex={active ? 0 : -1}
        aria-selected={active}
        aria-description={dot ? 'Unread' : undefined}
        aria-label={pinned ? label : undefined}
        aria-actions={onClose ? closeId : undefined}
        aria-keyshortcuts={onClose ? 'Delete' : undefined}
        data-pinned={pinned ? '' : undefined}
        data-unread={dot ? '' : undefined}
        title={label}
        onContextMenu={onContextMenu}
        onPointerDown={activate.onPointerDown}
        onClick={activate.onClick}
        onKeyDown={onKeyDown}
        {...stylex.props(
          interactive.focusRingInset,
          styles.tab,
          typeVariants.ui,
          active ? styles.tabActive : styles.tabInactive,
          pinned && styles.tabPinned,
          onClose !== undefined && styles.tabClosable,
          onClose !== undefined && !active && styles.tabClosableInactive,
        )}
      >
        <TabContent icon={icon} leading={leading} label={label} pinned={pinned} dot={dot} />
      </div>
      {onClose ? <TabClose id={closeId} label={closeLabel} active={active} onClose={close} /> : null}
      <span aria-hidden data-tab-divider="" {...stylex.props(styles.divider)} />
      <span aria-hidden data-tab-cover="" {...stylex.props(styles.cover)} />
    </div>
  )
}

/** The tab's icon slot, label and unread dot. */
function TabContent({ icon, leading, label, pinned, dot }: Pick<TabProps, 'icon' | 'leading' | 'label'> & { readonly pinned: boolean; readonly dot: boolean }) {
  return (
    <>
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
    </>
  )
}

/** The close button over the tab's end: the tab's sibling, never a Tab stop. */
function TabClose({ id, label, active, onClose }: { readonly id: string; readonly label: string; readonly active: boolean; readonly onClose: () => void }) {
  return (
    <span {...stylex.props(styles.close, !active && styles.closeInactive)}>
      <IconButton id={id} icon={X} label={label} size={20} iconSize={13} tone="muted" noTooltip tabIndex={-1} onClick={onClose} />
    </span>
  )
}

const styles = stylex.create({
  // The tab's box: its size in the strip, and the tab and its close button
  // side by side in it. Plain, so the tablist's children read as its tabs.
  box: {
    position: 'relative',
    display: 'flex',
    // The width too, not only the basis: the scroller sizes to its tabs' widths, which ignore the basis.
    flexBasis: layout['--tab-width'],
    width: layout['--tab-width'],
    flexGrow: 0,
    flexShrink: 1,
    minWidth: layout['--tab-min-width'],
    height: layout['--tab-height'],
    scrollSnapAlign: 'start',
    // Its own width decides whether the close button has room (NARROW_TAB).
    containerType: 'inline-size',
    containerName: 'tab',
    WebkitAppRegion: 'no-drag',
  },
  // Above its neighbours, so its shadow and its cover (below) paint over them.
  boxActive: {
    zIndex: 1,
    color: colors['--foreground-default'],
    '--tab-divider-opacity': '0',
    '--tab-cover-opacity': '1',
  },
  // On the box, so the pointer on the close button still counts as on the tab.
  boxInactive: {
    zIndex: { default: 'auto', ':hover': { default: null, [HOVER]: 1 } },
    color: {
      default: colors['--foreground-subtle'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
    // The tab's fill, read by the tab and by what sits on it (the narrow
    // close button's backing, the pinned dot's ring).
    '--tab-fill': {
      default: colors['--tab-strip'],
      ':hover': { default: null, [HOVER]: colors['--tab-hover'] },
    },
    // A hovered tab hides its own divider and covers its right neighbour's.
    // The first tab has nothing to its left.
    '--tab-divider-opacity': {
      default: '1',
      ':first-child': '0',
      ':hover': { default: null, [HOVER]: '0' },
    },
    '--tab-cover-opacity': {
      default: '0',
      ':hover': { default: null, [HOVER]: '1' },
    },
    // Read by the close button on a narrow tab: shown while the pointer or
    // the keyboard is on the tab.
    '--tab-close-opacity': {
      default: '0',
      ':hover': { default: null, [HOVER]: '1' },
      ':focus-within': '1',
    },
  },
  // Icon only, centred, at a fixed width that never shrinks.
  boxPinned: {
    flexBasis: layout['--tab-pinned-width'],
    flexShrink: 0,
    minWidth: layout['--tab-pinned-width'],
    width: layout['--tab-pinned-width'],
  },
  tab: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    paddingInlineStart: spacing['--space-3'],
    paddingInlineEnd: spacing['--space-1-5'],
    borderTopLeftRadius: radii['--radius-lg'],
    borderTopRightRadius: radii['--radius-lg'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    color: 'inherit',
    minHeight: 0,
  },
  // Room at the end for the close button over it: its 20px and the 8px gap before it.
  tabClosable: {
    paddingInlineEnd: `calc(${spacing['--space-1-5']} + ${sizes['--control-20']} + ${spacing['--space-2']})`,
  },
  // A narrow inactive tab gives that room to the label; the button shows over the label's end.
  tabClosableInactive: {
    paddingInlineEnd: { default: `calc(${spacing['--space-1-5']} + ${sizes['--control-20']} + ${spacing['--space-2']})`, [NARROW_TAB]: spacing['--space-1-5'] },
  },
  // Lifted out of the strip and joined to the page below: the page's fill,
  // a border on three sides and a shadow that falls only up and sideways.
  tabActive: {
    backgroundColor: colors['--background'],
    borderTopColor: colors['--border-strong'],
    borderLeftColor: colors['--border-strong'],
    borderRightColor: colors['--border-strong'],
    borderBottomColor: colors['--background'],
    boxShadow: shadows['--tab-shadow'],
    fontWeight: weights['--weight-medium'],
  },
  // The strip's fill, or the hover fill, inside the transparent border, so
  // the strip's bottom edge still runs under a hovered tab.
  tabInactive: {
    backgroundColor: 'var(--tab-fill)',
    backgroundClip: 'padding-box',
    fontWeight: weights['--weight-regular'],
  },
  tabPinned: {
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
    boxShadow: `0 0 0 ${PINNED_DOT_RING} var(--tab-fill, ${colors['--background']})`,
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
  // Over the tab's end, where the tab keeps room for it: the tab's 6px end
  // padding and 1px border in, centred on the tab's height.
  close: {
    position: 'absolute',
    insetBlock: 0,
    insetInlineEnd: `calc(${spacing['--space-1-5']} + 1px)`, // tokens-allow: Inside the tab's 1px border.
    display: 'inline-flex',
    alignItems: 'center',
  },
  // On a narrow inactive tab the button sits over the label's end on the
  // strip's own colour, so appearing moves nothing.
  closeInactive: {
    paddingInlineStart: { default: 0, [NARROW_TAB]: spacing['--space-1'] },
    backgroundColor: { default: 'transparent', [NARROW_TAB]: 'var(--tab-fill)' },
    opacity: { default: 1, [NARROW_TAB]: 'var(--tab-close-opacity)' },
  },
  // The divider at the tab's start, between it and its left neighbour. It
  // shows only between two inactive tabs that are not hovered: the tab hides
  // its own, and a hovered or active left neighbour covers it.
  divider: {
    position: 'absolute',
    insetInlineStart: 0,
    top: `calc((${layout['--tab-height']} - ${sizes['--tab-divider-height']}) / 2)`,
    width: '1px', // tokens-allow: A hairline divider.
    height: sizes['--tab-divider-height'],
    backgroundColor: colors['--tab-divider'],
    opacity: 'var(--tab-divider-opacity)',
    pointerEvents: 'none',
  },
  // One pixel of the strip just past the tab's end, over the right
  // neighbour's divider. Shown while this tab is hovered or active.
  cover: {
    position: 'absolute',
    insetInlineEnd: '-1px', // tokens-allow: Over the right neighbour's first pixel, where its divider is.
    top: `calc((${layout['--tab-height']} - ${sizes['--tab-divider-height']}) / 2)`,
    width: '1px', // tokens-allow: The width of the divider it covers.
    height: sizes['--tab-divider-height'],
    backgroundColor: colors['--tab-strip'],
    opacity: 'var(--tab-cover-opacity)',
    pointerEvents: 'none',
  },
})
