/** The huddle control of a topic's header (SPEC 20), a lazy chunk loaded on idle. */
import type { TopicDetail } from '@juno/contract'
import { HuddleHeaderButton } from '@juno/huddle-views'
import { huddleCallValueAtom, huddleInChannelAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { openHuddle } from '../navigation'
import { placeLabelOf, useHuddleChannel, useHuddlePeople, useSelfId } from './look'
import { joinHuddle } from './media'

/**
 * Start, Join, Switch or In huddle, first in the header's right island. A
 * DM shows it on every topic. A channel shows it only while a huddle runs
 * there; Start huddle is in its topic and channel menus.
 */
export default function HuddleHeaderAction({ detail }: { readonly detail: TopicDetail }) {
  const channelId = detail.channel.id
  const call = useAtomValue(huddleCallValueAtom)
  const running = useAtomValue(huddleInChannelAtom(channelId))
  const current = useHuddleChannel(call?.phase === 'idle' || call?.phase === 'leaving' ? null : call?.channelId ?? null)
  const selfId = useSelfId()
  const people = useHuddlePeople(running?.participants ?? [], selfId, undefined, false)
  const inCall = call !== undefined && (call.phase === 'joining' || call.phase === 'joined')
  const mode = inCall && call.channelId === channelId ? 'joined' : running === undefined ? 'start' : inCall ? 'switch' : 'join'
  if (mode === 'start' && (detail.channel.kind === 'public' || detail.channel.kind === 'private')) return null
  return (
    <HuddleHeaderButton
      mode={mode}
      people={people.filter((person) => person.you !== true)}
      {...(mode === 'switch' ? { current: placeLabelOf(current) } : {})}
      place={detail.channel.label}
      onClick={() => {
        if (mode === 'joined') openHuddle(channelId)
        else void joinHuddle(channelId)
      }}
    />
  )
}
