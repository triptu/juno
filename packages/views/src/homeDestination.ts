import type { PickConversation } from '@juno/contract'

const isChannel = (conversation: PickConversation) => conversation.kind === 'public' || conversation.kind === 'private'
/** "#eng" or "Maya Chen": as the chip and the list's footer name it. */
export const destinationLabel = (conversation: PickConversation): string => (isChannel(conversation) ? `#${conversation.name}` : conversation.name)


/** A row's element id in `SendToList`, for `aria-activedescendant`. */
export const sendToRowId = (listId: string, key: string) => `${listId}-${key}`
