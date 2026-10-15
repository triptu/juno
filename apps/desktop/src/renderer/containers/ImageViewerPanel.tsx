/**
 * The image viewer. Loaded on its own (`lazy` in `TopicView.tsx`), so it is
 * not in the first bundle; the chunk is fetched when a topic has painted,
 * before the first open.
 */
import { ImageViewer, type ImageViewerProps } from '@juno/views'

export default function ImageViewerPanel(props: ImageViewerProps) {
  return <ImageViewer {...props} />
}
