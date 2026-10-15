/**
 * The backup's keychain over the agent's parent port (WP21): each `get` or
 * `set` is a `secret` request to main, answered by a `secretReply`. Main
 * keeps the values in the login keychain; this process holds them only
 * while it uses them.
 */
import type { SecretRequest } from '@juno/agent-contract'
import type { BackupKeychain } from './backup'

export interface SecretReply {
  readonly requestId: number
  readonly ok: boolean
  readonly value?: string | null
}

/** Main did not store or read a secret. No detail crosses the port. */
export class KeychainUnavailable extends Error {
  constructor() {
    super('The keychain did not answer.')
    this.name = 'KeychainUnavailable'
  }
}

export function keychainBridge(send: (requestId: number, request: SecretRequest) => void) {
  const pending = new Map<number, { resolve: (value: string | null | undefined) => void; reject: (error: Error) => void }>()
  let next = 0
  const ask = (request: SecretRequest) =>
    new Promise<string | null | undefined>((resolve, reject) => {
      const requestId = ++next
      pending.set(requestId, { resolve, reject })
      send(requestId, request)
    })
  const keychain: BackupKeychain = {
    get: async (name) => (await ask({ _tag: 'get', name })) ?? undefined,
    set: async (name, value) => {
      await ask({ _tag: 'set', name, value })
    },
  }
  return {
    keychain,
    answer: (reply: SecretReply) => {
      const waiting = pending.get(reply.requestId)
      if (!waiting) return
      pending.delete(reply.requestId)
      if (reply.ok) waiting.resolve(reply.value)
      else waiting.reject(new KeychainUnavailable())
    },
  }
}
