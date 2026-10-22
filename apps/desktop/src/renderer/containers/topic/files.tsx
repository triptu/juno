import { Suspense, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { ContextMenuItem, FileView } from '@juno/contract'
import { copyImage, currentPlace, downloadFile, onMenuCommand, openFile, openViewerAtom, popupContextMenu, quickLookFile, readFileText, registry, tabsAtom, tabShowing, topicView, uploadProgressAtom, type MessageWindow } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { viewableOf, type MediaViewing } from '@juno/views'
import { chunk } from '../chunks'
import { afterNavigation, openTopic } from '../navigation'
import { messageLinkInfo, openMessageLink } from '../slackLinks'

const viewer = chunk(() => import('../MediaViewerPanel'))
const MediaViewerPanel = viewer.component((module) => module.default)

/** Fetch the viewer's chunk once a topic has painted, so the first open does not wait for it. */
let viewerLoaded = false
function preloadViewer(): void {
  if (viewerLoaded) return
  viewerLoaded = true
  window.requestIdleCallback(() => void viewer.load())
}

/**
 * Esc while a PDF or HTML file's frame in the viewer has focus: the frame
 * keeps its keys from the page, so main reports the key (`frame.escape`)
 * and the viewer gets it as if it had been pressed on the frame. Once for
 * the app, whatever the number of topics.
 */
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

/** Download on a file row or in the viewer: main saves it into ~/Downloads and shows it in Finder. */
export function downloadMessageFile(file: FileView): void {
  if (file.download !== undefined) void downloadFile({ url: file.download, name: file.name })
}

/** Quick Look on a card or in the viewer: main saves the file into a temporary folder and shows it in the macOS preview window. */
export function quickLookMessageFile(file: FileView): void {
  if (file.download !== undefined) void quickLookFile({ url: file.download, name: file.name })
}

/** Open a temporary copy in the system's default app. */
function openMessageFile(file: FileView): void {
  if (file.download !== undefined) void openFile({ url: file.download, name: file.name })
}

/** Copy image in the viewer: the full image when there is one, else the picture shown. */
function copyMessageImage(file: FileView): void {
  const src = file.full ?? file.thumb?.src
  if (src !== undefined) void copyImage(src)
}

const pointOf = (event: MouseEvent<Element>) => ({ x: event.clientX, y: event.clientY })

const showViewerImageMenu = (file: FileView, event: MouseEvent<Element>) => {
  event.preventDefault()
  void showImageMenu(file, pointOf(event))
}

/** The viewer open in `view`, at the item it shows. */
function TopicViewer({ view, opener }: { readonly view: string; readonly opener: Element | null }) {
  const open = useAtomValue(openViewerAtom(view))
  if (open === undefined) return null
  const { now, ...viewing } = open
  return (
    <Suspense fallback={null}>
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
    </Suspense>
  )
}

/**
 * A topic's files: those dragged over it, the uploads in progress, and the
 * message's media open in the viewer. The open viewer is kept per topic
 * view (`openViewerAtom`), so the tab shows it again when its topic mounts
 * again.
 */
function openTopicViewer(id: string, viewing: MediaViewing): void {
  openTopic(id)
  afterNavigation(() => {
    const tab = tabShowing(registry.get(tabsAtom), id)
    if (tab === undefined) return
    const place = currentPlace(tab)
    registry.set(openViewerAtom(topicView(place.kind === 'topic' ? place.viewId ?? id : id, tab.id)), { ...viewing, now: Date.now() })
  })
}

export function openPreviewImage(topic: string, viewing: MediaViewing): void {
  openTopicViewer(topic, viewing)
}

export function showMessageImageMenu(list: MessageWindow, ts: string, fileId: string, event: MouseEvent<Element>, onOpen: (viewing: MediaViewing) => void): void {
  const message = list.rows.get(ts)
  if (message === undefined) return
  const items = viewableOf(message.files)
  const index = items.findIndex((file) => file.id === fileId)
  if (index < 0) return
  const viewing = { items, index, sender: list.refs.people.get(message.senderId ?? '')?.name ?? message.senderId ?? 'Unknown', at: message.at }
  void showImageMenu(items[index]!, pointOf(event), () => onOpen(viewing))
}

export async function showImageMenu(file: FileView, at: { readonly x: number; readonly y: number }, onOpen?: () => void): Promise<void> {
  const src = file.full ?? file.thumb?.src
  const canUseFile = file.download !== undefined
  const items = [
    ...(onOpen === undefined ? [] : [{ id: 'open', label: 'Open' }]),
    { id: 'open-in-preview', label: 'Open in Preview', enabled: canUseFile },
    { separator: true },
    { id: 'copy-image', label: 'Copy image', enabled: src !== undefined },
    { id: 'download', label: 'Download', enabled: canUseFile },
  ] satisfies ReadonlyArray<ContextMenuItem>
  const chosen = await popupContextMenu(items, at)
  if (chosen === 'open') onOpen?.()
  else if (chosen === 'open-in-preview') openMessageFile(file)
  else if (chosen === 'copy-image') copyMessageImage(file)
  else if (chosen === 'download') downloadMessageFile(file)
}

export function useTopicFiles(view: string) {
  const [dropping, setDropping] = useState(false)
  // What had focus at the open, taken before the topic turns inert under the viewer; on a cold load its chunk mounts later.
  const [opener, setOpener] = useState<Element | null>(null)
  // The view now: a new thread's id changes once Slack acknowledges it, without a remount.
  const current = useRef(view)
  useEffect(() => {
    current.current = view
  }, [view])
  // Created once, like every row callback; the time in the viewer's header is reckoned from the moment it opened.
  const [setViewing] = useState(() => (next: MediaViewing) => {
    setOpener(document.activeElement)
    registry.set(openViewerAtom(current.current), { ...next, now: Date.now() })
  })
  const open = useAtomValue(openViewerAtom(view), (viewer) => viewer !== undefined)
  const progress = useAtomValue(uploadProgressAtom)
  useEffect(preloadViewer, [])
  useEffect(listenFrameEscape, [])
  const uploadProgress = progress._tag === 'Success' && Object.keys(progress.value).length > 0 ? progress.value : undefined
  const viewer = open ? <TopicViewer view={view} opener={opener} /> : null
  return { dropping, setDropping, setViewing, uploadProgress, viewer }
}
