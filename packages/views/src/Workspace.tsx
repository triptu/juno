import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, type PointerEvent, type ReactNode } from 'react'
import { JUNO_PANEL_WIDTH } from '@juno/contract/channels'
import { chat, colors, layout, radii, shadows, spacing, z } from '@juno/tokens/tokens.stylex'
import { EmptyState } from '@juno/ui'
import { WorkspaceStrip, type WorkspaceStripProps } from './WorkspaceStrip'

export type { WorkspaceTab, WorkspaceTabIcon } from './WorkspaceStrip'

export interface WorkspaceProps extends WorkspaceStripProps {
  /** The open pages, the hidden ones included. Nothing here shows the empty state. */
  readonly children?: ReactNode
  /** Shows the empty state over hidden pages: no tab is open, or the active tab has no page yet. */
  readonly nothingShown?: boolean
  /** What shows with no page, null for nothing. Default the empty state. */
  readonly empty?: ReactNode
  /**
   * The Juno panel: a floating inspector on the right of the page below the
   * strip, inset by the header islands' gap. It gives way to keep the page
   * 480px wide, down to its minimum; under that it covers the page.
   */
  readonly side?: ReactNode
  /** The panel's width in CSS pixels, 360 to 640. Default 440. */
  readonly sideWidth?: number
  /** A drag on the panel's edge ended at `width`. */
  readonly onSideResize?: (width: number) => void
  /** A double-click on the panel's edge. */
  readonly onSideResetWidth?: () => void
}

// --juno-panel-min-width + --juno-panel-topic-min + two --juno-panel-inset: under this the page would be too narrow to read beside the panel.
const COVER = '@container workspace-body (width < 856px)'

/** The right pane: the tab strip (a window drag region, `WorkspaceStrip`) over the page. */
export function Workspace({ tabs = [], activeId, onSelectTab, onCloseTab, onNewTab, newTabLabel = 'New chat', onMoveTab, onTabContextMenu, leading, children, nothingShown = false, empty, side, sideWidth = JUNO_PANEL_WIDTH.default, onSideResize, onSideResetWidth }: WorkspaceProps) {
  return (
    <section aria-label="Workspace" {...stylex.props(styles.root)}>
      <WorkspaceStrip tabs={tabs} activeId={activeId} onSelectTab={onSelectTab} onCloseTab={onCloseTab} onNewTab={onNewTab} newTabLabel={newTabLabel} onMoveTab={onMoveTab} onTabContextMenu={onTabContextMenu} leading={leading} />
      <div {...stylex.props(styles.body)}>
        <main {...stylex.props(styles.page)}>
          {children}
          {children == null || nothingShown ? (empty === undefined ? <WorkspaceEmpty /> : empty) : null}
        </main>
        {side == null ? null : (
          <SidePanel width={sideWidth} onResize={onSideResize} onReset={onSideResetWidth}>
            {side}
          </SidePanel>
        )}
      </div>
    </section>
  )
}

interface SidePanelProps {
  readonly width: number
  readonly onResize: ((width: number) => void) | undefined
  readonly onReset: (() => void) | undefined
  readonly children: ReactNode
}

const clampSide = (width: number) => Math.round(Math.min(JUNO_PANEL_WIDTH.max, Math.max(JUNO_PANEL_WIDTH.min, width)))

/**
 * The Juno panel's box and its resize edge, the gap on its left. As with
 * the sidebar, the width is written on the box, never through React state,
 * so a drag re-renders nothing; a drag reports its width when it ends and
 * a double-click asks for the default. The box's max-width keeps the page
 * at its minimum, so a wide panel gives way in a narrow window.
 */
function SidePanel({ width, onResize, onReset, children }: SidePanelProps) {
  const box = useRef<HTMLElement>(null)
  const drag = useRef<{ readonly startX: number; raw: number; frame: number | undefined } | undefined>(undefined)
  useLayoutEffect(() => {
    box.current?.style.setProperty('--juno-panel-set-width', `${width}px`)
  }, [width])
  // A custom property on the panel's own box, not its width, so the cover rule still wins.
  const write = (next: number) => box.current?.style.setProperty('--juno-panel-set-width', `${next}px`)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    // From the width the panel shows, which a narrow window may have capped.
    const shown = box.current?.getBoundingClientRect().width ?? width
    drag.current = { startX: event.clientX + shown - width, raw: width, frame: undefined }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current === undefined) return
    current.raw = width - (event.clientX - current.startX)
    if (current.frame !== undefined) return
    current.frame = requestAnimationFrame(() => {
      current.frame = undefined
      write(clampSide(current.raw))
    })
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current === undefined) return
    drag.current = undefined
    if (current.frame !== undefined) cancelAnimationFrame(current.frame)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const next = event.type === 'pointerup' ? clampSide(current.raw) : width
    write(next)
    if (next !== width) onResize?.(next)
  }

  return (
    <aside ref={box} aria-label="Juno" data-juno-panel="" {...stylex.props(styles.side)}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Juno"
        aria-valuemin={JUNO_PANEL_WIDTH.min}
        aria-valuemax={JUNO_PANEL_WIDTH.max}
        aria-valuenow={width}
        data-juno-panel-edge=""
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={onReset}
        {...stylex.props(styles.sideEdge)}
      />
      <div {...stylex.props(styles.sideBody)}>{children}</div>
    </aside>
  )
}

