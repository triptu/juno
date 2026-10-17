import { useState } from 'react'
import { mainTopicOf, type TopicDetail } from '@juno/contract'
import { channelTopicsAtom, nowAtom, topicAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { TopicSwitcher as TopicSwitcherView } from '@juno/views'
import { openTopic } from '../navigation'

/**
 * The title's topic switcher (SPEC 7): the channel's Main and threads, from
 * local queries the topic keeps live while shown, so it opens with its rows
 * in the first frame. Mounted only while open; the query text is its own.
 */
export default function Switcher({ detail, onClose }: { readonly detail: TopicDetail; readonly onClose: () => void }) {
  const channel = detail.channel.id
  const mainId = mainTopicOf(channel)
  const result = useAtomValue(channelTopicsAtom(channel))
  const mainUnread = useAtomValue(topicAtom(mainId), (header) => (header._tag === 'Success' ? (header.value?.unreadCount ?? 0) : 0))
  const mainArt = useAtomValue(topicAtom(mainId), (header) => (header._tag === 'Success' ? header.value?.art : undefined))
  const now = useAtomValue(nowAtom)
  const [query, setQuery] = useState('')
  const window = result._tag === 'Success' ? result.value : undefined
  const threads = window === undefined ? undefined : window.order.map((id) => window.rows.get(id)!)
  const open = (id: string, event: { readonly metaKey: boolean }) => {
    onClose()
    if (id !== detail.id || event.metaKey) openTopic(id, { newTab: event.metaKey })
  }
  return (
    <TopicSwitcherView mainId={mainId} mainUnread={mainUnread} {...(mainArt === undefined ? {} : { mainArt })} currentId={detail.id} threads={threads} now={now} query={query} onQuery={setQuery} onOpen={open} />
  )
}

