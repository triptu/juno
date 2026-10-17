/**
 * Removal (plan v3 §4.5, §14.4; SPEC 13.8; specs `agent-memory.qnt`
 * `redact` and `purge`, `agent-recovery.qnt` `raiseDeletion` and `redact`,
 * `agent-actions.qnt` `invalidate("redact")`).
 *
 * One removal, in order:
 *
 * 1. **The deletion record** is raised to the new generation first (G13),
 *    through the backup's hook. It only grows, so a crash after it leaves
 *    the record ahead of the data, which blocks older backups.
 * 2. **The removal transaction**: the messages are tombstoned and `gen`
 *    moves (`redactMemory`), their attachments are deleted, the inbox ops'
 *    text and files are cleared, pins sourced from them are deactivated and cleared
 *    (bumping `pin_rev`), the previews of remove cards that name them are
 *    cleared, quotes of them in later replies and reactions become the
 *    "Removed" placeholder, grants minted by runs that saw the messages are revoked (the
 *    rest carry into the new generation), and reports waiting from jobs started
 *    in runs that saw them are quarantined. The moved `gen` expires every
 *    open card, refuses a waiting click (`sourceChanged`), refuses a request
 *    built before it at the guard, and discards a compaction job that read
 *    the old generation at publication.
 * 3. **In-flight work**: jobs started in runs that saw the messages are
 *    stopped.
 * 4. **Purge**, each step durable and idempotent, retried until done: node
 *    versions that depend on a removed message, then a truncating
 *    checkpoint (`secure_delete` zeroed the freed content), Codex thread files, the pi
 *    journal (rotation), then a sanitized backup generation.
 *
 * Removals run one at a time. The same op again is the same removal.
 */
import { retryDelay } from '@juno/agent-memory'
import { canonicalPayload, decodePayload } from '@juno/agent-cards'
import { memoryGen } from '../actions/cards'
import { revokeExposedGrants } from '../grants/grants'
import { purgeCodexThreads } from '../providers/codex-purge'
import { crashPoint } from '../runtime/crash'
import { invalidateChatCaches } from '../serve/chat'
import { checkpointTruncate, transaction } from '../store/database'
import { purgeNodes, redactMemory } from '../store/memory'
import type { Store } from '../store/store'
import { deleteFiles } from '../router/files'
import { clearQuotes, movePins, removedBubbles } from './quotes'
import { removalScope, runsThatSaw, type ArchiveRow, type OpRow, type RunRow, type Scope } from './scope'

/**
 * The backup's hooks (WP21 implements them). Without a backup there is no
 * deletion record and nothing to regenerate.
 */
export interface RemovalBackup {
  /** Raises the keychain and manifest deletion record to at least `gen`. Durable before it resolves. */
  readonly raiseDeletion: (gen: number) => Promise<void>
  /** Starts a generation from a sanitized snapshot at `gen` or later, then deletes older generations and destroys their keys. Idempotent. */
  readonly regenerate: (gen: number) => Promise<void>
}

export interface RedactionOptions {
  readonly store: Store
  readonly backup?: RemovalBackup
  /** Rotates the pi journal between runs (the router's `rotate`). */
  readonly rotate: () => Promise<void>
  /** Stops a job, as its Task card's Stop does. */
  readonly stopJob?: (jobId: string) => Promise<void>
  /** Cards, the chat and the compactor read the new generation. */
  readonly changed?: () => void
  readonly onReport?: (error: unknown) => void
}

export interface RemoveInput {
  /** The sheet's op, or `card:<action id>` for a remove card. The same op is the same removal. */
  readonly opId: string
  /** Archive ids (`ChatMessageId`s). */
  readonly messageIds: ReadonlyArray<number>
  readonly alsoRemoveReply: boolean
}

export type RemoveResult =
  | { readonly _tag: 'removed'; readonly gen: number; readonly messages: number }
  /** No such message. */
  | { readonly _tag: 'notFound' }

export type PurgeStep = 'nodes' | 'codex' | 'journal' | 'backup'
/** In order: node versions go before the backup snapshot is taken. */
export const PURGE_STEPS: ReadonlyArray<PurgeStep> = ['nodes', 'codex', 'journal', 'backup']
/** §4.5: the journal is rotated within 24 hours. */
export const PURGE_DEADLINE_MS = 24 * 60 * 60_000

