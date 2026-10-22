/**
 * The media viewer. Loaded on its own (`chunk` in `topic/files.tsx`), so it is
 * not in the first bundle; the chunk is fetched when a topic has painted,
 * before the first open.
 */
import type { ContextMenuItem, FileView } from '@juno/contract'
import { copyImage, currentPlace, downloadFile, openFile, openViewerAtom, popupContextMenu, registry, tabsAtom, tabShowing, topicView, type MessageWindow } from '@juno/state'
import { MediaViewer, viewableOf, type MediaViewerProps, type MediaViewing } from '@juno/views'
import { afterNavigation, openTopic } from './navigation'

function MediaViewerPanel(props: MediaViewerProps) {
  return <MediaViewer {...props} />
}

function openTopicViewer(id: string, viewing: MediaViewing): void {
  openTopic(id)
  afterNavigation(() => {
    const tab = tabShowing(registry.get(tabsAtom), id)
    if (tab === undefined) return
    const place = currentPlace(tab)
    registry.set(openViewerAtom(topicView(place.kind === 'topic' ? place.viewId ?? id : id, tab.id)), { ...viewing, now: Date.now() })
  })
}

function showMessageImageMenu(list: MessageWindow, ts: string, fileId: string, at: { readonly x: number; readonly y: number }, onOpen: (viewing: MediaViewing) => void): void {
  const message = list.rows.get(ts)
  if (message === undefined) return
  const items = viewableOf(message.files)
  const index = items.findIndex((file) => file.id === fileId)
  if (index < 0) return
  const viewing = { items, index, sender: list.refs.people.get(message.senderId ?? '')?.name ?? message.senderId ?? 'Unknown', at: message.at }
  void showImageMenu(items[index]!, at, () => onOpen(viewing))
}

async function showImageMenu(file: FileView, at: { readonly x: number; readonly y: number }, onOpen?: () => void): Promise<void> {
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
  else if (chosen === 'open-in-preview' && file.download !== undefined) void openFile({ url: file.download, name: file.name })
  else if (chosen === 'copy-image' && src !== undefined) void copyImage(src)
  else if (chosen === 'download' && file.download !== undefined) void downloadFile({ url: file.download, name: file.name })
}

export default Object.assign(MediaViewerPanel, { open: openTopicViewer, message: showMessageImageMenu, menu: showImageMenu })
