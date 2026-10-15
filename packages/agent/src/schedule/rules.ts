import { Schema } from 'effect'
import { ScheduleDefinition } from '@juno/agent-contract'

export const ReplyWatch = Schema.Struct({
  accountId: Schema.optionalKey(Schema.String), channelId: Schema.String, ts: Schema.String, threadTs: Schema.optionalKey(Schema.String),
  from: Schema.Union([Schema.Literal('others'), Schema.Array(Schema.String)]),
})
export type ReplyWatch = typeof ReplyWatch.Type
export const Definition = Schema.Struct({
  what: Schema.String, prompt: Schema.String, schedule: ScheduleDefinition,
  deliver: Schema.Literals(['now', 'digest', 'silent']), unlessReply: Schema.optionalKey(ReplyWatch),
})
export type Definition = typeof Definition.Type
export interface Reply {
  readonly channelId: string
  readonly ts: string
  readonly threadTs?: string
  readonly userId: string
}
export function matchesReply(watch: ReplyWatch, reply: Reply, owner: string): boolean {
  return reply.channelId === watch.channelId && Number(reply.ts) > Number(watch.ts) &&
    (watch.threadTs === undefined ? reply.threadTs === undefined : reply.threadTs === watch.threadTs) &&
    (watch.from === 'others' ? reply.userId !== owner : watch.from.includes(reply.userId))
}

export interface NotificationHours {
  readonly timeZone: string
  /** ISO weekdays, Monday = 1. */
  readonly weekdays: ReadonlyArray<number>
  readonly start: number
  readonly end: number
}
function formatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
}
function local(at: number, format: Intl.DateTimeFormat) {
  const parts = format.formatToParts(at)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  const day = Date.UTC(value('year'), value('month') - 1, value('day'))
  return { day, minute: value('hour') * 60 + value('minute'), weekday: new Date(day).getUTCDay() || 7 }
}
/** Minute scanning also handles missing and repeated local times at DST boundaries. */
function nextLocal(after: number, timeZone: string, accepts: (value: ReturnType<typeof local>) => boolean): number {
  const format = formatter(timeZone)
  const formatStart = Math.floor(after / 60_000) * 60_000 + 60_000
  for (let at = formatStart; at <= after + 9 * 86_400_000; at += 60_000) {
    if (accepts(local(at, format))) return at
  }
  throw new Error('No notification day in the next week.')
}
export function menuDeadline(now: number, hours: NotificationHours): number {
  const today = local(now, formatter(hours.timeZone))
  const minute = today.minute >= hours.start && today.minute < hours.end ? today.minute : hours.start
  return nextLocal(now, hours.timeZone, (v) => v.day > today.day && hours.weekdays.includes(v.weekday) && v.minute >= minute && v.minute < hours.end)
}
export function nextDue(schedule: typeof ScheduleDefinition.Type, after: number): number {
  switch (schedule._tag) {
    case 'once': return schedule.at
    case 'interval': return after + schedule.everyMs
    case 'wallClock': {
      const [hour = 0, minute = 0] = schedule.time.split(':').map(Number)
      return nextLocal(after, schedule.timeZone, (v) => schedule.weekdays.includes(v.weekday) && v.minute === hour * 60 + minute)
    }
  }
}
export function notification(deliver: Definition['deliver'], quiet: boolean, aiOn: boolean): 'now' | 'hold' | 'silent' {
  if (!aiOn || deliver === 'silent') return 'silent'
  return deliver === 'now' || !quiet ? 'now' : 'hold'
}
export const NUDGE_PROMPT = 'Check the watched conversation for a reply. If nobody matching the watch has replied, draft a short nudge in the owner’s voice as a Send message card in that conversation. Do not send it or create another watch. If a reply arrived, say nothing.'
