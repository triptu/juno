/**
 * The @ and # suggestions' live queries (spec section 8). A list reads
 * nothing while it is closed; each query is its own subscription, kept for
 * the usual idle time so typing back to an earlier query answers at once.
 */
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { mentionsChannels, mentionsPeople, type MentionChannel, type MentionPerson } from '@juno/contract'
import { registry } from './client'
import { liveQuery } from './atoms'

const peopleFamily = liveQuery(mentionsPeople)
const channelsFamily = liveQuery(mentionsChannels)

const closed = Atom.make(AsyncResult.initial<never, never>())

/** Where a person list ranks from: the conversation (and thread) the composer writes to. */
export interface MentionPlace {
  readonly channel?: string | undefined
  readonly threadTs?: string | undefined
}

/** The people matching `query` while the "@" list is open. */
export const mentionPeopleAtom = (query: string | undefined, place: MentionPlace) =>
  query === undefined
    ? closed
    : peopleFamily({ query, ...(place.channel === undefined ? {} : { channel: place.channel }), ...(place.threadTs === undefined ? {} : { threadTs: place.threadTs }) })

/** The channels matching `query` while the "#" list is open. */
export const mentionChannelsAtom = (query: string | undefined) => (query === undefined ? closed : channelsFamily({ query }))

/**
 * Calls `then` once with the first answer for `query`, the "@" list's when
 * `trigger` is "@", the "#" list's otherwise. Answers a function that stops
 * waiting. For an Enter typed before the answer landed.
 */
export function onFirstMentionAnswer(
  trigger: '@' | '#',
  query: string,
  place: MentionPlace,
  then: (rows: ReadonlyArray<MentionPerson> | ReadonlyArray<MentionChannel>) => void,
): () => void {
  let done = false
  let stop: (() => void) | undefined
  const end = () => {
    done = true
    stop?.()
    stop = undefined
  }
  const answer = (result: AsyncResult.AsyncResult<ReadonlyArray<MentionPerson> | ReadonlyArray<MentionChannel>, unknown>) => {
    if (done || result._tag !== 'Success') return
    done = true
    // The registry may be mid-notify, or not have answered `subscribe` yet: unsubscribe after.
    queueMicrotask(end)
    then(result.value)
  }
  stop =
    trigger === '@'
      ? registry.subscribe(mentionPeopleAtom(query, place), answer, { immediate: true })
      : registry.subscribe(mentionChannelsAtom(query), answer, { immediate: true })
  return end
}
