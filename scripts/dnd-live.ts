#!/usr/bin/env bun
/**
 * The live check of Slack's notification schedule (SPEC 14, research
 * section 7). Run with `JUNO_LIVE=1 bun scripts/dnd-live.ts`; it refuses to run
 * without `JUNO_LIVE=1`. It uses the session `smoke-live.ts --cache-session`
 * kept.
 *
 * Without flags it only reads: `users.prefs.get` for the schedule prefs,
 * printed as Slack holds them (times, day modes and on or off).
 *
 * `--apply` writes the notification hours into the schedule once, the way
 * the engine does: it reads the schedule, writes `slackScheduleFor(hours)`
 * with one `users.prefs.set` unless Slack already holds it, reads it back and
 * says whether it matches. The hours are Juno's defaults unless given with
 * `--days 1,2,3,4,5 --from 540 --to 1140` (0 is Sunday; minutes since
 * midnight). `--restore '<json>'` writes a schedule printed by an earlier
 * run back.
 *
 * Only `users.prefs.get` and `users.prefs.set` are called, and a write may
 * name only the schedule prefs. Calls start 1.5 s apart. Nothing but the
 * schedule prefs and Slack's `ok` or error code is printed: no token,
 * cookie, id or other pref.
 */
import { apiBaseFromWorkspace, slackRoute } from '@juno/slack'
import { defaultNotificationSettings, slackScheduleFor, slackScheduleKeys, slackScheduleMatches, type Hours, type SlackSchedulePrefs, type Weekday } from '../packages/domain/src/index.ts'
import { readCachedSession } from './live-common.ts'

if (process.env.JUNO_LIVE !== '1') {
  console.error('dnd-live: set JUNO_LIVE=1 to run against your real workspace.')
  process.exit(2)
}

const SPACING_MILLIS = 1_500
const args = process.argv.slice(2)
const flag = (name: string) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const cached = await readCachedSession(flag('--team'))
if (cached === undefined) {
  console.error('dnd-live: no cached session; run `JUNO_LIVE=1 bun run smoke:live --cache-session` first')
  process.exit(2)
}
const { session, cookie } = cached
const base = apiBaseFromWorkspace(session.workspaceUrl)
const route = slackRoute(session)
let lastStart = 0

async function call(method: 'users.prefs.get' | 'users.prefs.set', fields: Record<string, string>): Promise<Record<string, unknown>> {
  if (method === 'users.prefs.set') {
    const names = Object.keys(JSON.parse(fields['prefs'] ?? '{}') as object)
    if (names.length === 0 || names.some((name) => !slackScheduleKeys.includes(name))) throw new Error('dnd-live: refusing a write outside the schedule prefs')
  }
  const wait = lastStart + SPACING_MILLIS - Date.now()
  if (wait > 0) await sleep(wait)
  lastStart = Date.now()
  const url = new URL(`${base}/${method}`)
  url.searchParams.set('_x_id', `noversion-${(Date.now() / 1000).toFixed(3)}`)
  url.searchParams.set('slack_route', route)
  url.searchParams.set('_x_app_name', 'client')
  const body = new FormData()
  body.append('token', session.token)
  body.append('_x_reason', 'dnd-live')
  body.append('_x_mode', 'online')
  for (const [name, value] of Object.entries(fields)) body.append(name, value)
  const response = await fetch(url, { method: 'POST', body, headers: { cookie } })
  const json = (await response.json()) as Record<string, unknown>
  console.log(`${method}: ${json['ok'] === true ? 'ok' : `error ${String(json['error'])}`} (HTTP ${response.status}; answer keys: ${Object.keys(json).sort().join(', ')})`)
  return json
}

async function schedule(): Promise<Record<string, unknown>> {
  const answer = await call('users.prefs.get', { prefs: slackScheduleKeys.join(',') })
  const prefs = (answer['prefs'] ?? {}) as Record<string, unknown>
  return Object.fromEntries(slackScheduleKeys.filter((key) => key in prefs).map((key) => [key, prefs[key]]))
}

const show = (label: string, prefs: Record<string, unknown>) => console.log(`${label}: ${JSON.stringify(prefs)}`)

async function write(target: SlackSchedulePrefs): Promise<void> {
  const before = await schedule()
  show('schedule before', before)
  if (slackScheduleMatches(before, target)) {
    console.log('Slack already holds it: nothing written.')
    return
  }
  const answer = await call('users.prefs.set', { prefs: JSON.stringify(target) })
  if (answer['ok'] !== true) process.exit(1)
  const after = await schedule()
  show('schedule after', after)
  console.log(slackScheduleMatches(after, target) ? 'Read back: matches.' : 'Read back: does NOT match.')
}

const restore = flag('--restore')
if (restore !== undefined) {
  await write(JSON.parse(restore) as SlackSchedulePrefs)
} else if (args.includes('--apply')) {
  const days = flag('--days')
  const hours: Hours = {
    days: days === undefined ? defaultNotificationSettings.notificationHours.days : days.split(',').map((day) => Number(day) as Weekday),
    from: Number(flag('--from') ?? defaultNotificationSettings.notificationHours.from),
    to: Number(flag('--to') ?? defaultNotificationSettings.notificationHours.to),
  }
  console.log(`hours: ${JSON.stringify(hours)}`)
  const target = slackScheduleFor(hours)
  show('target', target)
  await write(target)
} else {
  show('schedule', await schedule())
}
