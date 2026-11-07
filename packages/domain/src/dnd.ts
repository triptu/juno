/**
 * Slack's Do Not Disturb (SPEC 14, "Pause notifications" and "Paused
 * colleagues"; research section 7): a snooze, which pauses notifications
 * for a while, and the scheduled pause, which Slack's server works out from
 * each person's notification schedule.
 */
import { endParts, hoursOn, type Hours, type Weekday } from './notifications'

/** One person's Do Not Disturb as `dnd.teamInfo` or `dnd.info` gives it. Times are Unix seconds. */
export interface SlackDnd {
  /** The next scheduled pause, or the one running now. Slack sends `1` for both when there is none. */
  readonly nextStart: number
  readonly nextEnd: number
  /** When a snooze runs: when it ends. */
  readonly snoozeEnd?: number
}

/** The answer field Slack sends when there is no scheduled pause. */
const NONE = 1

/** Whether `dnd` pauses notifications at `nowSeconds`, by Slack's own rule: a snooze, or inside the scheduled pause. */
export function dndPaused(dnd: SlackDnd, nowSeconds: number): boolean {
  if (dnd.snoozeEnd !== undefined && nowSeconds < dnd.snoozeEnd) return true
  if (dnd.nextStart === NONE || dnd.nextEnd === NONE) return false
  return dnd.nextStart <= nowSeconds && nowSeconds < dnd.nextEnd
}

/** The next time after `nowSeconds` at which `dndPaused` can change for `dnd`, or undefined when it never will on what Slack said. */
export function dndNextChange(dnd: SlackDnd, nowSeconds: number): number | undefined {
  const times = [dnd.snoozeEnd, dnd.nextStart === NONE ? undefined : dnd.nextStart, dnd.nextEnd === NONE ? undefined : dnd.nextEnd]
  const future = times.filter((time): time is number => time !== undefined && time > nowSeconds)
  return future.length === 0 ? undefined : Math.min(...future)
}

/** Slack's Pause notifications choices, in its order. Slack's Custom… is left out: Juno has no date and time picker. */
export const pauseChoices = ['30m', '1h', '2h', 'tomorrow', 'nextWeek'] as const
export type PauseChoice = (typeof pauseChoices)[number]

/** When Slack's menu resumes a pause that runs to another day, without hours: 9am. */
const DEFAULT_RESUME = 9 * 60

/** The minute notifications start on `day`, as Slack reads it from the schedule: the day's own hours, else the shared ones. */
function resumeMinute(hours: Hours | undefined, day: Weekday): number {
  if (hours === undefined) return DEFAULT_RESUME
  return hoursOn(hours, day)?.from ?? hours.from
}

/**
 * `num_minutes` for `dnd.setSnooze`, as Slack's own menu works it out
 * (`DndDisabledMenuV2`, research section 7): a fixed length, or until a
 * day's start of notifications. Until tomorrow is tomorrow at the time
 * the hours start that day; Until next week is the coming Monday (a week
 * on, from a Monday) at Monday's. Rounded up to the minute.
 */
export function pauseMinutes(choice: PauseChoice, now: number, notificationHours: Hours | undefined): number {
  switch (choice) {
    case '30m':
      return 30
    case '1h':
      return 60
    case '2h':
      return 120
    case 'tomorrow':
    case 'nextWeek': {
      const date = new Date(now)
      const days = choice === 'tomorrow' ? 1 : (8 - date.getDay()) % 7 || 7
      date.setDate(date.getDate() + days)
      const minute = resumeMinute(notificationHours, date.getDay() as Weekday)
      date.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
      return Math.max(1, Math.ceil((date.getTime() - now) / 60_000))
    }
  }
}

/**
 * When a choice would end the pause if picked at `now`, as the menu shows it beside the choice: "3:47pm", "9am"
 * (today or tomorrow), "Mon 9am" (later). The same end the snooze gets: `now` plus `pauseMinutes`.
 */
export function pauseEndHint(choice: PauseChoice, now: number, notificationHours: Hours | undefined): string {
  const { days, time, day } = endParts(now, now + pauseMinutes(choice, now, notificationHours) * 60_000)
  return days <= 1 ? time : `${day} ${time}`
}
