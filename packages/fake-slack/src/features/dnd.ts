/**
 * Do Not Disturb (research section 7): the user's snooze and other users'
 * scheduled pauses, as `dnd.teamInfo` answers them. Every change sends
 * `dnd_updated` (the user) or `dnd_updated_user` (someone else), as Slack
 * does; Slack's own client reads only `user` from them and asks again.
 * `setUserDnd({ user, dnd })` sets another user's pause (Unix seconds,
 * `{ next_dnd_start_ts, next_dnd_end_ts, snooze_endtime? }`; no `dnd`
 * clears it).
 */
import { ApiError } from '../methods.ts'
import type { UserDnd } from '../state.ts'
import type { FakeFeature } from './registry.ts'

export const dndFeature = {
  methods: {
  'dnd.info': (ctx) => {
    const snooze = ctx.workspace.activeSnooze()
    return { dnd_enabled: false, next_dnd_start_ts: 1, next_dnd_end_ts: 1, snooze_enabled: snooze !== undefined, ...(snooze === undefined ? {} : { snooze_endtime: snooze }) }
  },

  /** Starts or replaces self's snooze and sends `dnd_updated`, as Slack does to every client of the user. */
  'dnd.setSnooze': (ctx, args) => {
    const ws = ctx.workspace
    if (!Number.isInteger(args.num_minutes) || args.num_minutes < 1) return new ApiError('invalid_arguments')
    const now = Math.floor(ws.clock.now() / 1000)
    ws.snoozeEnd = now + args.num_minutes * 60
    ws.emit({ type: 'dnd_updated', user: ws.selfId, event_ts: ws.eventTs() })
    return { snooze_enabled: true, snooze_endtime: ws.snoozeEnd, snooze_remaining: args.num_minutes * 60, snooze_is_indefinite: false }
  },

  'dnd.endSnooze': (ctx) => {
    const ws = ctx.workspace
    if (ws.activeSnooze() === undefined) return new ApiError('snooze_not_active')
    ws.snoozeEnd = undefined
    ws.emit({ type: 'dnd_updated', user: ws.selfId, event_ts: ws.eventTs() })
    return { snooze_enabled: false, dnd_enabled: false, next_dnd_start_ts: 1, next_dnd_end_ts: 1 }
  },

  /** Each asked user's pause; a user with none answers `1` for both times, as Slack does. Self's snooze is folded in. */
  'dnd.teamInfo': (ctx, args) => {
    const ws = ctx.workspace
    const users: Record<string, { dnd_enabled: boolean; next_dnd_start_ts: number; next_dnd_end_ts: number; snooze_enabled: boolean; snooze_endtime?: number }> = {}
    for (const id of args.users.split(',').filter((each) => each !== '')) {
      const dnd = ws.dnd.get(id)
      const snooze = id === ws.selfId ? ws.activeSnooze() : dnd?.snooze_endtime
      users[id] = {
        dnd_enabled: dnd?.dnd_enabled ?? dnd !== undefined,
        next_dnd_start_ts: dnd?.next_dnd_start_ts ?? 1,
        next_dnd_end_ts: dnd?.next_dnd_end_ts ?? 1,
        snooze_enabled: snooze !== undefined,
        ...(snooze === undefined ? {} : { snooze_endtime: snooze }),
      }
    }
    return { users }
  },
  },
  controls: {
    setUserDnd: (fake, input: { readonly user: string; readonly dnd?: UserDnd }) => fake.workspace.setUserDnd(input.user, input.dnd),
  },
} satisfies FakeFeature
