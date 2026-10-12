import { contextBridge, ipcRenderer } from 'electron'
import { Channels, type JunoBridge } from '@juno/contract/channels'

// The whole bridge. Add one function per contract route; never expose
// ipcRenderer or Node APIs. The renderer validates every answer.
const bridge: JunoBridge = {
  app: {
    getInfo: () => ipcRenderer.invoke(Channels.appGetInfo),
  },
}

contextBridge.exposeInMainWorld('juno', bridge)
