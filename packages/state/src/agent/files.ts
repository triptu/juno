/**
 * What Juno's files need from the agent (SPEC 13.1): whether the chat
 * model reads images, and the thumbnails on the owner's bubbles.
 */
import { Effect } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import type { ChatReads } from '@juno/agent-contract'
import { live, sentThumbs } from './chat'
import { AgentClient } from './client'
import { agentProviderAtom } from './provider'

const IDLE_TTL = '30 seconds'

/**
 * Whether the chat model reads images (`agent.chat.reads`). Until the agent
 * says, yes: the composer then keeps nothing back, and a model without
 * image input gets pi-ai's placeholder in place of the image.
 */
const chatReadsAtom = AgentClient.runtime.atom(live<typeof ChatReads.Type, never>('agent.chat.reads', undefined)).pipe(Atom.keepAlive)

export const junoReadsImagesAtom = Atom.make((get): boolean => {
  if (get(agentProviderAtom)?.active == null) return true
  const reads = get(chatReadsAtom)
  return AsyncResult.isSuccess(reads) ? reads.value.images : true
})

/**
 * An owner bubble's image thumbnail, as a data URL: the one sent from here,
 * or the agent's (`agent.chat.image`). Null once the message was removed.
 */
export const junoThumbAtom = Atom.family((key: string) =>
  AgentClient.runtime
    .atom(
      Effect.suspend(() => {
        const local = sentThumbs.get(key)
        if (local !== undefined) return Effect.succeed<string | null>(local)
        const at = key.lastIndexOf(':')
        return AgentClient.use((client) => client('agent.chat.image' as never, { opId: key.slice(0, at), n: Number(key.slice(at + 1)) } as never) as unknown as Effect.Effect<string | null>)
      }),
    )
    .pipe(Atom.setIdleTTL(IDLE_TTL)),
)
