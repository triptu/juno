import type { ShellInput, ShellOutput, ShellRoutes } from '@juno/contract'
import { SHELL_SOCKET_PATH, type ShellEvent } from '../shell'

const listeners = new Set<(event: ShellEvent) => void>()
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
let next = 0
let socket: WebSocket | undefined
let opened: Promise<void> | undefined

function connection(): Promise<void> {
  if (opened !== undefined) return opened
  socket = new WebSocket(new URL(SHELL_SOCKET_PATH, location.href).href.replace(/^http/, 'ws'))
  const current = socket
  opened = new Promise((resolve, reject) => {
    current.addEventListener('open', () => resolve(), { once: true })
    current.addEventListener('error', () => reject(new Error('The shell host did not connect')), { once: true })
  })
  current.addEventListener('message', ({ data }: MessageEvent<string>) => {
    const reply = JSON.parse(data) as ShellEvent | { id: number; value?: unknown; error?: string }
    if ('event' in reply) {
      for (const listener of listeners) listener(reply)
      return
    }
    const request = pending.get(reply.id)
    pending.delete(reply.id)
    if (reply.error === undefined) request?.resolve(reply.value)
    else request?.reject(new Error(reply.error))
  })
  current.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('The shell host closed'))
    pending.clear()
    socket = undefined
    opened = undefined
  })
  return opened
}

/** The preload's shell routes, validated by the same contract in the host. */
async function request(channel: string, input: unknown): Promise<unknown> {
  await connection()
  const id = ++next
  return new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve: (value) => resolve(value), reject })
    socket!.send(JSON.stringify({ id, channel, input }))
  })
}

export function onHostEvent(listener: (event: ShellEvent) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function hostRequest<C extends keyof ShellRoutes>(channel: C, input: ShellInput<C>): Promise<ShellOutput<C>> {
  return request(channel, input) as Promise<ShellOutput<C>>
}

export async function hostSyncLog(input: unknown): Promise<string> {
  const text = await request('web.syncLog', input)
  if (typeof text !== 'string') throw new Error('The host did not return sync log text')
  return text
}