export interface PendingPurge {
  readonly gen: number
  readonly step: PurgeStep
  readonly dueBy: number
  readonly attempts: number
  readonly lastError: string | null
}

const archiveRows = (store: Store) =>
  store.db
    .prepare("SELECT id, kind, origin_op AS originOp, incarnation || '/' || entry_id AS entry FROM messages WHERE redacted_gen IS NULL ORDER BY id")
    .all() as unknown as ReadonlyArray<ArchiveRow>

const opRows = (store: Store): ReadonlyArray<OpRow> =>
  (store.db.prepare("SELECT op_id AS opId, json_extract(data, '$.retryOf') AS retryOf FROM inbox WHERE kind = 'retry'").all() as Array<{ opId: string; retryOf: string | null }>)
    .map((row) => (row.retryOf === null ? { opId: row.opId } : { opId: row.opId, retryOf: row.retryOf }))

const runRows = (store: Store): ReadonlyArray<RunRow> =>
  (store.db
    .prepare("SELECT runs.id, runs.h, coalesce(json_group_array(run_inputs.op_id) FILTER (WHERE run_inputs.op_id IS NOT NULL), '[]') AS ops FROM runs LEFT JOIN run_inputs ON run_inputs.run_id = runs.id GROUP BY runs.id")
    .all() as Array<{ id: string; h: number; ops: string }>).map((row) => ({ id: row.id, h: row.h, ops: JSON.parse(row.ops) as string[] }))

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ')

interface Committed {
  readonly gen: number
  readonly messages: number
  /** Running jobs started in runs that saw the messages. */
  readonly jobs: ReadonlyArray<string>
}

/** What the removal would remove now, or its answer when there is nothing to do. */
function plan(store: Store, input: RemoveInput): { readonly archive: ReadonlyArray<ArchiveRow>; readonly scope: Scope } | RemoveResult {
  const { db } = store
  const done = db.prepare('SELECT gen, messages FROM removals WHERE op_id = ?').get(input.opId) as { gen: number; messages: string } | undefined
  if (done !== undefined) return { _tag: 'removed', gen: done.gen, messages: (JSON.parse(done.messages) as number[]).length }
  const exists = input.messageIds.some((id) => db.prepare('SELECT 1 FROM messages WHERE id = ?').get(id) !== undefined)
  if (!exists) return { _tag: 'notFound' }
  const archive = archiveRows(store)
  const scope = removalScope(archive, opRows(store), input.messageIds, input.alsoRemoveReply)
  // Already removed, by another op.
  if (scope.messages.length === 0) return { _tag: 'removed', gen: memoryGen(store), messages: 0 }
  return { archive, scope }
}

