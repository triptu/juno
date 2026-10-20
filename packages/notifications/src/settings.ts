import { defaultNotificationSettings } from '@juno/domain'
import { prefs } from '@juno/store'
import { Effect, Schema } from 'effect'

const minute = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1439 }))
const hours = Schema.Struct({ days: Schema.Array(Schema.Literals([0, 1, 2, 3, 4, 5, 6])), from: minute, to: minute })
export const NotificationSettingsSchema = Schema.Struct({
  notificationHours: hours,
  presenceHours: hours,
  matters: Schema.String,
  channels: Schema.Record(Schema.String, Schema.Literals(['every', 'never'])),
  people: Schema.Record(Schema.String, Schema.Literals(['every', 'never'])),
  threads: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literals(['every', 'never']))),
  huddleRing: Schema.optionalKey(Schema.Boolean),
})

export const readSettings = Effect.gen(function* () {
  const raw = yield* prefs.get('notifications')
  const settings = yield* Schema.decodeUnknownEffect(NotificationSettingsSchema)(raw ?? defaultNotificationSettings).pipe(
    Effect.catch(() => Effect.succeed(defaultNotificationSettings)),
  )
  const aiAssist = (yield* prefs.get('aiAssist')) !== false
  return { settings, aiAssist }
})
