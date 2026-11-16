import * as stylex from '@stylexjs/stylex'
import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { colors, layout, radii, shadows, sizes, spacing, text, z } from '@juno/tokens/tokens.stylex'
import { Avatar, contextClick, Emoji, focusRing, moveFocus, Surface, Text } from '@juno/ui'
import { initials } from './look'
import type { Reactor } from './ReactorsCard'
import { placeNear } from './reactorsPlace'

/** One emoji on the message, with everyone Juno knows reacted with it, you first. */
export interface ReactionsDialogEntry {
  readonly name: string
  /** The glyph for a standard emoji, or `:name:` when there is no image. */
  readonly emoji: string
  /** A custom emoji's image. */
  readonly url?: string
  readonly count: number
  readonly reactors: ReadonlyArray<Reactor>
}

export interface ReactionsDialogProps {
  /** The message's reactions, in the order its chips show them. */
  readonly reactions: ReadonlyArray<ReactionsDialogEntry>
  /** The emoji whose people the list shows. */
  readonly selected: string
  readonly onSelect: (name: string) => void
  /** Juno is asking Slack for the people it did not list: their rows wait in place. */
  readonly loading?: boolean
}

/** The list shows this many rows before it scrolls; the half row says there is more. */
const LIST_ROWS = 8.5
/** The strip's shaded edge while it can scroll on. */
const SCROLLS_START = '@container scroll-state(scrollable: inline-start)'
const SCROLLS_END = '@container scroll-state(scrollable: inline-end)'

/**
 * Every reaction on a message and who reacted (SPEC 7, inventory 6.4a):
 * a strip of the message's emoji with their counts, which scrolls sideways,
 * then the chosen emoji's name and count over a list of its people, you
 * first. The list is as tall as the message's largest reaction needs, up to
 * eight and a half rows, so choosing another emoji moves nothing. People
 * Slack has not listed yet wait as rows in place; any it never lists end
 * the list as "and N others".
 */
export function ReactionsDialog({ reactions, selected, onSelect, loading = false }: ReactionsDialogProps) {
  const id = useId()
  const chosen = reactions.find((reaction) => reaction.name === selected) ?? reactions[0]
  if (chosen === undefined) return null
  const rows = Math.min(LIST_ROWS, Math.max(1, ...reactions.map((reaction) => reaction.count)))
  return (
    <Surface kind="popover" padding="none" sx={styles.panel} aria-busy={loading || undefined}>
      <Strip id={id} reactions={reactions} chosen={chosen.name} onSelect={onSelect} />
      <div {...stylex.props(styles.caption)}>
        <Text variant="meta" tone="muted" truncate tooltipWhenTruncated>
          :{chosen.name}:
        </Text>
        <Text variant="meta" tone="muted" numeric sx={styles.count}>
          {chosen.count === 1 ? '1 person' : `${chosen.count} people`}
        </Text>
      </div>
      <People id={id} chosen={chosen} rows={rows} loading={loading} />
    </Surface>
  )
}

/** The message's emoji with their counts, one chosen, in a track that scrolls sideways. */
function Strip({ id, reactions, chosen, onSelect }: { readonly id: string; readonly reactions: ReadonlyArray<ReactionsDialogEntry>; readonly chosen: string; readonly onSelect: (name: string) => void }) {
  const strip = useRef<HTMLDivElement>(null)
  // The chosen emoji stays in view, also when the dialog opens on one far along the strip.
  useLayoutEffect(() => {
    const scroller = strip.current
    const tab = scroller?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (scroller === null || scroller === undefined || tab === null || tab === undefined) return
    const room = tab.offsetWidth
    if (tab.offsetLeft - room < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, tab.offsetLeft - room)
    else if (tab.offsetLeft + tab.offsetWidth + room > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = tab.offsetLeft + tab.offsetWidth + room - scroller.clientWidth
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- A new choice must be brought into view from the committed DOM.
  }, [chosen])
  const choose = (name: string) => {
    if (name !== chosen) onSelect(name)
  }
  const press = (name: string) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || contextClick(event)) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    choose(name)
  }
  // A mouse wheel turns the strip; a trackpad's sideways swipe already does.
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY
  }
  return (
    <div {...stylex.props(styles.track)}>
      <div
        ref={strip}
        role="tablist"
        aria-label="Emoji"
        data-reactions-strip=""
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => moveFocus(event, '[role="tab"]', { select: true })}
        onWheel={wheel}
        {...stylex.props(styles.strip)}
      >
        <span aria-hidden {...stylex.props(styles.edge, styles.edgeStart)} />
        {reactions.map((reaction) => {
          const on = reaction.name === chosen
          return (
            <button
              key={reaction.name}
              type="button"
              role="tab"
              id={`${id}-${reaction.name}`}
              aria-selected={on}
              aria-controls={`${id}-people`}
              aria-label={`${reaction.count} ${reaction.url === undefined ? reaction.emoji : `:${reaction.name}:`}${reaction.reactors[0]?.you === true ? ', including you' : ''}`}
              tabIndex={on ? 0 : -1}
              data-reaction-tab={reaction.name}
              onPointerDown={press(reaction.name)}
              onClick={() => choose(reaction.name)}
              {...stylex.props(styles.tab, focusRing.inset, on && styles.tabOn)}
            >
              <ReactionEmoji reaction={reaction} />
              <span>{reaction.count}</span>
            </button>
          )
        })}
        <span aria-hidden {...stylex.props(styles.edge, styles.edgeEnd)} />
      </div>
    </div>
  )
}