/** The empty workspace: what shows with no tab open, until Home has its own page. */
export function WorkspaceEmpty() {
  return (
    <div data-workspace-empty="" {...stylex.props(styles.empty)}>
      <EmptyState variant="workspace" illustration="nothing-open" title="Nothing open yet" body="Pick a topic on the left." padding="page" />
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    // Fills the shell's row beside the sidebar, and the full width of a
    // column that holds it alone.
    alignSelf: 'stretch',
    minWidth: 0,
    height: '100%',
    // When the window is as narrow as the sidebar (at the minimum size under
    // zoom) the pane shrinks to nothing; its content must not paint over the
    // sidebar.
    overflow: 'hidden',
    backgroundColor: colors['--background'],
  },
  // The page and the Juno panel side by side under the strip. A named
  // container, so the panel's cover rule reads the width both share.
  body: {
    position: 'relative',
    display: 'flex',
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    containerType: 'inline-size',
    containerName: 'workspace-body',
  },
  // A floating inspector: inset from the strip, the window edge and the
  // page by the header islands' gap, rounded, on the panel shadow. Beside
  // the page it is opaque (nothing moves under it); over the page it lets
  // the page through, blurred. Its header row lines up with the page's
  // islands, so the page's header variables are set for the panel's own
  // top here: the row at 0, the band and list inset 8px shorter.
  side: {
    // Not drawn until its chat has mounted (the Juno chunk loads lazily),
    // so the topic reflows and the panel appears in the same frame, never
    // as an empty floating box.
    display: {
      default: 'flex',
      ':not(:has([data-juno-chat]))': 'none',
    },
    position: {
      default: 'relative',
      [COVER]: 'absolute',
    },
    inset: {
      default: null,
      [COVER]: layout['--juno-panel-inset'],
    },
    zIndex: z['--z-panel'],
    flexDirection: 'column',
    flexShrink: 0,
    boxSizing: 'border-box',
    width: {
      default: `var(--juno-panel-set-width, ${layout['--juno-panel-width']})`,
      [COVER]: 'auto',
    },
    maxWidth: {
      default: `calc(100cqw - ${layout['--juno-panel-topic-min']} - 2 * ${layout['--juno-panel-inset']})`,
      [COVER]: 'none',
    },
    minWidth: {
      default: layout['--juno-panel-min-width'],
      [COVER]: 0,
    },
    minHeight: 0,
    marginBlock: {
      default: layout['--juno-panel-inset'],
      [COVER]: 0,
    },
    marginInline: {
      default: layout['--juno-panel-inset'],
      [COVER]: 0,
    },
    borderRadius: radii['--radius-panel'],
    boxShadow: shadows['--panel-shadow'],
    backgroundColor: {
      default: chat['--panel-fill'],
      [COVER]: chat['--panel-glass'],
    },
    backdropFilter: {
      default: 'none',
      [COVER]: chat['--panel-backdrop'],
    },
    '--header-island-top': '0px',
    '--header-band-solid': layout['--header-island-height'],
    '--header-band': `calc(${layout['--header-island-height']} + ${spacing['--space-6']})`,
    '--header-inset': `calc(${layout['--header-island-height']} + ${spacing['--space-3']})`,
  },
  // In the gap on the panel's left, over its full height. None while the panel covers the page.
  sideEdge: {
    display: {
      default: 'block',
      [COVER]: 'none',
    },
    position: 'absolute',
    top: 0,
    bottom: 0,
    insetInlineStart: `calc(-1 * ${layout['--juno-panel-resize-hit']})`,
    width: layout['--juno-panel-resize-hit'],
    zIndex: 1,
    cursor: 'col-resize',
    touchAction: 'none',
  },
  // Clips the chat to the panel's corners; the shadow stays outside.
  sideBody: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
    borderRadius: radii['--radius-panel'],
    overflow: 'hidden',
  },
  // The page fills the pane under the strip; a tall page scrolls inside
  // itself and never pushes the strip.
  page: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors['--background'],
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    minHeight: 0,
  },
})
