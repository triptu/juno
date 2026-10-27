import type { TopicDetail } from '@juno/contract'
import { ReadOnlyNote } from '@juno/views'
import { joinFromPreview } from '../channelMembership'

/**
 * In the composer's place in a channel you are not in (SPEC 7, "Not in the
 * channel"): a public one's preview with Join channel, or a private one you
 * left. Its own chunk: it is rare.
 */
export function NotMemberNote({ detail }: { readonly detail: TopicDetail }) {
  const { label } = detail.channel
  if (detail.notMember === 'left') return <ReadOnlyNote text={`You left ${label}.`} />
  return <ReadOnlyNote text={`You’re not in ${label}.`} action={{ label: 'Join channel', onAction: () => void joinFromPreview(detail.channel) }} />
}
