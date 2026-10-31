import { Suspense, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { ContextMenuItem, FileView } from '@juno/contract'
import { copyImage, downloadFile, openFile, openViewerAtom, popupContextMenu, quickLookFile, registry, uploadProgressAtom, type MessageWindow } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { viewingOf, type MediaViewing } from '@juno/views'
import { chunk } from '../chunks'
import { readingOnly } from '../readingOnly'

const viewer = chunk(() => import('../TopicViewerPanel'))
const TopicViewerPanel = viewer.component((module) => module.default)

/** Fetch topic-only chunks once a topic has painted, so the first open does not wait for them. */
let viewerLoaded = false
function preloadViewer(): void {
  if (viewerLoaded) return
  viewerLoaded = true
  window.requestIdleCallback(() => {
    void viewer.load()
    void import('../linkMenu')
  })
}

/** Download on a file row or in the viewer: main saves it into ~/Downloads and shows it in Finder. */
export function downloadMessageFile(file: FileView): void {
  useDownloadedFile(file, downloadFile)
}

/** Quick Look on a card or in the viewer: main saves the file into a temporary folder and shows it in the macOS preview window. */
export function quickLookMessageFile(file: FileView): void {
  useDownloadedFile(file, quickLookFile)
}

/** Open a temporary copy in the system's default app. */
export function openMessageFile(file: FileView): void {
  useDownloadedFile(file, openFile)
}

function useDownloadedFile(file: FileView, action: (file: { readonly url: string; readonly name: string }) => unknown): void {
  if (file.download !== undefined) void action({ url: file.download, name: file.name })
}

/** Copy image in the viewer: the full image when there is one, else the picture shown. */
export function copyMessageImage(file: FileView): void {
  const src = imageSource(file)
  if (src !== undefined) void copyImage(src)
}

const imageSource = (file: FileView) => file.full ?? file.thumb?.src

/**
 * A topic's files: those dragged over it, the uploads in progress, and the
 * message's media open in the viewer. The open viewer is kept per topic
 * view (`openViewerAtom`), so the tab shows it again when its topic mounts
 * again.
 */
export function showMessageImageMenu(list: MessageWindow, ts: string, fileId: string, event: MouseEvent<Element>, onOpen: (viewing: MediaViewing) => void): void {
  const message = list.rows.get(ts)
  if (message === undefined) return
  const viewing = viewingOf(message.files, fileId, list.refs.people.get(message.senderId ?? '')?.name ?? message.senderId ?? 'Unknown', message.at)
  if (viewing === undefined) return
  void showImageMenu(viewing.items[viewing.index]!, { x: event.clientX, y: event.clientY }, () => onOpen(viewing))
}

export async function showImageMenu(file: FileView, at: { readonly x: number; readonly y: number }, onOpen?: () => void): Promise<void> {
  const src = imageSource(file)
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
  // Reading only, nothing opens the viewer or a link's menu.
  useEffect(() => {
    if (!readingOnly()) preloadViewer()
  }, [])
  const uploadProgress = progress._tag === 'Success' && Object.keys(progress.value).length > 0 ? progress.value : undefined
  const viewer = open ? <Suspense fallback={null}><TopicViewerPanel view={view} opener={opener} /></Suspense> : null
  return { dropping, setDropping, setViewing, uploadProgress, viewer }
}
