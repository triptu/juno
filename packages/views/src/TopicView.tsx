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
  /** Over the list, outside its rows: the selection's bar (`Floating`). Positioned from the list area's top left. */
  readonly floating?: ReactNode
  /** The media viewer, over the whole topic: header, list and composer. While it shows they are inert. */
  readonly viewer?: ReactNode
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
 * is first in the Tab order. The viewer covers only this topic, so the
 * sidebar, the tab strip and the Juno panel stay usable, and each tab keeps
 * its own viewer open while another tab shows.
 */
export function TopicView({ header, children, pill, composer, floating, viewer, onFiles, onDragFiles }: TopicViewProps) {
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
      {/* No box of its own: it only makes the topic under the viewer inert, out of the Tab order and the pointer's reach. */}
      <div inert={viewer != null} {...stylex.props(styles.content)}>
        <div data-topic-middle="" {...stylex.props(styles.middle)}>
          {header}
          {children}
          {pill !== undefined ? <div {...stylex.props(styles.pill)}>{pill}</div> : null}
          {floating}
        </div>
        {composer}
      </div>
      {viewer}
    </div>
  )
}

const styles = stylex.create({
  // Fills whatever holds it (the workspace page, a gallery frame) and
  // keeps its own height to that, so the list scrolls instead of growing.
  // Positioned and isolated, so the viewer covers this topic and stays under the Juno panel when that covers the page.
  root: {
    position: 'relative',
    isolation: 'isolate',
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors['--background'],
  },
  content: {
    display: 'contents',
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
