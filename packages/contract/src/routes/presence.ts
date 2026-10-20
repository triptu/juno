/**
 * Other people's presence (SPEC 14, "Show when people are active").
 *
 * - `presence.active` is the user ids Slack shows as active among the people
 *   Juno follows (the DM partners in the sidebar), sorted. It is empty while
 *   the setting is off, while the socket is down and before the first
 *   answer. Presence lives in the engine's memory only.
 *
 * The setting is the `showPresence` preference (`prefs.get` / `prefs.set`);
 * missing means on.
 */
import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { liveValueRoute } from '../live'

/** The preference key for Show when people are active. Missing or anything but `false` means on. */
export const SHOW_PRESENCE_PREF = 'showPresence'

export const presenceActive = liveValueRoute('presence.active', { value: Schema.Array(Schema.String) })

export const PresenceRoutes = RpcGroup.make(presenceActive)
