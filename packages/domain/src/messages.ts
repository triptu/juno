import type { MessageBody } from '@juno/richtext'

/** The facts needed to place a sender header, independent of a wire message. */
export interface GroupMessage {
  readonly senderId: string | null
  readonly body: MessageBody
  readonly isThreadRoot: boolean
  readonly startsAfterDivider?: boolean
  /** A thread reply also sent to the channel: its header says so, so it stands alone. */
  readonly broadcast?: boolean
}

/** Quotes, roots, broadcast replies and the unread divider break consecutive messages from one sender. */
export function startsGroup(prev: GroupMessage | undefined, next: GroupMessage): boolean {
  return (
    prev === undefined ||
    prev.senderId !== next.senderId ||
    next.isThreadRoot ||
    next.startsAfterDivider === true ||
    next.broadcast === true ||
    prev.broadcast === true ||
    next.body.blocks.some((block) => block.kind === 'quote')
  )
}

export function threadLinkLabel(replyCount: number): string {
  return replyCount <= 0 ? 'Thread' : replyCount === 1 ? '1 reply' : `${replyCount} replies`
}
