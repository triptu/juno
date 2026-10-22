/**
 * Huddles (SPEC 20, contract `routes/huddle.ts`): the engine's call and the
 * running huddles, and the commands. The media session itself lives in the
 * renderer outside React and Atom (`containers/huddle/media.ts`); these are
 * only the engine's side.
 */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { huddleCall, huddleDismiss, huddleIncoming, huddleLeave, huddlePeople, huddleReport, huddleRunning, huddleStart, mainTopicOf, type HuddleCall, type HuddlePageReport, type IncomingHuddle, type Person, type RunningHuddle, type TopicDetail } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
import { topicAtom } from './messages'

/** One wall clock for every huddle duration, mounted only while a duration is visible. */
export const huddleNowAtom = Atom.make<number>((get) => {
  const timer = setInterval(() => get.setSelf(Date.now()), 1_000)
  get.addFinalizer(() => clearInterval(timer))
  return Date.now()
})

/** The current call, or how the last one ended. */
export const huddleCallAtom = liveQuery(huddleCall)(undefined)

/** Every running huddle Juno knows of, by channel id. */
export const huddleRunningAtom = liveQuery(huddleRunning)(undefined)

/** The huddles someone just started where the user is, newest first (SPEC 20, "Incoming huddles"). */
export const huddleIncomingAtom = liveQuery(huddleIncoming)(undefined)

const noIncoming: ReadonlyArray<IncomingHuddle> = []

/** The incoming huddles once the engine has said, else none. */
export const huddleIncomingValueAtom = Atom.make((get): ReadonlyArray<IncomingHuddle> => {
  const result = get(huddleIncomingAtom)
  return AsyncResult.isSuccess(result) ? result.value : noIncoming
})

/** The call once the engine has said, else undefined. */
export const huddleCallValueAtom = Atom.make((get): HuddleCall | undefined => {
  const result = get(huddleCallAtom)
  return AsyncResult.isSuccess(result) ? result.value : undefined
})

/** The running huddle in one channel, for its header control and tab. */
export const huddleInChannelAtom = Atom.family((channelId: string) =>
  Atom.make((get): RunningHuddle | undefined => {
    const result = get(huddleRunningAtom)
    return AsyncResult.isSuccess(result) ? result.value[channelId] : undefined
  }),
)

/**
 * How many people are in the huddle running in a channel, or undefined for
 * none. A number, so a sidebar row re-renders only when its own count changes.
 */
export const huddleCountAtom = Atom.family((channelId: string) =>
  Atom.make((get): number | undefined => get(huddleInChannelAtom(channelId))?.participants.length),
)

/** When the huddle in a channel last started, and when Juno saw it stop running (null while it runs). */
export interface HuddleLastRun {
  readonly startedAt: number
  readonly endedAt: number | null
}

/** The last run Juno saw in a channel while this is read, so the ended page can say how long it lasted. */
export const huddleLastRunAtom = Atom.family((channelId: string) =>
  Atom.make((get): HuddleLastRun | undefined => {
    const startedAt = get(huddleInChannelAtom(channelId))?.startedAt ?? null
    const before = Option.getOrUndefined(get.self<HuddleLastRun | undefined>())
    if (startedAt !== null) return before?.startedAt === startedAt && before.endedAt === null ? before : { startedAt, endedAt: null }
    return before === undefined || before.endedAt !== null ? before : { ...before, endedAt: Date.now() }
  }),
)

/** A channel's Main, for the huddle's place: its name and kind. Null for no channel, or until it loads. */
export const huddleChannelAtom = Atom.family((channelId: string) =>
  Atom.make((get): TopicDetail | null => {
    if (channelId === '') return null
    const result = get(topicAtom(mainTopicOf(channelId)))
    return AsyncResult.isSuccess(result) ? result.value : null
  }),
)

const peopleQuery = liveQuery(huddlePeople)
const noPeople: ReadonlyArray<Person> = []

/** The people with these ids, in order; empty until the engine answers. */
export const huddlePeopleAtom = Atom.family((key: string) =>
  Atom.make((get): ReadonlyArray<Person> => {
    if (key === '') return noPeople
    const result = get(peopleQuery({ ids: key.split(',') }))
    return AsyncResult.isSuccess(result) ? result.value : noPeople
  }),
)

/** `huddlePeopleAtom` for a list of ids. */
export const huddlePeopleOf = (ids: ReadonlyArray<string>) => huddlePeopleAtom(ids.join(','))

export const startHuddle = (registry: Registry, channelId: string, region: string | null, generation: number) =>
  runCommand(registry, huddleStart, { channelId, region, generation })

export const leaveHuddle = (registry: Registry) => runCommand(registry, huddleLeave, undefined)

export const dismissHuddle = (registry: Registry, callId: string) => runCommand(registry, huddleDismiss, { callId })

export const reportHuddleMedia = (registry: Registry, report: HuddlePageReport) => runCommand(registry, huddleReport, { report })
