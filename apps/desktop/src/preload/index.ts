/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron'
import { AGENT_PORT_HANDOFF_TAG, Channels, Events, PORT_HANDOFF_TAG, type ContextMenuLeaf, type JunoBridge, type MenuCommand } from '@juno/contract/channels'

/** A menu item copied field by field, so nothing else the page put on it crosses to main. */
function leaf(item: ContextMenuLeaf): ContextMenuLeaf {
  if ('separator' in item) return { separator: true }
  return {
    id: item.id,
    label: item.label,
    ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
    ...(item.checked === undefined ? {} : { checked: item.checked }),
    ...(item.sublabel === undefined ? {} : { sublabel: item.sublabel }),
    ...(item.accelerator === undefined ? {} : { accelerator: item.accelerator }),
  }
}

/**
 * The engine port, asked for as the page starts rather than once its bundle
 * has run (performance.md 4.1): the page's first request takes it. Main
 * sends the port at once, even before the engine is ready, so it is usually
 * here before the page asks. Later requests (a reconnect) go to main.
 */
let early: { readonly answer: Promise<unknown>; ports?: ReadonlyArray<MessagePort> } | undefined = {
  answer: ipcRenderer.invoke(Channels.engineRequestPort),
}
// The page sees a failure when it asks; until then it is not unhandled.
early.answer.catch(() => {})

const forwardEnginePort = (ports: ReadonlyArray<MessagePort>) => window.postMessage({ _tag: PORT_HANDOFF_TAG }, '*', [...ports])

function requestEnginePort(): Promise<unknown> {
  const held = early
  early = undefined
  if (held === undefined) return ipcRenderer.invoke(Channels.engineRequestPort)
  // The page listens before it asks (`acquirePort` in @juno/state).
  if (held.ports !== undefined) forwardEnginePort(held.ports)
  return held.answer
}

