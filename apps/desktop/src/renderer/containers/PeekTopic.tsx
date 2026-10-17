import { useLayoutEffect } from 'react'
import { topicAtom } from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { PeekView, TopicArt, type PeekPlacement } from '@juno/views'
import { hasArt, TopicPreview } from './TopicView'

/**
 * One peeked topic: its title over `TopicPreview`, the topic's list
 * read-only (newest messages, no divider, no actions, nothing marked
 * read). `Peek` shows it only once the topic can paint, so its first frame
 * has the messages.
 */
export function PeekTopic({ id, at, placement }: { readonly id: string; readonly at: number; readonly placement: PeekPlacement }) {
  const result = useAtomValue(topicAtom(id))
  const detail = result._tag === 'Success' ? result.value : undefined
  const shown = detail != null
  // `juno.peek-open`: from the key or the pointer to the first frame with the topic's messages.
  useLayoutEffect(() => {
    if (shown) afterPaint(() => measure('juno.peek-open', at, { detail: { id } }))
  }, [shown, at, id])
  if (detail == null) return null
  const main = detail.kind === 'main'
  return (
    <PeekView
      title={main ? detail.channel.label : detail.title}
      {...(main ? {} : { where: detail.channel.label })}
      {...(hasArt(detail) ? { art: <TopicArt topicId={detail.id} recipe={detail.art} size={20} /> } : {})}
      placement={placement}
    >
      <TopicPreview id={id} peek />
    </PeekView>
  )
}

