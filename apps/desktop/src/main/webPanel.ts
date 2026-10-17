/**
 * The web panel: a link from a message shown inside the app window, in the
 * Juno panel's slot (brief: web panel). One `WebContentsView` per app window,
 * drawn above the app page, on its own `persist:web` session so a sign-in
 * sticks and never touches the Slack cookie. The renderer owns where it sits
 * and whether it shows; main owns the page and keeps it inside its guards:
 * navigation stays on sites the panel may show, popups, downloads and other
 * links go to the browser, and every permission is denied.
 */
import { clipboard, WebContentsView, type BrowserWindow, type ContextMenuParams, type Session, type WebContents } from 'electron'
import { Events, webPanelCanShow, type ContextMenuItem, type WebPanelBounds, type WebPanelState } from '@juno/contract'
import { openInBrowser } from './browser'
import { popupContextMenu } from './contextMenu'

export const WEB_PARTITION = 'persist:web'

interface Panel {
  readonly view: WebContentsView
  /** Where the renderer put it, in CSS pixels; applied again when the zoom changes. */
  bounds: WebPanelBounds
  /** The link the renderer asked for last. A redirect changes the page's url but not this. */
  requested: string
  favicon: string | null
}

const panels = new WeakMap<BrowserWindow, Panel>()
/** Windows whose close, reload and zoom events the panel already follows. */
const wired = new WeakSet<BrowserWindow>()

/** Shows `url` in the window's panel, creating it if there is none. The same url again only moves and shows the view. */
export function showWebPanel(window: BrowserWindow, url: string, bounds: WebPanelBounds): void {
  if (!webPanelCanShow(url)) return openInBrowser(url)
  const panel = panels.get(window) ?? create(window)
  const contents = panel.view.webContents
  if (url !== panel.requested && url !== contents.getURL()) {
    panel.requested = url
    panel.favicon = null
    void contents.loadURL(url)
  }
  panel.bounds = bounds
  applyBounds(window, panel)
  panel.view.setVisible(true)
}

export function setWebPanelBounds(window: BrowserWindow, bounds: WebPanelBounds): void {
  const panel = panels.get(window)
  if (panel === undefined) return
  panel.bounds = bounds
  applyBounds(window, panel)
}

/** Keeps the page (another tab's panel, or under the palette) but stops drawing it. */
export function hideWebPanel(window: BrowserWindow): void {
  panels.get(window)?.view.setVisible(false)
}

/** Removes the view and closes its page, so its memory goes back. */
export function closeWebPanel(window: BrowserWindow): void {
  const panel = panels.get(window)
  if (panel === undefined) return
  panels.delete(window)
  if (!window.isDestroyed()) window.contentView.removeChildView(panel.view)
  if (!panel.view.webContents.isDestroyed()) panel.view.webContents.close()
}

/** After View › Zoom: the bounds are CSS pixels of the app page, so they scale with it. */
export function refitWebPanel(window: BrowserWindow): void {
  const panel = panels.get(window)
  if (panel !== undefined) applyBounds(window, panel)
}

/** The e2e hook: what the window's panel shows, or url null without one. */
export function webPanelForTests(window: BrowserWindow | undefined): { url: string | null; visible: boolean } {
  const panel = window === undefined ? undefined : panels.get(window)
  if (panel === undefined) return { url: null, visible: false }
  return { url: panel.view.webContents.getURL(), visible: panel.view.getVisible() }
}

function applyBounds(window: BrowserWindow, panel: Panel): void {
  if (window.isDestroyed()) return
  const zoom = window.webContents.getZoomFactor()
  const { x, y, width, height } = panel.bounds
  panel.view.setBounds({ x: Math.round(x * zoom), y: Math.round(y * zoom), width: Math.round(width * zoom), height: Math.round(height * zoom) })
}