/** The chosen emoji's people, you first; rows waiting for names Slack has not given yet. */
function People({ id, chosen, rows, loading }: { readonly id: string; readonly chosen: ReactionsDialogEntry; readonly rows: number; readonly loading: boolean }) {
  const missing = Math.max(0, chosen.count - chosen.reactors.length)
  // The panel scrolls, so it is a Tab stop of its own: the keyboard scrolls it, with the inset ring.
  return (
    <div id={`${id}-people`} role="tabpanel" tabIndex={0} aria-labelledby={`${id}-${chosen.name}`} data-reactions-people="" {...stylex.props(styles.list, styles.height(rows), focusRing.inset)}>
      <ul {...stylex.props(styles.people)}>
        {chosen.reactors.map((reactor) => (
          <li key={reactor.id} {...stylex.props(styles.person)}>
            <Avatar label={initials(reactor.name)} size={20} hue={reactor.hue} {...(reactor.avatarUrl === undefined ? {} : { src: reactor.avatarUrl })} />
            <Text variant="ui" tone="default" truncate tooltipWhenTruncated dir="auto">
              {reactor.you ? 'You' : reactor.name}
            </Text>
          </li>
        ))}
        {missing === 0 ? null : loading ? (
          Array.from({ length: missing }, (_, index) => (
            <li key={`waiting-${index}`} aria-hidden {...stylex.props(styles.person)}>
              <span {...stylex.props(styles.waitingAvatar)} />
              <span {...stylex.props(styles.waitingName, index % 3 === 1 && styles.waitingShort, index % 3 === 2 && styles.waitingLong)} />
            </li>
          ))
        ) : (
          <li {...stylex.props(styles.person)}>
            <Text variant="meta" tone="muted">
              {chosen.reactors.length === 0 ? (missing === 1 ? '1 person' : `${missing} people`) : `and ${missing === 1 ? '1 other' : `${missing} others`}`}
            </Text>
          </li>
        )}
      </ul>
    </div>
  )
}

function ReactionEmoji({ reaction }: { readonly reaction: ReactionsDialogEntry }) {
  if (reaction.url !== undefined) return <Emoji url={reaction.url} size={16} />
  if (!reaction.emoji.startsWith(':')) return <Emoji glyph={reaction.emoji} size={16} />
  return <span aria-hidden {...stylex.props(styles.shortcode)}>{reaction.emoji}</span>
}

export interface ReactionsPopoverProps extends ReactionsDialogProps {
  /** The chip it opened from, or the message's first chip: the dialog hangs under it. */
  readonly anchor: HTMLElement
  readonly onClose: () => void
}

/**
 * The reactions dialog as it shows over the window: fixed in a portal on
 * `body` under its chip, or over it when there is no room below, inside
 * the window, placed before its first paint. It opens at once with focus
 * on the chosen emoji. Esc, a press or a scroll outside it, or focus
 * leaving it closes it, and focus goes back to the chip.
 */
export function ReactionsPopover({ anchor, onClose, ...dialog }: ReactionsPopoverProps) {
  const layer = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useLayoutEffect(() => {
    if (layer.current !== null) placeNear(layer.current, anchor)
  })

  useLayoutEffect(() => {
    const root = layer.current
    root?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true })
    return () => {
      if (root?.contains(document.activeElement) === true && anchor.isConnected) anchor.focus({ preventScroll: true })
    }
  }, [anchor])

  useEffect(() => {
    const inside = (target: EventTarget | null) => target instanceof Node && layer.current?.contains(target) === true
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close.current()
    }
    const onPress = (event: Event) => {
      if (!inside(event.target)) close.current()
    }
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget !== null && !inside(event.relatedTarget)) close.current()
    }
    const root = layer.current
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPress, true)
    document.addEventListener('scroll', onPress, true)
    root?.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('scroll', onPress, true)
      root?.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  return createPortal(
    <div ref={layer} role="dialog" aria-label="Reactions" data-reactions-dialog="" {...stylex.props(styles.layer)}>
      <ReactionsDialog {...dialog} />
    </div>,
    document.body,
  )
}

