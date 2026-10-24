import { useLayoutEffect, useState } from 'react'
import type { TopicDetail } from '@juno/contract'
import { currentPlace, messageListAtom, openViewerAtom, registry, tabsAtom, tabShowing, topicAtom, topicView } from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { PeekView, TopicArt, type MediaViewing, type PeekPlacement } from '@juno/views'
import { hasArt, Topic } from './TopicView'
import { afterNavigation, openTopic } from './navigation'

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
  // A thread shown with replies above it the store cannot prove: they come in above its rows, at its full height.
  const [full] = useState(() => registry.get(messageListAtom(id)).meta.gapBefore === true)
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
      full={full}
    >
      <TopicPreview id={id} detail={detail} />
    </PeekView>
  )
}

function TopicPreview({ id, detail }: { readonly id: string; readonly detail: TopicDetail }) {
  return <Topic key={id} id={id} view={id} detail={detail} readOnly peek onOpenPreviewMedia={(viewing) => openTopicViewer(id, viewing)} />
}

function openTopicViewer(id: string, viewing: MediaViewing): void {
  openTopic(id)
  afterNavigation(() => {
    const tab = tabShowing(registry.get(tabsAtom), id)
    if (tab === undefined) return
    const place = currentPlace(tab)
    registry.set(openViewerAtom(topicView(place.kind === 'topic' ? place.viewId ?? id : id, tab.id)), { ...viewing, now: Date.now() })
  })
}

