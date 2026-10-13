import type { MessageBody } from '@juno/richtext'

/** The facts needed to place a sender header, independent of a wire message. */
export interface GroupMessage {
  readonly senderId: string | null
  readonly body: MessageBody
  readonly isThreadRoot: boolean
  readonly startsAfterDivider?: boolean
}

/** Quotes, roots and the unread divider break consecutive messages from one sender. */
export function startsGroup(prev: GroupMessage | undefined, next: GroupMessage): boolean {
  return prev === undefined || prev.senderId !== next.senderId || next.isThreadRoot || next.startsAfterDivider === true || next.body.blocks.some((block) => block.kind === 'quote')
}

export function threadLinkLabel(replyCount: number): string {
  return replyCount <= 0 ? 'Thread' : replyCount === 1 ? '1 reply' : `${replyCount} replies`
}

/** Takes the channel's display label, including # for channels. */
export function mainLabel(channelLabel: string): string {
  return `${channelLabel} · Main`
}
