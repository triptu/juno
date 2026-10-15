import type { McpOAuthState } from '@earendil-works/pi-mcp/oauth'
import type { CredentialRequest } from '@juno/agent-contract'
import type { Credentials } from './types'

export interface CredentialReply {
  readonly requestId: number
  readonly ok: boolean
  readonly value?: string | null
}

/**
 * `Credentials` over main's keychain bridge (`apps/desktop/src/main/mcpCredentials.ts`).
 * `send` posts one request to main; main answers each through `answer`. The
 * states this process loaded or saved are the held secrets the argument
 * filter checks; a connection's tokens are loaded before it is used.
 */
export function credentialBridge(send: (requestId: number, request: CredentialRequest) => void) {
  const pending = new Map<number, { resolve: (value: string | null | undefined) => void; reject: (error: Error) => void }>()
  const held = new Map<string, McpOAuthState>()
  let next = 0
  const ask = (request: CredentialRequest) =>
    new Promise<string | null | undefined>((resolve, reject) => {
      const requestId = ++next
      pending.set(requestId, { resolve, reject })
      send(requestId, request)
    })
  const credentials: Credentials = {
    oauth: (id) => ({
      load: async () => {
        const raw = await ask({ _tag: 'load', id })
        if (typeof raw !== 'string') return undefined
        const state = JSON.parse(raw) as McpOAuthState
        held.set(id, state)
        return state
      },
      save: async (state) => {
        held.set(id, state)
        await ask({ _tag: 'save', id, state: JSON.stringify(state) })
      },
    }),
    // No connection uses a bearer secret yet; the Connections page offers OAuth or none.
    bearer: async () => undefined,
    values: async () => [...held.values()].flatMap(secretsOf),
    clear: async (id) => {
      held.delete(id)
      await ask({ _tag: 'clear', id })
    },
    openAuthorization: async (url) => {
      await ask({ _tag: 'open', url })
    },
  }
  return {
    credentials,
    answer: (reply: CredentialReply) => {
      const waiting = pending.get(reply.requestId)
      if (!waiting) return
      pending.delete(reply.requestId)
      if (reply.ok) waiting.resolve(reply.value)
      else waiting.reject(new Error('The keychain did not answer.'))
    },
  }
}

function secretsOf(state: McpOAuthState): ReadonlyArray<string> {
  const client = state.clientInformation as { readonly client_secret?: unknown } | undefined
  return [state.tokens?.access_token, state.tokens?.refresh_token, typeof client?.client_secret === 'string' ? client.client_secret : undefined, state.codeVerifier]
    .filter((value): value is string => typeof value === 'string' && value.length >= 8)
}
