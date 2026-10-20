import { Suspense, useEffect, useState } from 'react'
import type { FileView } from '@juno/contract'
import { copyImage, downloadFile, openFile, quickLookFile, readFileText, uploadProgressAtom } from '@juno/state'
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

/** Quick Look on a card or in the viewer: main saves the file into a temporary folder and shows it in the macOS preview window. */
export function quickLookMessageFile(file: FileView): void {
  if (file.download !== undefined) void quickLookFile({ url: file.download, name: file.name })
}

/** Open in browser for an HTML file in the viewer: main saves it into a temporary folder and opens it in the default app. */
function openInBrowser(file: FileView): void {
  if (file.download !== undefined) void openFile({ url: file.download, name: file.name })
}

/** Copy image in the viewer: the full image when there is one, else the picture shown. */
function copyMessageImage(file: FileView): void {
  const src = file.full ?? file.thumb?.src
  if (src !== undefined) void copyImage(src)
}

/** A topic's files: those dragged over it, the uploads in progress, and the message's media open in the viewer. */
export function useTopicFiles() {
  const [dropping, setDropping] = useState(false)
  const [viewing, setOpen] = useState<{ readonly viewing: MediaViewing; readonly now: number } | undefined>(undefined)
  // Created once, like every row callback; the time in the viewer's header is reckoned from the moment it opened.
  const [setViewing] = useState(() => (next: MediaViewing) => setOpen({ viewing: next, now: Date.now() }))
  const progress = useAtomValue(uploadProgressAtom)
  useEffect(preloadViewer, [])
  const uploadProgress = progress._tag === 'Success' && Object.keys(progress.value).length > 0 ? progress.value : undefined
  const viewer =
    viewing === undefined ? null : (
      <Suspense fallback={null}>
        <MediaViewerPanel
          viewing={viewing.viewing}
          now={viewing.now}
          onClose={() => setOpen(undefined)}
          onDownload={downloadMessageFile}
          onQuickLook={quickLookMessageFile}
          onOpenInBrowser={openInBrowser}
          onCopyImage={copyMessageImage}
          loadText={readFileText}
        />
      </Suspense>
    )
  return { dropping, setDropping, setViewing, uploadProgress, viewer }
}
