import { Exit } from 'effect'
import { type MessageMenu, type ReplyTarget, type ChatMessageId } from '@juno/agent-contract'
import type { Registry } from '../client'
import { showToast } from '../undo'
import { call } from './chat'
import { uuidv7 } from './ids'

export function messageActions(registry: Registry) {
  const command = async (tag: string, payload: unknown) => {
    const result = await call(registry, tag, payload)
    if (Exit.isSuccess(result)) return true
    showToast(registry, { text: 'That did not work. Try again.' })
    return false
  }
  return {
    menu: async (target: ReplyTarget): Promise<typeof MessageMenu.Type | null> => {
      const result = await call<typeof MessageMenu.Type | null>(registry, 'agent.chat.message', { target })
      return Exit.isSuccess(result) ? result.value : null
    },
    pin: (message: typeof MessageMenu.Type, startByte: number, endByte: number) => command('agent.remembers.pin', { opId: uuidv7(), messageId: message.messageId, revision: message.revision, startByte, endByte }),
    remove: (messageId: ChatMessageId, alsoRemoveReply: boolean) => command('agent.chat.remove', { opId: uuidv7(), messageId, alsoRemoveReply }),
    undo: (id: ChatMessageId) => {
      const [kind, pin, revision] = id.split(':')
      if (kind === 'pin' && pin !== undefined && revision !== undefined) void command('agent.remembers.remove', { opId: uuidv7(), id: pin, revision: Number(revision) })
    },
  }
}
