import { use } from 'react'
import type { Reaction } from '@juno/agent-contract'
import { cachedEmojiImages, workspaceEmojiReady } from '@juno/state/emoji'
import { ReactionBadge } from '@juno/views'

/** No subscription: the picker preload owns the shared workspace answer. */
export default function WorkspaceReactionBadge({ reactions, corner }: { readonly reactions: ReadonlyArray<Reaction>; readonly corner: 'start' | 'end' }) {
  use(workspaceEmojiReady)
  return <ReactionBadge reactions={reactions} corner={corner} images={cachedEmojiImages(reactions.map((reaction) => reaction.emoji))} />
}
