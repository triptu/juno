import { Suspense, useEffect, useState } from 'react'
import type { FileView } from '@juno/contract'
import { copyImage, downloadFile, openFile, openViewerAtom, registry, uploadProgressAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import type { MediaViewing } from '@juno/views'
import { chunk } from '../chunks'

const viewer = chunk(() => import('../MediaViewerPanel'))
const MediaViewerPanel = viewer.component((module) => module.default)

/** Fetch the viewer's chunk once a topic has painted, so the first open does not wait for it. */
let viewerLoaded = false
function preloadViewer(): void {
  if (viewerLoaded) return
  viewerLoaded = true
  window.requestIdleCallback(() => void viewer.load())
}

/** Download on a file row or in the viewer: main saves it into ~/Downloads and shows it in Finder. */
export function downloadMessageFile(file: FileView): void {
  if (file.download !== undefined) void downloadFile({ url: file.download, name: file.name })
}

/** Open in the viewer: main saves the file into a temporary folder and opens it in the default app. */
function openMessageFile(file: FileView): void {
  if (file.download !== undefined) void openFile({ url: file.download, name: file.name })
}

/** Copy image in the viewer: the full image when there is one, else the picture shown. */
function copyMessageImage(file: FileView): void {
  const src = file.full ?? file.thumb?.src
  if (src !== undefined) void copyImage(src)
}

/** The viewer open in `view`, at the item it shows. */
function TopicViewer({ view }: { readonly view: string }) {
  const open = useAtomValue(openViewerAtom(view))
  if (open === undefined) return null
  const { now, ...viewing } = open
  return (
    <Suspense fallback={null}>
      <MediaViewerPanel
        viewing={viewing}
        now={now}
        onClose={() => registry.set(openViewerAtom(view), undefined)}
        onShowItem={(index) => registry.set(openViewerAtom(view), { ...open, index })}
        onDownload={downloadMessageFile}
        onOpenFile={openMessageFile}
        onCopyImage={copyMessageImage}
      />
    </Suspense>
  )
}

/**
 * A topic's files: those dragged over it, the uploads in progress, and the
 * message's media open in the viewer. The open viewer is kept per topic
 * view (`openViewerAtom`), so the tab shows it again when its topic mounts
 * again.
 */
export function useTopicFiles(view: string) {
  const [dropping, setDropping] = useState(false)
  // Created once, like every row callback; the time in the viewer's header is reckoned from the moment it opened.
  const [setViewing] = useState(() => (next: MediaViewing) => registry.set(openViewerAtom(view), { ...next, now: Date.now() }))
  const open = useAtomValue(openViewerAtom(view), (viewer) => viewer !== undefined)
  const progress = useAtomValue(uploadProgressAtom)
  useEffect(preloadViewer, [])
  const uploadProgress = progress._tag === 'Success' && Object.keys(progress.value).length > 0 ? progress.value : undefined
  const viewer = open ? <TopicViewer view={view} /> : null
  return { dropping, setDropping, setViewing, uploadProgress, viewer }
}
