/**
 * The schema of `agent.sqlite` (plan v3 §2.2, §3, §4.1, §6.1, §6.5).
 *
 * Migrations are named sets, each owned by one folder: `core` here, and later
 * sets such as `spend` (WP9) or `backup` (WP21) in their own folders. A set
 * is an ordered list; its steps are applied in order, each in its own FULL
 * transaction with its row in `schema_migrations`. A step is never edited
 * after it ships: append a new one.
 *
 * A database that records a step this build does not know was written by a
 * newer Juno. It is not opened for writing; the agent shows "Juno needs to
 * update its records" (`StoreTooNew`).
 *
 * Every table is STRICT. Ids that cross the wire are UUIDv7 text; archive
 * message ids are dense integers from 0, the memory's source ids.
 */

export interface MigrationSet {
  /** Unique across sets, for example `core` or `spend`. */
  readonly name: string
  /** Applied in order. Never edit or remove a shipped step. */
  readonly steps: ReadonlyArray<ReadonlyArray<string>>
}

/**
 * Tables that describe this device, not the owner's data. A backup never
 * captures them and a restore starts them fresh (plan v3 §14.4, G12): the
 * migration log (a snapshot keeps it as its schema), the run mode and the
 * ownership row (the backup manifest carries ownership instead). Later sets
 * add theirs (the export cursor, the model catalogue cache).
 *
 * `incarnations` is carried: archive messages and inbox ops reference it.
 * A restore retires every carried incarnation and starts a new one.
 */
export const LOCAL_TABLES: ReadonlyArray<string> = ['schema_migrations', 'control', 'ownership']

