/**
 * One drawing: the topic as the model reads it, the call, and the stored
 * row. Shared by the background job and the Redraw command.
 *
 * What is stored (`topic_art`, user.db): every finished attempt. A valid,
 * confident drawing is `ok` and shown. A drawing the model marked not
 * confident is `unsure`, a reply outside the vocabulary twice is `failed`;
 * both keep the placeholder and stop the topic being asked about again
 * until a redraw or its first AI title. A call that did not finish (no key,
 * a timeout, a provider error) stores nothing; the job tries again later.
 */
import { AiProvider, cacheKeyOf, tasks, type Decision, type TopicArtInput } from '@juno/ai'
import type { StoredArt } from '@juno/contract'
import { channelLabel, resolveTitle, type TopicId, slackLine } from '@juno/domain'
import { Invalidation, keys, StoreReader, StoreWriter, type SqlError } from '@juno/store'
import { parseRecipe } from '@juno/topic-art'
import { Clock, Effect } from 'effect'
import { createHash } from 'node:crypto'
import { channelInfoOf, parseColumns, topicFrom, TOPIC_COLUMNS, TOPIC_FROM, userName, type JoinedRow, type UserRow } from '../topicRows'

/** How many top-level messages a Main is drawn from. */
const RECENT_MESSAGES = 4
/** Message text is cut here before it reaches the model; a drawing needs the subject, not the message. */
const TEXT_CHARS = 240

export type ArtOutcome = 'ok' | 'unsure' | 'failed' | 'missing-key' | 'timeout' | 'provider-error' | 'budget'

/** Rows the job and the command read: a topic joined as the sidebar sees it. */
export const ART_SELECT = `${TOPIC_COLUMNS}, NULL AS channel_activity_ts ${TOPIC_FROM}`

/** A drawing can be made for a channel's Main and for any thread; a DM's Main is the person and keeps the photo. */
export const canDraw = (row: JoinedRow): boolean => !(row.kind === 'main' && (row.c_kind === 'im' || row.c_kind === 'mpim'))

const oneLine = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_CHARS)

