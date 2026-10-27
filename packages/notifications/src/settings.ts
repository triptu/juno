import { defaultNotificationSettings, readLevel, sameHours, slackScheduleHours, startingHours, type Hours, type NotificationSettings, type NotifyLevel } from '@juno/domain'
import { prefs, StoreReader, transaction } from '@juno/store'
import { Effect, Option, Schema } from 'effect'

const minute = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1439 }))
const weekday = Schema.Literals([0, 1, 2, 3, 4, 5, 6])
/** Hours saved before 2026-10-24 have no `dayHours` and read as the same hours. */
const hours = Schema.Struct({
  days: Schema.Array(weekday),
  from: minute,
  to: minute,
  dayHours: Schema.optionalKey(Schema.Array(Schema.Struct({ day: weekday, from: minute, to: minute }))),
})
const level = Schema.Literals(['always', 'never'])
const levels = Schema.Record(Schema.String, level)
/**
 * The `notifications` pref. Hours are stored only once the owner sets them. Settings saved before 2026-10-27
 * have no `hoursAsSet` and kept hours never set as Monday to Friday 9 to 7: those read as not set (`settingsOf`).
 */
export const NotificationSettingsSchema = Schema.Struct({
  notificationHours: Schema.optionalKey(hours),
  presenceHours: Schema.optionalKey(hours),
  hoursAsSet: Schema.optionalKey(Schema.Literal(true)),
  channels: levels,
  people: levels,
  threads: Schema.optionalKey(levels),
  alwaysNotify: Schema.optionalKey(Schema.Struct({
    dms: Schema.optionalKey(Schema.Boolean),
    groupDms: Schema.optionalKey(Schema.Boolean),
    mentions: Schema.optionalKey(Schema.Boolean),
    startedThreads: Schema.optionalKey(Schema.Boolean),
    followedThreads: Schema.optionalKey(Schema.Boolean),
  })),
  instructions: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String, direction: Schema.Literals(['notify', 'stay']), text: Schema.String }))),
  /** What matters to you, from before instructions: kept as stored, never read. */
  matters: Schema.optionalKey(Schema.String),
  huddleRing: Schema.optionalKey(Schema.Boolean),
})

/** Levels as they read now (`readLevel`): `every` stored before 2026-10-23 is Always, `matters` is Auto and dropped. */
const readLevels = (stored: unknown): Record<string, NotifyLevel> => {
  if (typeof stored !== 'object' || stored === null) return {}
  const out: Record<string, NotifyLevel> = {}
  for (const [id, value] of Object.entries(stored)) {
    const read = readLevel(value)
    if (read !== undefined) out[id] = read
  }
  return out
}

/** The stored pref with old level values read as they are now. */
const current = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null) return raw
  const stored = raw as Record<string, unknown>
  return {
    ...stored,
    channels: readLevels(stored['channels']),
    people: readLevels(stored['people']),
    ...(stored['threads'] === undefined ? {} : { threads: readLevels(stored['threads']) }),
  }
}

const decodeSettings = Schema.decodeUnknownOption(NotificationSettingsSchema)

/** Saved before 2026-10-27: hours never set were kept as Monday to Friday 9 to 7. */
const savedWithStartingHours = (raw: unknown) => typeof raw === 'object' && raw !== null && !('hoursAsSet' in raw)

/** Hours saved before 2026-10-27 that are the ones every install started with, which the owner never set. */
const setHours = (hours: Hours | undefined, old: boolean) => (hours === undefined || (old && sameHours(hours, startingHours)) ? undefined : hours)

/**
 * The `notifications` pref as it reads now: old levels read as today's, hours saved before 2026-10-27 as the
 * starting ones read as not set, and anything missing or invalid is the defaults.
 */
export const settingsOf = (raw: unknown): NotificationSettings => {
  const decoded = decodeSettings(current(raw ?? defaultNotificationSettings))
  if (Option.isNone(decoded)) return defaultNotificationSettings
  const { notificationHours, presenceHours, hoursAsSet: _, ...rest } = decoded.value
  const old = savedWithStartingHours(raw)
  const notification = setHours(notificationHours, old)
  const presence = setHours(presenceHours, old)
  return { ...rest, ...(notification === undefined ? {} : { notificationHours: notification }), ...(presence === undefined ? {} : { presenceHours: presence }) }
}

const store = (settings: NotificationSettings) =>
  prefs.set('notifications', Schema.decodeUnknownSync(NotificationSettingsSchema)({ ...settings, hoursAsSet: true }))

/** Saves the settings: hours not set are left out, and `hoursAsSet` says so. */
export const saveSettings = (settings: NotificationSettings) => transaction(store(settings))

/**
 * Undefined unless the settings were saved before 2026-10-27; then whether their active hours were the starting
 * ones, which now read as not set.
 */
export const oldSettings = Effect.map(prefs.get('notifications'), (raw) =>
  savedWithStartingHours(raw) ? { presenceUnset: settingsOf(raw).presenceHours === undefined } : undefined)

/** Saves settings saved before 2026-10-27 as they read now, so they are read the new way from then on. */
export const saveOldSettings = transaction(Effect.gen(function* () {
  const raw = yield* prefs.get('notifications')
  if (savedWithStartingHours(raw)) yield* store(settingsOf(raw))
}))

/** Slack's prefs as the sync last stored them, or undefined before the first boot. */
export const slackPrefs = Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql<{ prefs_json: string | null }>`SELECT prefs_json FROM team LIMIT 1`
  const json = rows[0]?.prefs_json
  return json == null ? undefined : (JSON.parse(json) as Record<string, unknown>)
})

/** The settings as the owner set them, with no hours where they set none. Change and save these. */
export const readOwnSettings = Effect.gen(function* () {
  const settings = settingsOf(yield* prefs.get('notifications'))
  const aiAssist = (yield* prefs.get('aiAssist')) !== false
  return { settings, aiAssist }
})

/** The hours Slack's own schedule lets notifications through, as the sync last stored it. Undefined pauses nothing. */
export const slackHours = Effect.map(slackPrefs, (cached) => (cached === undefined ? undefined : slackScheduleHours(cached)))

/**
 * The settings as they decide: the notification hours are the ones in effect. Reads Slack's prefs (the `team`
 * row) while the owner has not set them.
 */
export const readSettings = Effect.gen(function* () {
  const own = yield* readOwnSettings
  if (own.settings.notificationHours !== undefined) return own
  const notificationHours = yield* slackHours
  return { ...own, settings: notificationHours === undefined ? own.settings : { ...own.settings, notificationHours } }
})

/**
 * Set yourself away or active (SPEC 14, "Away by hand"): what was chosen, until
 * the next switch in the active hours it was chosen under (null when they never
 * switch). Saved, so a wake or a new session keeps it rather than applying the
 * hours over it.
 */
const PresenceHoldSchema = Schema.Struct({
  presence: Schema.Literals(['active', 'away']),
  until: Schema.NullOr(Schema.Number),
  hours,
})
export type PresenceHold = typeof PresenceHoldSchema.Type

const HOLD_PREF = 'presenceHold'
const decodeHold = Schema.decodeUnknownOption(PresenceHoldSchema)

export const presenceHold = {
  read: Effect.map(prefs.get(HOLD_PREF), (raw) => Option.getOrUndefined(decodeHold(raw))),
  write: (hold: PresenceHold | undefined) => prefs.set(HOLD_PREF, hold ?? null),
}