// The whole bridge. Add one function per shell route; never expose
// ipcRenderer or Node APIs. The renderer validates every answer.
const bridge: JunoBridge = {
  updates: {
    get: () => ipcRenderer.invoke(Channels.updatesGet),
    set: (enabled) => ipcRenderer.invoke(Channels.updatesSet, { enabled }),
    restart: () => ipcRenderer.invoke(Channels.updatesRestart),
    download: () => ipcRenderer.invoke(Channels.updatesDownload),
    notes: (scope) => ipcRenderer.invoke(Channels.updatesNotes, { scope }),
    onChange: (listener) => {
      const forward = (_event: unknown, state: unknown) => listener(state)
      ipcRenderer.on(Events.updatesChanged, forward)
      return () => { ipcRenderer.off(Events.updatesChanged, forward) }
    },
  },
  app: {
    getInfo: () => ipcRenderer.invoke(Channels.appGetInfo),
    diagnostics: () => ipcRenderer.invoke(Channels.appDiagnostics),
    logDiagnostics: () => ipcRenderer.invoke(Channels.appLogDiagnostics),
    showLogs: () => ipcRenderer.invoke(Channels.appShowLogs),
    reportState: (state) => ipcRenderer.invoke(Channels.appReportState, state),
  },
  engine: {
    requestPort: requestEnginePort,
    restart: () => ipcRenderer.invoke(Channels.engineRestart),
  },
  agent: {
    requestPort: () => ipcRenderer.invoke(Channels.agentRequestPort),
    setOpenRouterKey: (key) => ipcRenderer.invoke(Channels.agentSetOpenRouterKey, { key }),
    provider: () => ipcRenderer.invoke(Channels.agentProvider),
    setProvider: (change) => ipcRenderer.invoke(Channels.agentSetProvider, change),
    codex: () => ipcRenderer.invoke(Channels.agentCodex),
    codexSignIn: () => ipcRenderer.invoke(Channels.agentCodexSignIn),
    onProvider: (listener) => {
      const forward = (_event: unknown, state: unknown) => listener(state)
      ipcRenderer.on(Events.agentProviderChanged, forward)
      return () => {
        ipcRenderer.off(Events.agentProviderChanged, forward)
      }
    },
    chooseFolder: (purpose) => ipcRenderer.invoke(Channels.agentChooseFolder, { purpose }),
    recoveryPhrase: () => ipcRenderer.invoke(Channels.agentRecoveryPhrase),
    typeRecoveryPhrase: (phrase) => ipcRenderer.invoke(Channels.agentTypeRecoveryPhrase, { phrase }),
  },
  launch: {
    setTheme: (theme) => ipcRenderer.invoke(Channels.launchSetTheme, { theme }),
    setAccent: (accent) => ipcRenderer.invoke(Channels.launchSetAccent, { accent }),
    setDensity: (density) => ipcRenderer.invoke(Channels.launchSetDensity, { density }),
    setPrivacy: (privacy) => ipcRenderer.invoke(Channels.launchSetPrivacy, { privacy }),
    setSidebar: ({ width, collapsed }) => ipcRenderer.invoke(Channels.launchSetSidebar, { width, collapsed }),
    onPrivacy: (listener) => {
      const forward = (_event: unknown, state: unknown) => listener(state)
      ipcRenderer.on(Events.privacyChanged, forward)
      return () => {
        ipcRenderer.off(Events.privacyChanged, forward)
      }
    },
  },
  window: {
    onFullScreen: (listener) => {
      const forward = (_event: unknown, fullScreen: unknown) => listener(fullScreen)
      ipcRenderer.on(Events.windowFullScreen, forward)
      return () => {
        ipcRenderer.off(Events.windowFullScreen, forward)
      }
    },
  },
  sharing: {
    get: () => ipcRenderer.invoke(Channels.sharingGet),
    set: (hide) => ipcRenderer.invoke(Channels.sharingSet, { hide }),
  },
  contextMenu: {
    popup: (items, at) =>
      ipcRenderer.invoke(Channels.contextMenuPopup, {
        items: items.map((item) => ('submenu' in item ? { label: item.label, submenu: item.submenu.map(leaf) } : leaf(item))),
        ...(at === undefined ? {} : { at: { x: at.x, y: at.y } }),
      }),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(Channels.shellOpenExternal, { url }),
    openInSlack: ({ teamId, channelId }) => ipcRenderer.invoke(Channels.shellOpenInSlack, { teamId, channelId }),
    editUndo: () => ipcRenderer.invoke(Channels.shellEditUndo),
    downloadFile: ({ url, name }) => ipcRenderer.invoke(Channels.shellDownloadFile, { url, name }),
    openFile: ({ url, name }) => ipcRenderer.invoke(Channels.shellOpenFile, { url, name }),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(Channels.clipboardWriteText, { text }),
    writeImage: (src) => ipcRenderer.invoke(Channels.clipboardWriteImage, { src }),
  },
  menu: {
    onCommand: (listener) => {
      const forward = (_event: unknown, command: MenuCommand) => listener(command)
      ipcRenderer.on(Events.menuCommand, forward)
      return () => {
        ipcRenderer.off(Events.menuCommand, forward)
      }
    },
  },
  notifications: {
    setViewing: (topicId) => ipcRenderer.invoke(Channels.notificationsViewing, { topicId }),
    onOpen: (listener) => {
      const forward = (_event: unknown, target: unknown) => listener(target)
      ipcRenderer.on(Events.notificationOpen, forward)
      return () => {
        ipcRenderer.off(Events.notificationOpen, forward)
      }
    },
    test: () => ipcRenderer.invoke(Channels.notificationsTest),
    permission: () => ipcRenderer.invoke(Channels.notificationsPermission),
    requestPermission: () => ipcRenderer.invoke(Channels.notificationsRequestPermission),
    openSettings: () => ipcRenderer.invoke(Channels.notificationsOpenSettings),
  },
  webPanel: {
    show: (url, bounds) => ipcRenderer.invoke(Channels.webPanelShow, { url, bounds }),
    setBounds: (bounds) => ipcRenderer.invoke(Channels.webPanelBounds, bounds),
    hide: () => ipcRenderer.invoke(Channels.webPanelHide),
    close: () => ipcRenderer.invoke(Channels.webPanelClose),
    onState: (listener) => {
      const forward = (_event: unknown, state: unknown) => listener(state)
      ipcRenderer.on(Events.webPanelState, forward)
      return () => {
        ipcRenderer.off(Events.webPanelState, forward)
      }
    },
  },
}

contextBridge.exposeInMainWorld('juno', bridge)

// Main sends the engine port here; the page cannot receive it any other way.
// Forward it as a window message; the page checks event.source and the tag.
ipcRenderer.on(Events.enginePort, (event) => {
  // The early port waits for the page to ask; every later one goes straight to the page.
  if (early !== undefined) {
    early.ports = event.ports
    return
  }
  forwardEnginePort(event.ports)
})

// The same for the Juno Agent's port.
ipcRenderer.on(Events.agentPort, (event) => {
  window.postMessage({ _tag: AGENT_PORT_HANDOFF_TAG }, '*', event.ports)
})
