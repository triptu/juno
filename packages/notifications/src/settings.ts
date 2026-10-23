import { defaultNotificationSettings, readLevel, type NotificationSettings, type NotifyLevel } from '@juno/domain'
import { prefs } from '@juno/store'
import { Effect, Schema } from 'effect'

const minute = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1439 }))
const hours = Schema.Struct({ days: Schema.Array(Schema.Literals([0, 1, 2, 3, 4, 5, 6])), from: minute, to: minute })
const level = Schema.Literals(['always', 'never'])
const levels = Schema.Record(Schema.String, level)
export const NotificationSettingsSchema = Schema.Struct({
  notificationHours: hours,
  presenceHours: hours,
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

export const readSettings = Effect.gen(function* () {
  const raw = yield* prefs.get('notifications')
  const settings: NotificationSettings = yield* Schema.decodeUnknownEffect(NotificationSettingsSchema)(current(raw ?? defaultNotificationSettings)).pipe(
    Effect.catch(() => Effect.succeed(defaultNotificationSettings)),
  )
  const aiAssist = (yield* prefs.get('aiAssist')) !== false
  return { settings, aiAssist }
})
