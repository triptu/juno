/**
 * The media viewer. Loaded on its own (`chunk` in `topic/files.tsx`), so it is
 * not in the first bundle; the chunk is fetched when a topic has painted,
 * before the first open.
 */
import { MediaViewer, type MediaViewerProps } from '@juno/views'

export default function MediaViewerPanel(props: MediaViewerProps) {
  return <MediaViewer {...props} />
}
