/**
 * What the Notifications page and Today's Details read (SPEC 14): the
 * Always and Never lists with names, today's counts and today's decisions.
 */
import { Effect, Schema } from 'effect'
import { NotifyTargetSchema, TODAY_DECISIONS_LIMIT, type NotifyTag, type TodayRow } from '@juno/contract'
import { channelLabel, firstWords, slackLine, type ConversationKind, type NotificationSettings, type NotifyLevel } from '@juno/domain'
import { Candidate } from '@juno/notifications'
import { UNKNOWN_PERSON } from '@juno/richtext'
import { StoreReader } from '@juno/store'

/** Every channel, person and thread on a list, with their names; a thread by its topic title. Unknown ids show as they are. */
export const tagsFor = (settings: NotificationSettings, level: NotifyLevel) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const channelIds = Object.keys(settings.channels).filter((id) => settings.channels[id] === level)
    const personIds = Object.keys(settings.people).filter((id) => settings.people[id] === level)
    const channels = channelIds.length === 0 ? [] : yield* sql<{ id: string; kind: ConversationKind; name: string | null; person: string | null }>`
      SELECT c.id, c.kind, c.name, COALESCE(u.display_name, u.real_name, u.name) AS person FROM conversations c
      LEFT JOIN users u ON u.id = c.user_id WHERE c.id IN ${sql.in(channelIds)}`
    const people = personIds.length === 0 ? [] : yield* sql<{ id: string; name: string | null; avatar_url: string | null }>`
      SELECT id, COALESCE(display_name, real_name, name) AS name, avatar_url FROM users WHERE id IN ${sql.in(personIds)}`
    const channelById = new Map(channels.map((row) => [row.id, row]))
    const personById = new Map(people.map((row) => [row.id, row]))
    const threadIds = Object.keys(settings.threads ?? {}).filter((id) => settings.threads?.[id] === level)
    const threads = threadIds.length === 0 ? [] : yield* sql<{ topic_id: string; manual_title: string | null; ai_title: string | null; root_text: string | null }>`
      SELECT i.topic_id, o.manual_title, o.ai_title, m.text AS root_text FROM topic_index i
      LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id LEFT JOIN messages m ON m.channel = i.channel AND m.ts = i.root_ts
      WHERE i.topic_id IN ${sql.in(threadIds)}`
    const threadById = new Map(threads.map((row) => [row.topic_id, row]))
    const tags: NotifyTag[] = []
    for (const id of channelIds) {
      const row = channelById.get(id)
      const kind = row?.kind ?? 'public'
      tags.push({ kind: 'channel', id, name: row?.person ?? row?.name ?? id, channelKind: kind })
    }
    for (const id of personIds) {
      const row = personById.get(id)
      tags.push({ kind: 'person', id, name: row?.name ?? UNKNOWN_PERSON, ...(row?.avatar_url == null ? {} : { avatarUrl: row.avatar_url }) })
    }
    for (const id of threadIds) {
      const row = threadById.get(id)
      tags.push({ kind: 'thread', id, name: row?.manual_title?.trim() || row?.ai_title?.trim() || firstWords(slackLine(row?.root_text ?? '')) || 'Thread' })
    }
    return tags.toSorted((a, b) => a.name.localeCompare(b.name))
  })

interface LogRow {
  readonly id: number
  readonly at: string
  readonly channel: string
  readonly topic_id: string | null
  readonly outcome: 'notify' | 'stay'
  readonly decided_by: TodayRow['decidedBy'] | null
  readonly decision_json: string | null
  readonly reason: string | null
  readonly preview: string | null
  readonly candidate_json: string | null
  readonly suppressed_at: string | null
}

const decodeCandidate = (json: string | null): Candidate | undefined => {
  if (json === null) return undefined
  try {
    return Schema.decodeUnknownSync(Candidate)(JSON.parse(json))
  } catch {
    return undefined
  }
}

const DecisionExtra = Schema.Struct({ target: Schema.optionalKey(NotifyTargetSchema), instructionId: Schema.optionalKey(Schema.String) })
const decodeExtra = (json: string | null): typeof DecisionExtra.Type => {
  if (json === null) return {}
  try {
    return Schema.decodeUnknownSync(DecisionExtra)(JSON.parse(json))
  } catch {
    return {}
  }
}

const sinceMidnight = (now: number) => {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  return midnight.toISOString()
}

/** Today's counts for the page: what notified (a banner was shown) and what stayed, a banner held because the conversation was open included. */
export const todayCounts = (now: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const counts = yield* sql<{ notified: number; stayed: number }>`
      SELECT COALESCE(SUM(delivered_at IS NOT NULL AND outcome = 'notify'), 0) AS notified, COALESCE(SUM(outcome = 'stay' OR suppressed_at IS NOT NULL), 0) AS stayed
      FROM notification_log WHERE at >= ${sinceMidnight(now)}`
    return { notified: counts[0]?.notified ?? 0, stayed: counts[0]?.stayed ?? 0 }
  })

/** Every decision today, newest first, for Details. Rows from before decided-by was stored read as Auto's reading. */
export const todayDecisions = (now: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const rows = yield* sql<LogRow>`SELECT id, at, channel, topic_id, outcome, decided_by, decision_json, reason, preview, candidate_json, suppressed_at
      FROM notification_log WHERE at >= ${sinceMidnight(now)} ORDER BY at DESC, id DESC LIMIT ${TODAY_DECISIONS_LIMIT}`
    return rows.map((row): TodayRow => {
      const candidate = decodeCandidate(row.candidate_json)
      // A banner held because the conversation was open in a focused window stayed, as Today counts it.
      const held = row.outcome === 'notify' && row.suppressed_at !== null
      return {
        id: row.id,
        at: new Date(row.at).getTime(),
        place: candidate === undefined ? '' : channelLabel(candidate.channel),
        sender: candidate?.senderName ?? '',
        senderId: candidate?.senderId ?? '',
        channelId: row.channel,
        topicId: row.topic_id ?? '',
        text: row.preview ?? '',
        outcome: row.outcome === 'notify' && !held ? 'notify' : 'stay',
        decidedBy: row.decided_by ?? 'reading',
        reason: held ? 'You had the conversation open.' : (row.reason ?? ''),
        ...decodeExtra(row.decision_json),
      }
    })
  })

