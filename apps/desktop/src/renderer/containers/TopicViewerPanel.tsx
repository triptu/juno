import { useEffect, type MouseEvent } from 'react'
import { onMenuCommand, openViewerAtom, readFileText, registry } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import MediaViewerPanel from './MediaViewerPanel'
import { copyMessageImage, downloadMessageFile, openMessageFile, quickLookMessageFile, showImageMenu } from './topic/files'
import { messageLinkInfo, openMessageLink } from './slackLinks'

let frameEscape = false

function listenFrameEscape(): void {
  if (frameEscape) return
  frameEscape = true
  onMenuCommand((command) => {
    const frame = document.activeElement
    if (command !== 'frame.escape' || !(frame instanceof HTMLIFrameElement) || frame.closest('[data-media-viewer]') === null) return
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
}

const showViewerImageMenu = (file: Parameters<typeof showImageMenu>[0], event: MouseEvent<Element>) => {
  void showImageMenu(file, { x: event.clientX, y: event.clientY })
}

/** The lazy viewer container: its state and file actions stay out of the first renderer bundle. */
export default function TopicViewerPanel({ view, opener }: { readonly view: string; readonly opener: Element | null }) {
  useEffect(listenFrameEscape, [])
  const open = useAtomValue(openViewerAtom(view))
  if (open === undefined) return null
  const { now, ...viewing } = open
  return (
    <MediaViewerPanel
      viewing={viewing}
      now={now}
      opener={opener}
      onClose={() => registry.set(openViewerAtom(view), undefined)}
      onShowItem={(index) => registry.set(openViewerAtom(view), { ...open, index })}
      onDownload={downloadMessageFile}
      onQuickLook={quickLookMessageFile}
      onOpenInBrowser={openMessageFile}
      onCopyImage={copyMessageImage}
      onImageMenu={showViewerImageMenu}
      loadText={readFileText}
      onLink={openMessageLink}
      linkInfo={messageLinkInfo}
    />
  )
}
