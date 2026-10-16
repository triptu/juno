/**
 * The words of every conversation and person the pickers can find
 * (`conversation-search.ts` in `@juno/domain`), worked out once per store
 * and kept until a conversation, a person, an ignored channel or the team
 * changes. A keystroke then matches in memory instead of reading the users
 * and conversations tables again (performance 5.3).
 */
import type { PickConversation } from '@juno/contract'
import { indexSubject, matchSubject, searchWords, type IndexedSubject, type SubjectMatch } from '@juno/domain'
import { Invalidation, StoreReader, type InvalidationKeys } from '@juno/store'
import { Effect } from 'effect'
import { parseIds, type UserRow } from '../topicRows'
import { newPerson, pickOf, type ConversationRow } from './picks'

/** A row the pickers can offer, and its words. `empty` is read per search, from the topics. */
export interface IndexEntry {
  readonly pick: PickConversation
  readonly subject: IndexedSubject
}

export interface Found {
  readonly entry: IndexEntry
  readonly match: SubjectMatch
}

const KEYS: InvalidationKeys = ['conversations', 'users', 'ignored_channels', 'team']

interface IndexUser extends UserRow {
  readonly deleted: 0 | 1
  readonly is_bot: 0 | 1
}

/** The names a person goes by: display name, real name and handle. */
const namesOf = (user: UserRow | undefined): ReadonlyArray<string> => (user === undefined ? [] : [user.display_name, user.real_name, user.name].filter((name): name is string => name !== null && name !== ''))

const build = Effect.gen(function* () {
  const sql = yield* StoreReader
  const selfId = (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id ?? undefined
  const users = new Map<string, IndexUser>()
  for (const user of yield* sql<IndexUser>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url, deleted, is_bot FROM users`) users.set(user.id, user)
  const rows = yield* sql<Omit<ConversationRow, 'has_topics'>>`SELECT c.id, c.kind, c.name, c.user_id, c.member_ids_json FROM conversations c
    LEFT JOIN ignored_channels g ON g.channel = c.id
    WHERE g.channel IS NULL AND (c.kind = 'im' OR c.is_member = 1)`
  const entries: Array<IndexEntry> = []
  const withDm = new Set<string>()
  for (const row of rows) {
    const pick = pickOf({ ...row, has_topics: 1 }, users, selfId)
    if (row.kind === 'im') {
      // A DM with someone gone or a bot is not offered, as their name is not.
      const user = row.user_id === null ? undefined : users.get(row.user_id)
      if (user === undefined || user.deleted === 1 || user.is_bot === 1) continue
      withDm.add(user.id)
      entries.push({ pick, subject: indexSubject({ id: row.id, kind: 'im', name: pick.name, people: [namesOf(user)] }) })
      continue
    }
    const people = row.kind === 'mpim' ? parseIds(row.member_ids_json).flatMap((id) => (id === selfId ? [] : [namesOf(users.get(id))])) : []
    entries.push({ pick, subject: indexSubject({ id: row.id, kind: row.kind, name: pick.name, people }) })
  }
  for (const user of users.values()) {
    if (user.deleted === 1 || user.is_bot === 1 || withDm.has(user.id)) continue
    const pick = newPerson(user)
    entries.push({ pick, subject: indexSubject({ id: pick.key, kind: 'im', name: pick.name, people: [namesOf(user)] }) })
  }
  return entries
})

/** Per store: the entries, or undefined once something they read changed; the generation guards a build that raced a change. */
const held = new WeakMap<object, { entries: ReadonlyArray<IndexEntry> | undefined; generation: number }>()

const entriesOf = Effect.gen(function* () {
  const invalidation = yield* Invalidation
  let cache = held.get(invalidation)
  if (cache === undefined) {
    const created: { entries: ReadonlyArray<IndexEntry> | undefined; generation: number } = { entries: undefined, generation: 0 }
    invalidation.subscribeUnsafe(KEYS, () => {
      created.entries = undefined
      created.generation++
    })
    held.set(invalidation, created)
    cache = created
  }
  if (cache.entries !== undefined) return cache.entries
  const generation = cache.generation
  const entries = yield* build
  if (cache.generation === generation) cache.entries = entries
  return entries
})

/** Every entry that matches `text`, with how it matched. Empty for text with no words. */
export const searchEntries = (text: string) =>
  Effect.gen(function* () {
    const words = searchWords(text)
    if (words.length === 0) return []
    const found: Array<Found> = []
    for (const entry of yield* entriesOf) {
      const match = matchSubject(entry.subject, words)
      if (match !== undefined) found.push({ entry, match })
    }
    return found
  })