/** The removal transaction (step 2). `expected` is the generation the deletion record was raised to. */
function commit(store: Store, input: RemoveInput, expected: number): Committed | RemoveResult {
  const { db, now } = store
  const planned = plan(store, input)
  if ('_tag' in planned) return planned
  const { archive, scope } = planned
  const runs = runsThatSaw(runRows(store), archive, scope.messages)

  // Quotes of what goes become placeholders; this needs the words before they are cleared.
  const removedSet = new Set(scope.messages)
  const bubbles = removedBubbles(store, removedSet)
  const words = new Map(scope.ops.map((op) => [op, (db.prepare('SELECT text FROM inbox WHERE op_id = ?').get(op) as { text: string } | undefined)?.text ?? '']))
  const rewritten = clearQuotes(store, { ops: words, bubbles }, removedSet)
  const memory = redactMemory(store, scope.messages, rewritten)
  // Spec `deletionRecordedBeforeRemoved`: the record was raised to this generation before the commit.
  if (memory.gen !== expected) throw new Error(`the deletion record is at ${expected}, the removal at ${memory.gen}`)
  const ids = memory.removed
  db.prepare(`DELETE FROM attachments WHERE message_id IN (${placeholders(ids.length)})`).run(...ids)
  if (scope.ops.length > 0) {
    db.prepare(`UPDATE inbox SET text = '', data = json_remove(data, '$.files') WHERE op_id IN (${placeholders(scope.ops.length)})`).run(...scope.ops)
    deleteFiles(store, scope.ops)
    const removedOp = db.prepare('INSERT OR IGNORE INTO removed_ops (op_id, gen) VALUES (?, ?)')
    for (const op of scope.ops) removedOp.run(op, memory.gen)
  }
  // §4.4: pins sourced from a removed message go, with every older version's text.
  const pins = db.prepare(`UPDATE pins SET active = 0 WHERE active = 1 AND source_id IN (${placeholders(ids.length)})`).run(...ids)
  db.prepare(`UPDATE pins SET text = '' WHERE source_id IN (${placeholders(ids.length)})`).run(...ids)
  const moved = movePins(store, rewritten)
  if (Number(pins.changes) > 0 || moved) db.prepare('UPDATE memory_head SET pin_rev = pin_rev + 1 WHERE singleton = 1').run()
  const bubble = db.prepare('INSERT OR IGNORE INTO removed_bubbles (bubble_id, gen) VALUES (?, ?)')
  for (const id of bubbles.keys()) bubble.run(id, memory.gen)
  clearRemovePreviews(store, new Set(ids.map(String)))
  revokeExposedGrants(store, new Set(runs), memory.gen)
  // Activity's steps of the runs the removed messages started hold arguments written from them. Later runs keep
  // theirs, as Juno's later replies that quote a removed message stay (SPEC 13.8).
  if (scope.ops.length > 0) {
    db.prepare(`UPDATE run_steps SET args = '', detail = NULL WHERE run_id IN (SELECT run_id FROM run_inputs WHERE op_id IN (${placeholders(scope.ops.length)}))`).run(...scope.ops)
  }

  // §4.5 step 2: jobs from runs that saw the messages stop, and their waiting reports never reach the model.
  const jobs = runs.length === 0 ? [] : (db
    .prepare(`SELECT id FROM jobs WHERE run_id IN (${placeholders(runs.length)}) AND phase NOT IN ('done', 'failed', 'stopped', 'unknown')`)
    .all(...runs) as Array<{ id: string }>).map((row) => row.id)
  const quarantine = db.prepare("UPDATE inbox SET state = 'failed', reason = 'removed', text = '' WHERE kind = 'report' AND state = 'accepted' AND op_id LIKE ? ESCAPE '\\'")
  for (const job of runs.length === 0 ? [] : (db.prepare(`SELECT id FROM jobs WHERE run_id IN (${placeholders(runs.length)})`).all(...runs) as Array<{ id: string }>)) {
    quarantine.run(`report:${job.id.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}:%`)
  }

  db.prepare('INSERT INTO removals (op_id, gen, messages, ops, at) VALUES (?, ?, ?, ?, ?)').run(input.opId, memory.gen, JSON.stringify(ids), JSON.stringify(scope.ops), now())
  const purge = db.prepare('INSERT OR IGNORE INTO redaction_purges (gen, step, at, due_by) VALUES (?, ?, ?, ?)')
  for (const step of PURGE_STEPS) purge.run(memory.gen, step, now(), now() + PURGE_DEADLINE_MS)
  return { gen: memory.gen, messages: ids.length, jobs }
}

/**
 * A remove card shows the first line of each message it names. Once they are
 * gone the line goes too; the card's digest still names the revision the
 * owner approved.
 */
function clearRemovePreviews(store: Store, removed: ReadonlySet<string>): void {
  const rows = store.db
    .prepare("SELECT card_revisions.card_id AS cardId, card_revisions.revision, card_revisions.payload FROM card_revisions JOIN cards ON cards.id = card_revisions.card_id WHERE cards.kind = 'remove'")
    .all() as Array<{ cardId: string; revision: number; payload: string }>
  const update = store.db.prepare('UPDATE card_revisions SET payload = ? WHERE card_id = ? AND revision = ?')
  for (const row of rows) {
    const payload = decodePayload(row.payload)
    if (payload._tag !== 'remove' || !payload.messages.some((m) => removed.has(m.messageId) && m.preview !== '')) continue
    const messages = payload.messages.map((m) => (removed.has(m.messageId) ? { ...m, preview: '' } : m))
    update.run(canonicalPayload({ ...payload, messages }), row.cardId, row.revision)
  }
}

