import * as stylex from '@stylexjs/stylex'
import type { DragEvent, ReactNode } from 'react'
import { colors, spacing, z } from '@juno/tokens/tokens.stylex'

export interface TopicViewProps {
  /** The `TopicHeader`, laid over the top of the list. */
  readonly header: ReactNode
  /** The `MessageList`, or whatever the container shows in its place. */
  readonly children: ReactNode
  /** The `NewMessagesPill`, floated over the bottom of the list while scrolled up. */
  readonly pill?: ReactNode
  /** The `ComposerSlot` until the draft loads, then the composer. */
  readonly composer?: ReactNode
  /** Over the list, outside its rows: the emoji picker, the selection's Quote button (`Floating`). Positioned from the list area's top left. */
  readonly floating?: ReactNode
  /** Files dropped anywhere on the topic go to its composer. */
  readonly onFiles?: (files: ReadonlyArray<File>) => void
  /** Files are being dragged over the topic, or no longer are: the composer shows it. */
  readonly onDragFiles?: (over: boolean) => void
}

/** A drag that carries files from Finder, not text or a link. */
const carriesFiles = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes('Files')

/**
 * One topic in a tab (SPEC section 7): the list filling the area above the
 * composer, with the header's islands floating over its top and the pill
 * over its bottom edge. Neither takes part in the list's layout, so a header
 * change never moves a message. The header comes first in the DOM, so it
 * is first in the Tab order.
 */
export function TopicView({ header, children, pill, composer, floating, onFiles, onDragFiles }: TopicViewProps) {
  const drops =
    onFiles === undefined
      ? {}
      : {
          onDragEnter: (event: DragEvent<HTMLDivElement>) => {
            if (carriesFiles(event)) onDragFiles?.(true)
          },
          onDragOver: (event: DragEvent<HTMLDivElement>) => {
            if (!carriesFiles(event)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          },
          onDragLeave: (event: DragEvent<HTMLDivElement>) => {
            // Leaving one row for the next fires too; only leaving the topic ends the drag.
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) onDragFiles?.(false)
          },
          onDrop: (event: DragEvent<HTMLDivElement>) => {
            onDragFiles?.(false)
            // The composer took a drop on itself already.
            if (event.defaultPrevented) return
            const files = Array.from(event.dataTransfer.files)
            if (files.length === 0) return
            event.preventDefault()
            onFiles(files)
          },
        }
  return (
    <div data-topic-view="" {...drops} {...stylex.props(styles.root)}>
      <div data-topic-middle="" {...stylex.props(styles.middle)}>
        {header}
        {children}
        {pill !== undefined ? <div {...stylex.props(styles.pill)}>{pill}</div> : null}
        {floating}
      </div>
      {composer}
    </div>
  )
}

const styles = stylex.create({
  // Fills whatever holds it (the workspace page, a gallery frame) and
  // keeps its own height to that, so the list scrolls instead of growing.
  root: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors['--background'],
  },
  middle: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
  },
  // Centred over the list's bottom edge. The wrapper is only as wide as the
  // pill, so the rows beside it stay clickable.
  pill: {
    position: 'absolute',
    bottom: spacing['--space-3'],
    left: '50%',
    translate: '-50% 0',
    display: 'inline-flex',
    zIndex: z['--z-toolbar'],
  },
})
