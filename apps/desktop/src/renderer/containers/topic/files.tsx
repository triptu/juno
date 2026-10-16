import { Suspense, useEffect, useState } from 'react'
import type { FileView } from '@juno/contract'
import { downloadFile, uploadProgressAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { chunk } from '../chunks'

const viewer = chunk(() => import('../ImageViewerPanel'))
const ImageViewerPanel = viewer.component((module) => module.default)

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

/** A topic's files: those dragged over it, the uploads in progress, and the image open in the viewer. */
export function useTopicFiles() {
  const [dropping, setDropping] = useState(false)
  const [viewing, setViewing] = useState<FileView | undefined>(undefined)
  const progress = useAtomValue(uploadProgressAtom)
  useEffect(preloadViewer, [])
  const uploadProgress = progress._tag === 'Success' && Object.keys(progress.value).length > 0 ? progress.value : undefined
  const viewer =
    viewing === undefined ? null : (
      <Suspense fallback={null}>
        <ImageViewerPanel file={viewing} onClose={() => setViewing(undefined)} onDownload={downloadMessageFile} />
      </Suspense>
    )
  return { dropping, setDropping, setViewing, uploadProgress, viewer }
}