const readUsers = (ids: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const users = new Map<string, UserRow>()
    if (ids.size === 0) return users
    for (const user of yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url FROM users WHERE id IN ${sql.in([...ids])}`) users.set(user.id, user)
    return users
  })

/** The model's view of a topic, and the title source it was built from. */
export const artInputOf = (
  row: JoinedRow,
  selfId: string | undefined,
  avoid: TopicArtInput['avoid'],
): Effect.Effect<{ readonly input: TopicArtInput; readonly titleSource: string }, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const columns = parseColumns(row)
    const ids = new Set<string>([...columns.participants, ...columns.members])
    if (row.c_user_id !== null) ids.add(row.c_user_id)
    const users = yield* readUsers(ids)
    const info = channelInfoOf(row, columns, selfId, (id) => userName(id, users.get(id)))
    const topic = topicFrom(row, columns, info)
    const title = resolveTitle(topic)
    const channel = channelLabel(info)
    const topicId = row.topic_id as TopicId
    if (row.kind === 'main') {
      const conversation = (yield* sql<{ purpose: string | null; topic: string | null }>`SELECT purpose, topic FROM conversations WHERE id = ${row.channel}`)[0]
      const roots = yield* sql<{ text: string }>`SELECT text FROM messages WHERE channel = ${row.channel} AND (thread_ts IS NULL OR thread_ts = ts) AND deleted = 0 AND text <> ''
        ORDER BY ts DESC LIMIT ${RECENT_MESSAGES}`
      const purpose = oneLine(conversation?.purpose)
      const topicLine = oneLine(conversation?.topic)
      const input: TopicArtInput = {
        kind: 'main',
        topicId,
        channel,
        ...(purpose === '' ? {} : { purpose }),
        ...(topicLine === '' ? {} : { topic: topicLine }),
        recent: roots.map((root) => oneLine(slackLine(root.text))).toReversed(),
        ...(avoid === undefined ? {} : { avoid }),
      }
      return { input, titleSource: title.source }
    }
    const root = row.root_ts === null ? undefined : (yield* sql<{ text: string }>`SELECT text FROM messages WHERE channel = ${row.channel} AND ts = ${row.root_ts} AND deleted = 0`)[0]
    const rootText = columns.preview.rootText ?? root?.text
    const first = oneLine(rootText === undefined ? undefined : slackLine(rootText))
    const last = oneLine(columns.preview.text) || first
    const input: TopicArtInput = { kind: 'thread', topicId, title: title.text, channel, first, last, ...(avoid === undefined ? {} : { avoid }) }
    return { input, titleSource: title.source }
  })

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** Writes the finished attempt and fires `topic_art`, so the sidebar and the header pick the recipe up. */
const storeArt = (
  topicId: string,
  decision: Decision<string>,
  inputHash: string,
  titleSource: string,
  source: 'ai' | 'redraw',
): Effect.Effect<ArtOutcome, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (decision._tag === 'NoDecision' && decision.reason !== 'invalid-output') return decision.reason
    const value = decision._tag === 'Decided' ? decision.value : undefined
    const parsed = value === undefined ? undefined : parseRecipe(value)
    const recipe = parsed?.ok === true ? value! : ''
    const status: ArtOutcome = parsed?.ok === true ? (parsed.recipe.confident ? 'ok' : 'unsure') : 'failed'
    const hue = parsed?.ok === true ? parsed.recipe.hue : ''
    const sql = yield* StoreWriter
    const invalidation = yield* Invalidation
    const now = String(yield* Clock.currentTimeMillis)
    yield* sql`INSERT INTO topic_art (topic_id, recipe, recipe_hash, input_hash, model, status, hue, title_source, source, created_at)
      VALUES (${topicId}, ${recipe}, ${hashOf(recipe)}, ${inputHash}, ${decision.meta.model}, ${status}, ${hue}, ${titleSource}, ${source}, ${now})
      ON CONFLICT (topic_id) DO UPDATE SET recipe = excluded.recipe, recipe_hash = excluded.recipe_hash, input_hash = excluded.input_hash,
        model = excluded.model, status = excluded.status, hue = excluded.hue, title_source = excluded.title_source, source = excluded.source, created_at = excluded.created_at`
    yield* invalidation.invalidate(keys.topicArt)
    return status
  })

/** Puts a drawing back as it was (the undo of a redraw), or removes the row when the topic had none. */
export const restoreArt = (topicId: string, previous: StoredArt | null): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const invalidation = yield* Invalidation
    if (previous === null) yield* sql`DELETE FROM topic_art WHERE topic_id = ${topicId}`
    else
      yield* sql`INSERT INTO topic_art (topic_id, recipe, recipe_hash, input_hash, model, status, hue, title_source, source, created_at)
        VALUES (${topicId}, ${previous.recipe}, ${hashOf(previous.recipe)}, ${previous.inputHash}, ${previous.model}, ${previous.status}, ${previous.hue}, ${previous.titleSource}, ${previous.source}, ${previous.createdAt})
        ON CONFLICT (topic_id) DO UPDATE SET recipe = excluded.recipe, recipe_hash = excluded.recipe_hash, input_hash = excluded.input_hash,
          model = excluded.model, status = excluded.status, hue = excluded.hue, title_source = excluded.title_source, source = excluded.source, created_at = excluded.created_at`
    yield* invalidation.invalidate(keys.topicArt)
  })

/** Asks the model for one topic's drawing and stores what came back. */
export const drawTopic = (
  row: JoinedRow,
  selfId: string | undefined,
  options: { readonly source: 'ai' | 'redraw'; readonly avoid?: TopicArtInput['avoid'] },
): Effect.Effect<ArtOutcome, SqlError, AiProvider | StoreReader | StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const provider = yield* AiProvider
    const { input, titleSource } = yield* artInputOf(row, selfId, options.avoid)
    const decision = yield* provider.generate(tasks.topicArt, input)
    return yield* storeArt(row.topic_id, decision, cacheKeyOf(tasks.topicArt, input).inputHash, titleSource, options.source)
  })
