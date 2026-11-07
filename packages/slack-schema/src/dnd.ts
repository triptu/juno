/**
 * Do Not Disturb (research section 7): the user's snooze (Pause
 * notifications) and everyone's next scheduled pause. Times are Unix
 * seconds. Slack answers `1` for both pause times when there is none.
 */
import { Schema as S } from 'effect'
import { FormNumber } from './common.ts'
import { Ts } from './ts.ts'

const opt = S.optionalKey

export const DndInfoArgs = S.Struct({})
export const DndInfoFields = {
  dnd_enabled: S.Boolean,
  next_dnd_start_ts: S.Number,
  next_dnd_end_ts: S.Number,
  snooze_enabled: S.Boolean,
  /** Only while snoozed. */
  snooze_endtime: opt(S.Number),
}

export const DndSetSnoozeArgs = S.Struct({ num_minutes: FormNumber })
export const DndSetSnoozeFields = {
  snooze_enabled: S.Boolean,
  snooze_endtime: S.Number,
  snooze_remaining: opt(S.Number),
  snooze_is_indefinite: opt(S.Boolean),
}

export const DndEndSnoozeArgs = S.Struct({})
export const DndEndSnoozeFields = {
  snooze_enabled: S.Boolean,
  dnd_enabled: opt(S.Boolean),
  next_dnd_start_ts: opt(S.Number),
  next_dnd_end_ts: opt(S.Number),
}

/** `users` is a comma-separated list of ids. */
export const DndTeamInfoArgs = S.Struct({ users: S.String })
/** Each asked person's next scheduled pause, and their snooze when Slack shares it (checked live 2026-11-07: the keys below, without `snooze_endtime` while not snoozed). */
export const DndTeamInfoFields = {
  users: S.Record(S.String, S.Struct({
    dnd_enabled: opt(S.Boolean),
    next_dnd_start_ts: S.Number,
    next_dnd_end_ts: S.Number,
    snooze_enabled: opt(S.Boolean),
    snooze_endtime: opt(S.Number),
  })),
}

/**
 * Someone's Do Not Disturb changed: the user's own (`dnd_updated`) or a
 * colleague's (`dnd_updated_user`). Slack's client reads only `user` and asks
 * `dnd.teamInfo` again; `dnd_status` is never read (research section 7).
 */
export const DndUpdatedEvent = S.Struct({
  type: S.Literals(['dnd_updated', 'dnd_updated_user']),
  user: opt(S.String),
  dnd_status: opt(S.Unknown),
  event_ts: opt(Ts),
})
export type DndUpdatedEvent = typeof DndUpdatedEvent.Type
