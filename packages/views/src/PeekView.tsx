import * as stylex from '@stylexjs/stylex'
import { useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { colors, layout, sizes, spacing, z } from '@juno/tokens/tokens.stylex'
import { compactDensity, Surface, Text } from '@juno/ui'

/**
 * Where the peek sits.
 *
 * - `sidebar`: beside the sidebar, from under the title bar down (a peek at a sidebar row).
 * - `below` / `above`: at a Main message (a peek at its thread). `x` is the
 *   left edge and `y` the message's bottom (`below`) or top (`above`), in
 *   window pixels; `room` is the window's height below `y` (`below`) or
 *   `y` itself (`above`). The container measured them.
 */
export type PeekPlacement = { readonly at: 'sidebar' } | { readonly at: 'below' | 'above'; readonly x: number; readonly y: number; readonly room: number }

const SIDEBAR: PeekPlacement = { at: 'sidebar' }

export interface PeekViewProps {
  /** The topic's title, or the channel's label for a Main. */
  readonly title: string
  /** Where the topic lives ("#eng", "Maya Chen"). Omitted for a Main, whose title already says it. */
  readonly where?: string
  /** The topic's art, 20px. */
  readonly art?: ReactNode
  /** Default `sidebar`. */
  readonly placement?: PeekPlacement
  /** The topic's messages: a `MessageList` with no actions, `popover` set. */
  readonly children: ReactNode
}

/**
 * The peek popover (spec section 5): a read-only look at a topic while the
 * peek key is held over its sidebar row, or over a Main message that has a
 * thread. Beside the sidebar, place it in the shell's `peek` slot; at a
 * message it goes to the body, so a hidden sidebar does not hide it. It
 * floats over the workspace and moves nothing when it appears.
 *
 * As tall as its messages, up to the room the window has; longer topics
 * scroll inside. The rows are compact whatever the app's density.
 *
 * A non-modal dialog: it never takes focus, so the row or the composer that
 * had it keeps it, and it is named by the topic's title. It appears at once
 * and closes at once; a peek lasts as long as a key is held.
 */
export function PeekView({ title, where, art, placement = SIDEBAR, children }: PeekViewProps) {
  const titleId = useId()
  const peek = (
    <div
      role="dialog"
      aria-modal={false}
      aria-labelledby={titleId}
      aria-roledescription="peek"
      data-peek={placement.at}
      {...stylex.props(
        compactDensity,
        styles.place,
        placement.at === 'sidebar' ? styles.sidebar : placement.at === 'below' ? styles.below(placement.x, placement.y, placement.room) : styles.above(placement.x, placement.y, placement.room),
      )}
    >
      <Surface kind="peek" sx={styles.panel}>
        <div {...stylex.props(styles.header)}>
          {art === undefined ? null : <span {...stylex.props(styles.art)}>{art}</span>}
          <Text variant="rowTitle" weight="semibold" truncate dir="auto" id={titleId} sx={styles.title}>
            {title}
          </Text>
          {where === undefined ? null : (
            <Text variant="meta" tone="muted" truncate dir="auto" sx={styles.where}>
              {where}
            </Text>
          )}
        </div>
        <div {...stylex.props(styles.list)}>{children}</div>
      </Surface>
    </div>
  )
  return placement.at === 'sidebar' ? peek : createPortal(peek, document.body)
}

const GAP = spacing['--space-2']

const styles = stylex.create({
  // Over the workspace, as wide as the token or the room right of its left
  // edge. Beside the sidebar, `100cqw` is the shell's width (the window's) and
  // the sidebar's slot is as tall as the window; at a message, portalled to
  // the body, `100vw` and `100vh` are the window's size.
  place: {
    zIndex: z['--z-menu'],
    display: 'flex',
    flexDirection: 'column',
    width: layout['--peek-width'],
    WebkitAppRegion: 'no-drag',
  },
  // Beside the sidebar's slot (its containing block).
  sidebar: {
    position: 'absolute',
    top: layout['--titlebar-height'],
    left: `calc(100% + ${GAP})`,
    maxWidth: `calc(100cqw - 100% - 2 * ${GAP})`,
    maxHeight: `calc(100% - ${layout['--titlebar-height']} - ${GAP})`,
  },
  below: (x: number, y: number, room: number) => ({
    position: 'fixed',
    top: y,
    left: x,
    maxWidth: `calc(100vw - ${x}px - ${GAP})`,
    maxHeight: `calc(${room}px - ${GAP})`,
  }),
  above: (x: number, y: number, room: number) => ({
    position: 'fixed',
    bottom: `calc(100vh - ${y}px)`,
    left: x,
    maxWidth: `calc(100vw - ${x}px - ${GAP})`,
    maxHeight: `calc(${room}px - ${layout['--titlebar-height']} - ${GAP})`,
  }),
  panel: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    overflow: 'clip',
    overscrollBehavior: 'contain',
  },
  // Its start lines up with the avatars below: the list's even scrollbar inset, the focus ring's room and the row's own inset.
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    flexShrink: 0,
    minWidth: 0,
    height: layout['--peek-header-height'],
    paddingInlineStart: `calc(${layout['--scrollbar-size']} + ${sizes['--focus-ring-room']} + ${spacing['--space-2']})`,
    paddingInlineEnd: spacing['--space-4'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
  },
  art: {
    display: 'flex',
    flexShrink: 0,
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
  },
  where: {
    flexShrink: 2,
    minWidth: 0,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 1,
    minHeight: 0,
  },
})