const core1 = [
  // Which migration steps this database has. `set` and `step` name a step in a MigrationSet.
  `CREATE TABLE schema_migrations (
    "set" TEXT NOT NULL,
    step INTEGER NOT NULL,
    applied_at INTEGER NOT NULL,
    PRIMARY KEY ("set", step)
  ) STRICT`,

  // §6.5 and §13.2: on, paused (sends wait for Resume) or off (the composer is disabled).
  // Pause and off stop new authorizations; they survive a restart.
  `CREATE TABLE control (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    mode TEXT NOT NULL CHECK (mode IN ('on', 'paused', 'off')),
    at INTEGER NOT NULL
  ) STRICT`,

  // §14.1. WP21 owns the transitions; the dispatcher checks state = 'active'.
  `CREATE TABLE ownership (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    device_id TEXT NOT NULL,
    epoch INTEGER NOT NULL CHECK (epoch >= 1),
    state TEXT NOT NULL CHECK (state IN ('active', 'released', 'recovery')),
    at INTEGER NOT NULL
  ) STRICT`,

  // §3 Incarnations. Each pi journal file pi-<id>.sqlite has one. Exactly one is current
  // (retired_at IS NULL). An id is never reused. `cursor` is the archive cursor: the pi commit
  // sequence of the last projected commit of this incarnation (spec `cursor`).
  `CREATE TABLE incarnations (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
    retired_at INTEGER,
    retired_reason TEXT CHECK (retired_reason IN ('rotation', 'rollback', 'restore')),
    CHECK ((retired_at IS NULL) = (retired_reason IS NULL))
  ) STRICT`,
  'CREATE UNIQUE INDEX incarnations_one_current ON incarnations ((retired_at IS NULL)) WHERE retired_at IS NULL',

  // §3 Inbox. Owner input is durable here before the renderer clears it (spec `inbox` before `ack`).
  // seq is acceptance order. state:
  //   accepted    durable, not yet in the journal
  //   submitted   in the journal of `incarnation` as `submission_id` (spec `submitted`)
  //   done        its run answered
  //   interrupted its run will not finish: a rollback or rotation, or pi gave up (spec `interrupted`)
  //   (core3 rebuilds this table: kind `react` joins, `stopped` goes)
  //   failed      refused before a run (for example AI off)
  `CREATE TABLE inbox (
    seq INTEGER PRIMARY KEY,
    op_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('send', 'steer', 'retry', 'wake', 'report', 'click')),
    text TEXT NOT NULL,
    data TEXT CHECK (data IS NULL OR json_valid(data)),
    at INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('accepted', 'submitted', 'done', 'interrupted', 'stopped', 'failed')),
    incarnation TEXT REFERENCES incarnations (id),
    submission_id TEXT,
    ended_at INTEGER,
    reason TEXT,
    CHECK (state != 'submitted' OR (incarnation IS NOT NULL AND submission_id IS NOT NULL))
  ) STRICT`,
  'CREATE INDEX inbox_by_state ON inbox (state, seq)',

  // §4.1 The archive. One row is one chunk of at most 16 KB of one pi entry. Ids are dense from 0
  // and never reassigned (the memory's source ids). Source bytes are kept whole across chunks.
  // source_pos is the pi commit sequence that projected it.
  `CREATE TABLE messages (
    id INTEGER PRIMARY KEY CHECK (id >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('user', 'juno', 'tool', 'echo', 'work', 'wake', 'card', 'note')),
    text TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes >= 0 AND bytes <= 16384),
    at INTEGER NOT NULL,
    origin_op TEXT,
    incarnation TEXT NOT NULL REFERENCES incarnations (id),
    source_pos INTEGER NOT NULL,
    entry_id INTEGER NOT NULL,
    chunk INTEGER NOT NULL CHECK (chunk >= 0),
    version INTEGER NOT NULL DEFAULT 1,
    redacted_gen INTEGER,
    UNIQUE (incarnation, entry_id, chunk)
  ) STRICT`,
  'CREATE INDEX messages_by_origin ON messages (origin_op, id)',
  // §3 The structured pi entry behind a tool call or result, kept whole. Keyed by its first chunk.
  `CREATE TABLE attachments (
    message_id INTEGER PRIMARY KEY REFERENCES messages (id),
    body TEXT NOT NULL CHECK (json_valid(body))
  ) STRICT`,

  // §4.1 Memory. Keys are aligned intervals [a, a + w) as in @juno/agent-memory (plan: (l, i) with
  // w = 2^l, a = i * w). Nodes are immutable; a rebuild is a new ver. sources, inputs (exact child
  // refs) and context (raw message ids read) are JSON arrays; deps is their cached closure.
  `CREATE TABLE nodes (
    a INTEGER NOT NULL CHECK (a >= 0),
    w INTEGER NOT NULL CHECK (w >= 1),
    ver INTEGER NOT NULL CHECK (ver >= 1),
    text TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes <= 16384),
    cut INTEGER NOT NULL CHECK (cut IN (0, 1)),
    sources TEXT NOT NULL CHECK (json_valid(sources)),
    inputs TEXT NOT NULL CHECK (json_valid(inputs)),
    context TEXT NOT NULL CHECK (json_valid(context)),
    deps TEXT NOT NULL CHECK (json_valid(deps)),
    input_digest TEXT NOT NULL,
    model TEXT,
    prompt_ver INTEGER,
    gen INTEGER NOT NULL,
    built_at INTEGER NOT NULL,
    PRIMARY KEY (a, w, ver)
  ) STRICT`,
  // §4.2 The published head. rev advances by compare-and-swap; batch is set while a merge batch runs.
  `CREATE TABLE memory_head (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    rev INTEGER NOT NULL,
    gen INTEGER NOT NULL,
    pin_rev INTEGER NOT NULL,
    batch INTEGER NOT NULL CHECK (batch IN (0, 1))
  ) STRICT`,
  // entries: ordered [{ node: [a, w, ver] } | { masked: [a, w] }] covering [0, covered).
  `CREATE TABLE view_rev (
    rev INTEGER PRIMARY KEY,
    gen INTEGER NOT NULL,
    covered INTEGER NOT NULL,
    entries TEXT NOT NULL CHECK (json_valid(entries))
  ) STRICT`,
  // §4.1 Compaction work. A row exists while the key has no clean current node.
  `CREATE TABLE queue (
    a INTEGER NOT NULL,
    w INTEGER NOT NULL,
    due_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    PRIMARY KEY (a, w)
  ) STRICT`,
  'CREATE INDEX queue_by_due ON queue (due_at, a)',
  // §4.4 Pins. One row per version; an owner edit supersedes the version it names.
  `CREATE TABLE pins (
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('span', 'owner')),
    source_id INTEGER NOT NULL,
    source_version INTEGER NOT NULL,
    from_byte INTEGER,
    to_byte INTEGER,
    text TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    supersedes INTEGER,
    at INTEGER NOT NULL,
    PRIMARY KEY (id, version)
  ) STRICT`,
  'CREATE INDEX pins_active ON pins (active, source_id)',
  // §4.5 Tombstones. WP16 writes them.
  `CREATE TABLE redactions (
    message_id INTEGER PRIMARY KEY,
    gen INTEGER NOT NULL,
    at INTEGER NOT NULL
  ) STRICT`,

  // §6.1 The part of the action ledger that startup classifies (§6.5). WP15 adds intents, approvals
  // and grants. One authorization is consumed before transport; attempts are transport submissions;
  // receipts are evidence and are never overwritten. outcome:
  //   consumed          authorized, not yet handed to transport
  //   sent              an attempt is with the transport
  //   cancel-requested  Pause or AI off asked it to stop
  //   cancelled         stopped before any attempt
  //   unknown           no receipt and no definite rejection; reconcile works on it
  //   done | failed     evidence decided it
  `CREATE TABLE authorizations (
    id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL,
    child INTEGER NOT NULL DEFAULT 0,
    approval_id TEXT,
    grant_id TEXT,
    epoch INTEGER NOT NULL,
    origin_op TEXT,
    consumed_at INTEGER NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('consumed', 'sent', 'cancel-requested', 'cancelled', 'unknown', 'done', 'failed')),
    CHECK (approval_id IS NOT NULL OR grant_id IS NOT NULL)
  ) STRICT`,
  'CREATE INDEX authorizations_open ON authorizations (outcome) WHERE outcome IN (\'consumed\', \'sent\', \'cancel-requested\')',
  `CREATE TABLE attempts (
    id TEXT PRIMARY KEY,
    authorization_id TEXT NOT NULL REFERENCES authorizations (id),
    at INTEGER NOT NULL
  ) STRICT`,
  'CREATE INDEX attempts_by_authorization ON attempts (authorization_id)',
  `CREATE TABLE receipts (
    attempt_id TEXT PRIMARY KEY REFERENCES attempts (id),
    evidence TEXT NOT NULL CHECK (json_valid(evidence)),
    at INTEGER NOT NULL
  ) STRICT`,
]

