/**
 * Other people's presence (SPEC 7, "Presence in a DM"; SPEC 14, "Show who
 * is active in the sidebar").
 *
 * - `presence.people` is what Slack last said about the people Juno
 *   follows: the partners of the open 1:1 DMs always, and the partners of
 *   the recent DMs while the sidebar setting is on. Each list is sorted. A
 *   followed person in neither list is unknown: before Slack's first
 *   answer, and while the socket is down. `paused` lists those with
 *   notifications paused now (Slack's Do Not Disturb). Presence lives in
 *   the engine's memory only.
 *
 * The sidebar setting is the `showPresence` preference (`prefs.get` /
 * `prefs.set`); missing means off.
 */
import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { liveValueRoute } from '../live'

/** The preference key for Show who is active in the sidebar. Only `true` means on. */
export const SHOW_PRESENCE_PREF = 'showPresence'

/** `paused`: the followed people with notifications paused now, by a snooze or their own schedule, from Slack's Do Not Disturb. */
export const PresencePeople = Schema.Struct({ active: Schema.Array(Schema.String), away: Schema.Array(Schema.String), paused: Schema.Array(Schema.String) })
export type PresencePeople = typeof PresencePeople.Type

export const presencePeople = liveValueRoute('presence.people', { value: PresencePeople })

export const PresenceRoutes = RpcGroup.make(presencePeople)
