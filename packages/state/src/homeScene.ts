/**
 * Home's greeting and scene (the home README, "Copy"; `docs/design/home/scenes.png`),
 * from the local clock, chosen when Home appears.
 */
import * as Atom from 'effect/reactivity/Atom'
import type { Registry } from './client'

/** The scenes in `docs/design/home/scenes.png`. */
export type HomeScene = 'morning' | 'midday' | 'evening' | 'night' | 'friday' | 'winter' | 'autumn' | 'caughtUp'

type TimeOfDay = 'morning' | 'midday' | 'evening' | 'night'

function timeOfDay(now: Date): TimeOfDay {
  const hour = now.getHours()
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'midday'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

const isFriday = (now: Date): boolean => now.getDay() === 5 && timeOfDay(now) !== 'night'

/**
 * The greeting (the home README, "Copy"): one line, by the time of day, or
 * "All caught up." There is no count under it; the rows are the count.
 */
export function homeGreeting(input: { readonly now: Date; readonly firstName?: string | undefined; readonly caughtUp: boolean }): { readonly title: string } {
  if (input.caughtUp) return { title: 'All caught up.' }
  const name = input.firstName === undefined || input.firstName === '' ? '' : `, ${input.firstName}`
  const opening = isFriday(input.now) ? 'Happy Friday' : { morning: 'Morning', midday: 'Hello', evening: 'Evening', night: 'Still up' }[timeOfDay(input.now)]
  return { title: `${opening}${name}.` }
}

const dayKey = (date: Date): string => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`

function seasonOf(date: Date): 'winter' | 'autumn' | undefined {
  const month = date.getMonth() + 1
  const day = date.getDate()
  if (month === 12 || month === 1) return 'winter'
  if ((month === 9 && day >= 15) || month === 10 || (month === 11 && day <= 15)) return 'autumn'
  return undefined
}

/** One day in six inside a season window, by a hash of the date. */
function pickedDay(date: Date): boolean {
  let hash = 0
  for (const char of dayKey(date)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return seasonOf(date) !== undefined && hash % 6 === 0
}

/** A picked day whose day before was not picked: never two seasonal days running. */
function seasonalDay(date: Date): boolean {
  const yesterday = new Date(date)
  yesterday.setDate(date.getDate() - 1)
  return pickedDay(date) && !pickedDay(yesterday)
}

/**
 * The scene (the home README, "Picking a scene"): caught up, then the
 * season on the first visit of a picked day (never at night), then Friday,
 * then the time of day.
 */
export function homeScene(input: { readonly now: Date; readonly caughtUp: boolean; readonly firstVisitToday: boolean }): HomeScene {
  if (input.caughtUp) return 'caughtUp'
  const time = timeOfDay(input.now)
  const season = seasonOf(input.now)
  if (season !== undefined && input.firstVisitToday && time !== 'night' && seasonalDay(input.now)) return season
  if (isFriday(input.now)) return 'friday'
  return time
}

/** The day Home last appeared, for the seasonal scene's "first visit of a day". */
const lastVisitDayAtom = Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive)

/** Home appeared: whether it is the first time today. */
export function homeAppeared(registry: Registry, now: Date): boolean {
  const today = dayKey(now)
  const first = registry.get(lastVisitDayAtom) !== today
  registry.set(lastVisitDayAtom, today)
  return first
}