const core2 = [
  // The highest journal position at which an action of this incarnation was authorized. Recovery
  // never resumes a journal file behind it, so a resumed file always holds the authorized tool
  // call's execute intent, and pi does not run that call again (spec `authorizedOnce`).
  'ALTER TABLE incarnations ADD COLUMN authorized_seq INTEGER NOT NULL DEFAULT 0 CHECK (authorized_seq >= 0)',
]

const core3 = [
  // The owner's reactions enter the inbox as `react` (any emoji but a thumbs up). There is no Stop, so
  // no op settles `stopped` again; an old one reads as `interrupted`. SQLite cannot alter a CHECK, so
  // the table is rebuilt.
  `CREATE TABLE inbox_next (
    seq INTEGER PRIMARY KEY,
    op_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('send', 'steer', 'retry', 'react', 'wake', 'report', 'click')),
    text TEXT NOT NULL,
    data TEXT CHECK (data IS NULL OR json_valid(data)),
    at INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('accepted', 'submitted', 'done', 'interrupted', 'failed')),
    incarnation TEXT REFERENCES incarnations (id),
    submission_id TEXT,
    ended_at INTEGER,
    reason TEXT,
    CHECK (state != 'submitted' OR (incarnation IS NOT NULL AND submission_id IS NOT NULL))
  ) STRICT`,
  `INSERT INTO inbox_next SELECT seq, op_id, kind, text, data, at,
     CASE state WHEN 'stopped' THEN 'interrupted' ELSE state END, incarnation, submission_id, ended_at, reason FROM inbox`,
  'DROP TABLE inbox',
  'ALTER TABLE inbox_next RENAME TO inbox',
  'CREATE INDEX inbox_by_state ON inbox (state, seq)',
]

export const CORE_MIGRATIONS: MigrationSet = { name: 'core', steps: [core1, core2, core3] }