const styles = stylex.create({
  // Fixed over the window, moved into place before it paints.
  layer: {
    position: 'fixed',
    top: 0,
    left: 0,
    zIndex: z['--z-menu'],
    WebkitAppRegion: 'no-drag',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    width: layout['--menu-width-browse'],
    overflow: 'hidden',
    userSelect: 'none',
  },
  // The strip sits in a segmented control's track, as a choice of one.
  track: {
    margin: spacing['--space-1-5'],
    padding: spacing['--space-0-5'],
    borderRadius: radii['--radius-md-plus'],
    backgroundColor: colors['--surface-hover'],
  },
  strip: {
    display: 'flex',
    gap: spacing['--space-0-5'],
    overflowX: 'auto',
    overscrollBehavior: 'contain',
    scrollbarWidth: 'none',
    containerType: 'scroll-state',
    borderRadius: radii['--radius-sm'],
  },
  // While the strip can scroll on, its edge shades the emoji under it. A
  // container query shows it, so no script watches the scroll; it sticks to
  // the edge and takes no room.
  edge: {
    position: 'sticky',
    zIndex: 1,
    flexShrink: 0,
    width: spacing['--space-5'],
    pointerEvents: 'none',
  },
  edgeStart: {
    insetInlineStart: 0,
    marginInlineEnd: `calc(-1 * ${spacing['--space-5']} - ${spacing['--space-0-5']})`,
    backgroundImage: `linear-gradient(to right, ${colors['--surface-hover']}, transparent)`,
    opacity: { default: 0, [SCROLLS_START]: 1 },
  },
  edgeEnd: {
    insetInlineEnd: 0,
    marginInlineStart: `calc(-1 * ${spacing['--space-5']} - ${spacing['--space-0-5']})`,
    backgroundImage: `linear-gradient(to left, ${colors['--surface-hover']}, transparent)`,
    opacity: { default: 0, [SCROLLS_END]: 1 },
  },
  tab: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 0,
    height: sizes['--control-28'],
    margin: 0,
    paddingInline: spacing['--space-2'],
    borderWidth: 0,
    borderRadius: radii['--radius-sm'],
    backgroundColor: 'transparent',
    color: {
      default: colors['--foreground-muted'],
      ':hover': { default: null, '@media (hover: hover)': colors['--foreground-default'] },
    },
    fontFamily: text['--text-tag-small-family'],
    fontSize: text['--text-tag-small-size'],
    fontWeight: text['--text-tag-small-weight'],
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    cursor: 'default',
  },
  // The chosen one is raised, as a segmented control's.
  tabOn: {
    backgroundColor: colors['--surface-raised'],
    boxShadow: shadows['--shadow-sm'],
    color: colors['--foreground-default'],
  },
  shortcode: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--icon-16'],
    height: sizes['--icon-16'],
    lineHeight: 1,
  },
  caption: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing['--space-3'],
    minWidth: 0,
    paddingInline: spacing['--space-3-5'],
    paddingBottom: spacing['--space-1'],
  },
  count: {
    flexShrink: 0,
  },
  list: {
    boxSizing: 'content-box',
    paddingTop: 0,
    paddingInline: spacing['--space-1-5'],
    paddingBottom: spacing['--space-1-5'],
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    borderBottomLeftRadius: radii['--radius-menu'],
    borderBottomRightRadius: radii['--radius-menu'],
  },
  people: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  // As tall as the message's largest reaction needs, so choosing another emoji moves nothing.
  height: (rows: number) => ({
    height: `calc(${sizes['--control-30']} * ${rows})`,
  }),
  person: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    flexShrink: 0,
    minWidth: 0,
    height: sizes['--control-30'],
    paddingInline: spacing['--space-2'],
  },
  waitingAvatar: {
    flexShrink: 0,
    width: sizes['--avatar-20'],
    height: sizes['--avatar-20'],
    borderRadius: radii['--radius-full'],
    backgroundColor: colors['--secondary-default'],
  },
  waitingName: {
    width: '45%',
    height: sizes['--icon-12'],
    borderRadius: radii['--radius-sm'],
    backgroundColor: colors['--secondary-default'],
  },
  waitingShort: {
    width: '32%',
  },
  waitingLong: {
    width: '58%',
  },
})
