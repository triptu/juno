/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron'
import { Channels, Events, PORT_HANDOFF_TAG, type ContextMenuLeaf, type JunoBridge, type MenuCommand } from '@juno/contract/channels'

/** A menu item copied field by field, so nothing else the page put on it crosses to main. */
function leaf(item: ContextMenuLeaf): ContextMenuLeaf {
  if ('separator' in item) return { separator: true }
  return {
    id: item.id,
    label: item.label,
    ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
    ...(item.checked === undefined ? {} : { checked: item.checked }),
    ...(item.accelerator === undefined ? {} : { accelerator: item.accelerator }),
  }
}

// The whole bridge. Add one function per shell route; never expose
// ipcRenderer or Node APIs. The renderer validates every answer.
const bridge: JunoBridge = {
  app: {
    getInfo: () => ipcRenderer.invoke(Channels.appGetInfo),
  },
  engine: {
    requestPort: () => ipcRenderer.invoke(Channels.engineRequestPort),
    restart: () => ipcRenderer.invoke(Channels.engineRestart),
  },
  launch: {
    setTheme: (theme) => ipcRenderer.invoke(Channels.launchSetTheme, { theme }),
    setAccent: (accent) => ipcRenderer.invoke(Channels.launchSetAccent, { accent }),
    setDensity: (density) => ipcRenderer.invoke(Channels.launchSetDensity, { density }),
    setSidebar: ({ width, collapsed }) => ipcRenderer.invoke(Channels.launchSetSidebar, { width, collapsed }),
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
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(Channels.clipboardWriteText, { text }),
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
  },
}

contextBridge.exposeInMainWorld('juno', bridge)

// Main sends the engine port here; the page cannot receive it any other way.
// Forward it as a window message; the page checks event.source and the tag.
ipcRenderer.on(Events.enginePort, (event) => {
  window.postMessage({ _tag: PORT_HANDOFF_TAG }, '*', event.ports)
})
