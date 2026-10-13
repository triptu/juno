/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron'
import { Channels, Events, PORT_HANDOFF_TAG, type JunoBridge, type MenuCommand } from '@juno/contract/channels'

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
  },
  contextMenu: {
    popup: (items) => ipcRenderer.invoke(Channels.contextMenuPopup, { items: items.map(({ id, label }) => ({ id, label })) }),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(Channels.shellOpenExternal, { url }),
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
}

contextBridge.exposeInMainWorld('juno', bridge)

// Main sends the engine port here; the page cannot receive it any other way.
// Forward it as a window message; the page checks event.source and the tag.
ipcRenderer.on(Events.enginePort, (event) => {
  window.postMessage({ _tag: PORT_HANDOFF_TAG }, '*', event.ports)
})
