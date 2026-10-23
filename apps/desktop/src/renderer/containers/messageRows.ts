import type { MessageRef, MessageView } from '@juno/contract'

export const refOf = (channel: string, message: MessageView): MessageRef => ({
  channelId: channel,
  ts: message.ts,
  ...(message.clientMsgId === undefined ? {} : { clientMsgId: message.clientMsgId }),
})

/** The message can be edited and deleted by the user: their own, shown as a message, and not a failed send (that one has Delete draft). */
export const isOwnEditable = (message: MessageView): boolean => message.fromMe && message.kind === 'message' && message.pending !== 'failed' && message.editText !== undefined

/** Start thread or Open thread is offered: a message in Main that Slack has (the menu's row, and T on a focused message). */
export const opensThread = (topicKind: string, message: MessageView): boolean => topicKind === 'main' && message.pending === undefined

/** The ts a row that was `pending:<clientMsgId>` has now that Slack has the message, if it is in the window. */
export function landedTs(rows: ReadonlyMap<string, MessageView>, pendingTs: string): string | undefined {
  if (!pendingTs.startsWith('pending:')) return undefined
  const clientMsgId = pendingTs.slice('pending:'.length)
  for (const message of rows.values()) if (message.clientMsgId === clientMsgId && message.pending === undefined) return message.ts
  return undefined
}

