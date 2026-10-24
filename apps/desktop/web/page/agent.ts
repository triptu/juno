import { AGENT_PORT_HANDOFF_TAG } from '@juno/contract/channels'
import { AGENT_SOCKET_PATH } from '../shell'

/** Carry the existing worker protocol over a socket; the renderer keeps its normal port client. */
export function requestAgentPort(): Promise<'sent' | 'failed'> {
  return new Promise((resolve) => {
    const socket = new WebSocket(new URL(AGENT_SOCKET_PATH, location.href).href.replace(/^http/, 'ws'))
    const channel = new MessageChannel()
    channel.port1.onmessage = ({ data }) => socket.send(JSON.stringify(data))
    socket.onmessage = ({ data }: MessageEvent<string>) => channel.port1.postMessage(JSON.parse(data))
    const closed = () => {
      // DOM ports do not report their peer closing as Electron's MessagePort does.
      channel.port2.dispatchEvent(new Event('close'))
      channel.port1.close()
      resolve('failed')
    }
    socket.onclose = closed
    socket.onerror = closed
    socket.onopen = () => {
      window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin, data: { _tag: AGENT_PORT_HANDOFF_TAG }, ports: [channel.port2] }))
      resolve('sent')
    }
  })
}
