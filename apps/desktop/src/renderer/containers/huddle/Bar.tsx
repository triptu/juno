/**
 * The huddle bar at the top of the sidebar (SPEC 20), a lazy chunk: the
 * slot in `sidebarTop.tsx` loads it once the user presses Join or Start.
 */
import type { HuddleCall } from '@juno/contract'
import { HuddleBar } from '@juno/huddle-views'
import { openHuddle } from '../navigation'
import { Duration, useHuddleControls } from './controls'
import { connectionOf, placeOf, useHuddleChannel, useHuddlePeople, useHuddleShares, useMediaSnapshot, useSelfId } from './look'

export default function HuddleBarContainer({ call }: { readonly call: HuddleCall }) {
  const media = useMediaSnapshot()
  const detail = useHuddleChannel(call.channelId)
  const selfId = useSelfId()
  const people = useHuddlePeople(call.participants, selfId, media, true)
  const controls = useHuddleControls(media)
  const shares = useHuddleShares(media)
  const channelId = call.channelId
  return (
    <HuddleBar
      {...controls}
      place={placeOf(detail)}
      connection={connectionOf(call, media)}
      duration={<Duration startedAt={call.startedAt} />}
      people={people.filter((person) => person.you !== true)}
      sharers={shares.map((share) => share.ownerName)}
      {...(media?.localShare === undefined ? {} : { sharingSource: media.localShare.name })}
      onOpen={(event) => {
        if (channelId !== null) openHuddle(channelId, { newTab: event.metaKey })
      }}
    />
  )
}