function create(window: BrowserWindow): Panel {
  const view = new WebContentsView({
    webPreferences: { partition: WEB_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  const panel: Panel = { view, bounds: { x: 0, y: 0, width: 0, height: 0 }, requested: '', favicon: null }
  panels.set(window, panel)
  guardSession(view.webContents.session)
  const contents = view.webContents

  // Links inside the page: the panel keeps those it may show, the browser gets the rest. Popups never open.
  contents.on('will-navigate', keepInside)
  contents.on('will-redirect', keepInside)
  contents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url)
    return { action: 'deny' }
  })

  // What the header shows: title, icon and whether the page is still loading.
  const sendState = () => {
    if (window.isDestroyed() || contents.isDestroyed()) return
    const state: WebPanelState = { url: contents.getURL(), title: contents.getTitle(), favicon: panel.favicon, loading: contents.isLoading() }
    window.webContents.send(Events.webPanelState, state)
  }
  contents.on('did-start-loading', sendState)
  contents.on('did-stop-loading', sendState)
  contents.on('page-title-updated', sendState)
  contents.on('page-favicon-updated', (_event, favicons) => {
    panel.favicon = favicons[0] ?? null
    sendState()
  })
  contents.on('did-navigate', () => {
    panel.favicon = null
    sendState()
  })
  contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
    if (isMainFrame) sendState()
  })
  contents.on('context-menu', (_event, params) => void showContextMenu(window, contents, params))

  if (!wired.has(window)) {
    wired.add(window)
    window.on('closed', () => closeWebPanel(window))
    // A reload of the app page loses the renderer's tabs, and the panel with them.
    window.webContents.on('did-navigate', () => closeWebPanel(window))
    window.webContents.on('zoom-changed', () => setImmediate(() => refitWebPanel(window)))
  }
  window.contentView.addChildView(view)
  return panel
}

function keepInside(event: { preventDefault: () => void }, url: string): void {
  if (webPanelCanShow(url)) return
  event.preventDefault()
  openInBrowser(url)
}

/** The `persist:web` session, guarded once: no downloads, no permissions. */
const guarded = new WeakSet<Session>()
function guardSession(webSession: Session): void {
  if (guarded.has(webSession)) return
  guarded.add(webSession)
  webSession.on('will-download', (event, item) => {
    event.preventDefault()
    openInBrowser(item.getURL())
  })
  webSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  webSession.setPermissionCheckHandler(() => false)
}

/** The page's right-click menu: the link under the pointer, the selection, or the text field. Nothing else gets a menu. */
async function showContextMenu(window: BrowserWindow, contents: WebContents, params: ContextMenuParams): Promise<void> {
  const link = params.linkURL
  const selection = params.selectionText.trim() !== ''
  const items: ContextMenuItem[] = []
  if (link !== '') {
    items.push({ id: 'open', label: 'Open link' }, { id: 'open-browser', label: 'Open in browser' }, { id: 'copy-link', label: 'Copy link' })
  }
  if (params.isEditable) {
    if (items.length > 0) items.push({ separator: true })
    items.push(
      { id: 'cut', label: 'Cut', enabled: params.editFlags.canCut, accelerator: 'CommandOrControl+X' },
      { id: 'copy', label: 'Copy', enabled: params.editFlags.canCopy, accelerator: 'CommandOrControl+C' },
      { id: 'paste', label: 'Paste', enabled: params.editFlags.canPaste, accelerator: 'CommandOrControl+V' },
      { id: 'select-all', label: 'Select all', enabled: params.editFlags.canSelectAll, accelerator: 'CommandOrControl+A' },
    )
  } else if (selection) {
    if (items.length > 0) items.push({ separator: true })
    items.push({ id: 'copy', label: 'Copy', accelerator: 'CommandOrControl+C' })
  }
  if (items.length === 0) return
  const chosen = await popupContextMenu(items, window)
  if (chosen === null || contents.isDestroyed()) return
  switch (chosen) {
    case 'open':
      if (webPanelCanShow(link)) void contents.loadURL(link)
      else openInBrowser(link)
      return
    case 'open-browser':
      return openInBrowser(link)
    case 'copy-link':
      return clipboard.writeText(link)
    case 'cut':
      return contents.cut()
    case 'copy':
      return contents.copy()
    case 'paste':
      return contents.paste()
    case 'select-all':
      return contents.selectAll()
  }
}