export function createRedaction(options: RedactionOptions) {
  const { store } = options
  const report = options.onReport ?? (() => {})
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <A>(f: () => Promise<A>): Promise<A> => {
    const next = queue.then(f, f)
    queue = next.catch(() => {})
    return next
  }
  let closed = false
  let draining: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const remove = (input: RemoveInput): Promise<RemoveResult> =>
    serial(async () => {
      const planned = plan(store, input)
      if ('_tag' in planned) return planned
      const gen = memoryGen(store) + 1
      await options.backup?.raiseDeletion(gen)
      crashPoint('redaction.deletionRaised')
      const result = transaction(store.db, () => commit(store, input, gen))
      if ('_tag' in result) return result
      crashPoint('redaction.committed')
      // The chat's caches hold the removed rows; drop them before anyone reads the page again.
      invalidateChatCaches(store)
      options.changed?.()
      // Stopping waits for the job's driver; the removal does not.
      for (const job of result.jobs) void options.stopJob?.(job).catch(report)
      kick()
      return { _tag: 'removed', gen: result.gen, messages: result.messages }
    })

  const pending = (): ReadonlyArray<PendingPurge> =>
    (store.db
      .prepare('SELECT gen, step, due_by AS dueBy, attempts, last_error AS lastError FROM redaction_purges WHERE done_at IS NULL ORDER BY gen, at')
      .all() as unknown as PendingPurge[])
      .toSorted((a, b) => PURGE_STEPS.indexOf(a.step) - PURGE_STEPS.indexOf(b.step) || a.gen - b.gen)

  const runStep = async (step: PurgeStep, gen: number): Promise<void> => {
    switch (step) {
      case 'nodes':
        purgeNodes(store)
        // secure_delete zeroed what the removal and this purge freed; the checkpoint puts those pages in the main file.
        checkpointTruncate(store.db)
        return
      case 'codex':
        await purgeCodexThreads(store)
        return
      case 'journal':
        await options.rotate()
        return
      case 'backup':
        await options.backup?.regenerate(gen)
        return
    }
  }

  /** Runs every purge step that is due, in order, until one fails or none is left. */
  const drain = async (): Promise<void> => {
    for (;;) {
      if (closed) return
      // Steps run in order. One run of a step purges everything removed so far, so it settles every
      // removal waiting on it, at the newest generation.
      const waiting = pending()
      const first = waiting[0]
      if (first === undefined) return
      const next = waiting.filter((row) => row.step === first.step).at(-1)!
      const row = store.db.prepare('SELECT attempts, at FROM redaction_purges WHERE gen = ? AND step = ?').get(next.gen, next.step) as { attempts: number; at: number }
      if (row.attempts > 0 && store.now() < row.at + retryDelay(row.attempts)) {
        schedule(row.at + retryDelay(row.attempts) - store.now())
        return
      }
      try {
        await runStep(next.step, next.gen)
      } catch (error) {
        if (closed) return
        report(error)
        store.db
          .prepare('UPDATE redaction_purges SET attempts = attempts + 1, at = ?, last_error = ? WHERE gen = ? AND step = ?')
          .run(store.now(), String((error as Error)?.message ?? error), next.gen, next.step)
        continue
      }
      if (closed) return
      // Every pending row of this step is done by one run of it.
      store.db.prepare('UPDATE redaction_purges SET done_at = ? WHERE step = ? AND gen <= ? AND done_at IS NULL').run(store.now(), next.step, next.gen)
      crashPoint('redaction.purged')
      options.changed?.()
    }
  }

  const schedule = (ms: number) => {
    if (timer !== undefined || closed) return
    timer = setTimeout(() => {
      timer = undefined
      kick()
    }, Math.max(0, ms))
    timer.unref?.()
  }

  const kick = () => {
    if (closed || draining !== undefined) return
    draining = drain()
      .catch(report)
      .finally(() => {
        draining = undefined
      })
  }

  return {
    /** The owner's Remove, or a remove card's click. Resolves once the removal committed. */
    remove,
    /** Purge steps not done yet, in the order they run. */
    pending,
    /** Starts the purge of anything a crash left. */
    start: kick,
    /** Resolves when no purge step runs and none is due now. */
    idle: async () => {
      for (let current = draining; current !== undefined; current = draining) await current
    },
    close: async () => {
      closed = true
      if (timer !== undefined) clearTimeout(timer)
      await queue
    },
  }
}

export type Redaction = ReturnType<typeof createRedaction>
