/**
 * The incoming huddle's card at the top of the sidebar, and its ring (SPEC
 * 20, "Incoming huddles"), a lazy chunk: the slot in `slots.tsx` loads it
 * once the engine lists a huddle. One card shows, the newest; the next shows
 * when it goes.
 */
import { useEffect } from 'react'
import type { IncomingHuddle } from '@juno/contract'
import { IncomingHuddleCard } from '@juno/huddle-views'
import { dismissHuddle, huddleCallValueAtom, registry } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { openHuddle } from '../navigation'
import { placeLabelOf, placeOf, useHuddleChannel, useHuddlePeople, useSelfId } from './look'
import { joinHuddle } from './media'
import { ringUntil } from './ring'

export default function IncomingHuddleContainer({ incoming }: { readonly incoming: ReadonlyArray<IncomingHuddle> }) {
  // The ring lasts while any listed huddle still rings; the engine clears `ringUntil` on a join, and drops what ended or was dismissed.
  const until = incoming.reduce<number | null>((latest, entry) => (entry.ringUntil === null || (latest !== null && latest >= entry.ringUntil) ? latest : entry.ringUntil), null)
  useEffect(() => ringUntil(until), [until])
  useEffect(() => () => ringUntil(null), [])
  const newest = incoming[0]
  return newest === undefined ? null : <Card key={newest.callId} huddle={newest} />
}

function Card({ huddle }: { readonly huddle: IncomingHuddle }) {
  const call = useAtomValue(huddleCallValueAtom)
  const inCall = call !== undefined && (call.phase === 'joining' || call.phase === 'joined')
  const detail = useHuddleChannel(huddle.channelId)
  const current = useHuddleChannel(inCall ? call.channelId : null)
  const selfId = useSelfId()
  const people = useHuddlePeople(huddle.participants, selfId, undefined, false)
  const starter = people.find((person) => person.id === huddle.startedBy)?.name ?? 'Someone'
  return (
    <IncomingHuddleCard
      place={placeOf(detail)}
      starter={starter.split(' ')[0] || starter}
      people={people}
      {...(inCall ? { current: placeLabelOf(current) } : {})}
      pulse={huddle.alert === 'ring'}
      onOpen={(event) => openHuddle(huddle.channelId, { newTab: event.metaKey })}
      onJoin={() => void joinHuddle(huddle.channelId)}
      onDismiss={() => void dismissHuddle(registry, huddle.callId)}
    />
  )
}
