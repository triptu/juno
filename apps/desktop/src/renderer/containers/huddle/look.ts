/**
 * The huddle containers' shared reads: the place a channel's huddle is in,
 * the huddle's people and others' shared screens as the views draw them.
 */
import { useSyncExternalStore } from 'react'
import type { HuddleCall, Person, TopicDetail } from '@juno/contract'
import type { MediaSnapshot } from '@juno/huddle-media'
import type { HuddleConnection, HuddlePerson, HuddlePlace, HuddleShare } from '@juno/huddle-views'
import { huddleChannelAtom, huddlePeopleOf, sessionProfileAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { initials } from '@juno/views'
import { mediaSnapshot, subscribeMedia } from './media'

const placeKinds = { public: 'public', private: 'private', im: 'dm', mpim: 'group' } as const

/** The channel's Main, for the huddle's place; null until it loads. */
export function useHuddleChannel(channelId: string | null): TopicDetail | null {
  return useAtomValue(huddleChannelAtom(channelId ?? ''))
}

export function placeOf(detail: TopicDetail | null): HuddlePlace {
  return detail === null ? { name: '', kind: 'public' } : { name: detail.channel.name, kind: placeKinds[detail.channel.kind] }
}

/** "#eng", "Maya Chen": the place as a toast or tooltip names it. */
export const placeLabelOf = (detail: TopicDetail | null): string => detail?.channel.label ?? 'this channel'

export function useSelfId(): string | undefined {
  const profile = useAtomValue(sessionProfileAtom)
  return profile._tag === 'Success' ? profile.value?.id : undefined
}

export function useMediaSnapshot(): MediaSnapshot | undefined {
  return useSyncExternalStore(subscribeMedia, mediaSnapshot)
}

/** The call as the bar and the tab show it: joining until media connects, reconnecting while it is down. */
export function connectionOf(call: HuddleCall, media: MediaSnapshot | undefined): HuddleConnection {
  if (call.connection === 'reconnecting' || media?.connection.state === 'reconnecting') return 'reconnecting'
  return call.phase === 'joined' && (call.connection === 'connected' || media?.connection.state === 'connected') ? 'live' : 'joining'
}

/**
 * Who is in the user's own call: the people Slack lists, the user, and
 * anyone the media session hears whom Slack does not list yet. Slack's list
 * can lag the call or be missing; the user and the people they hear are in
 * it all the same.
 */
export function callPeopleIds(call: HuddleCall, selfId: string | undefined, media: MediaSnapshot | undefined): ReadonlyArray<string> {
  const heard = media?.remotes.flatMap((remote) => (remote.userId === undefined ? [] : [remote.userId])) ?? []
  return [...new Set([...(selfId === undefined ? [] : [selfId]), ...call.participants, ...heard])]
}

/** Slack says the user is the only one in their call, and the media session hears no one else. Not while Slack's list is unknown. */
export function aloneInCall(call: HuddleCall, selfId: string | undefined, media: MediaSnapshot | undefined): boolean {
  if (selfId === undefined || !call.participants.includes(selfId)) return false
  return call.participants.every((id) => id === selfId) && !(media?.remotes.some((remote) => remote.userId !== selfId) ?? false)
}

/** When the call's duration counts from: the huddle's start once Slack says, else the user's join. */
export const callStartOf = (call: HuddleCall): number | null => call.startedAt ?? call.joinedAt

/**
 * The people in a huddle, the user first and then in join order. Speaking
 * and muted come from the media session while the user is in the call.
 */
export function useHuddlePeople(ids: ReadonlyArray<string>, selfId: string | undefined, media: MediaSnapshot | undefined, inCall: boolean): ReadonlyArray<HuddlePerson> {
  const people = useAtomValue(huddlePeopleOf(ids))
  const ordered = selfId !== undefined && ids.includes(selfId) ? [selfId, ...ids.filter((id) => id !== selfId)] : ids
  const byId = new Map(people.map((person) => [person.id, person]))
  return ordered.map((id) => personOf(id, byId.get(id), id === selfId, inCall ? media : undefined))
}

/**
 * Others' shared screens in the call the media session runs, in the order
 * they started, each named by its owner's first name ("Maya's screen"). It
 * loads until its video has a frame.
 */
export function useHuddleShares(media: MediaSnapshot | undefined): ReadonlyArray<HuddleShare> {
  const shares = media?.shares ?? []
  const people = useAtomValue(huddlePeopleOf(shares.flatMap((share) => (share.userId === undefined ? [] : [share.userId]))))
  const names = new Map(people.map((person) => [person.id, person.name.split(' ')[0] || person.name]))
  return shares.map((share) => ({
    id: share.attendeeId,
    ownerName: (share.userId === undefined ? undefined : names.get(share.userId)) ?? 'Someone',
    ...(share.ready ? {} : { loading: true }),
  }))
}

function personOf(id: string, person: Person | undefined, you: boolean, media: MediaSnapshot | undefined): HuddlePerson {
  const name = person?.name ?? 'Someone'
  const remote = you ? undefined : media?.remotes.find((attendee) => attendee.userId === id)
  const muted = you ? media?.local.muted : remote?.muted
  const attendeeId = you ? media?.local.attendeeId : remote?.attendeeId
  const speaking = attendeeId !== undefined && (you ? media?.local.speaking : remote?.speaking)
  const avatarUrl = person?.avatarLargeUrl ?? person?.avatarUrl
  return {
    id,
    name,
    initials: initials(name) || '?',
    hue: person?.color ?? 'cyan',
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    ...(you ? { you: true } : {}),
    ...(muted === true ? { muted: true } : {}),
    ...(speaking === true ? { speaking: true } : {}),
  }
}
