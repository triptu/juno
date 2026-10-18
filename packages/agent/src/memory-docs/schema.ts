/**
 * Juno's memory of the owner (SPEC 13.8): the docs' entries, every write to
 * them, and Juno's proactive asks. Replicated records, so the backup and a
 * move carry them. Steps are append-only.
 */
import type { MigrationSet } from '../store/schema'

const docs1 = [
  // One entry of a doc. `id` is what the model names ("e12"); a deleted entry keeps its row, with
  // its text cleared, so an id is never reused. `source` is where it came from: the owner's words,
  // Slack, or a connection (`connection` names it). `tainted`: written in a run that had read outside
  // content. `version` moves on every change, for the page's edits and Undo.
  `CREATE TABLE memory_entries (
    id INTEGER PRIMARY KEY,
    doc TEXT NOT NULL CHECK (doc IN ('you', 'people', 'projects', 'preferences', 'style')),
    text TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('owner', 'slack', 'connection')),
    connection TEXT,
    tainted INTEGER NOT NULL CHECK (tainted IN (0, 1)),
    version INTEGER NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT`,
  // Every change to an entry, for the page's list and Undo. `run_id` is the chat run that made it,
  // or `learn:<ask id>` for a learning pass, or null for the owner's own edit on the page. The id is
  // derived from the tool call, so a replayed call finds its write. `before` and `after` are the
  // entry's text around the change; an owner delete clears them.
  `CREATE TABLE memory_writes (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    entry_id INTEGER NOT NULL REFERENCES memory_entries(id),
    doc TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('add', 'update', 'remove')),
    by TEXT NOT NULL CHECK (by IN ('juno', 'owner')),
    before_text TEXT,
    after_text TEXT,
    before_version INTEGER,
    after_version INTEGER NOT NULL,
    source TEXT NOT NULL,
    connection TEXT,
    tainted INTEGER NOT NULL CHECK (tainted IN (0, 1)),
    at INTEGER NOT NULL,
    undone_at INTEGER
  ) STRICT`,
  'CREATE INDEX memory_writes_by_run ON memory_writes (run_id)',
  'CREATE INDEX memory_writes_by_entry ON memory_writes (entry_id)',
  // `rev` moves with every change, so the outline in a request names the memory it showed.
  `CREATE TABLE memory_docs_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    rev INTEGER NOT NULL
  ) STRICT`,
  // A proactive ask: Juno offers to do something the owner may want, in the chat and as a Home
  // card. `kind` is what it offers (`learn`: a pass that learns about the owner). `reason` is why
  // now: after setup, or because a connection that holds the owner's context was added
  // (`connection` names it, '' otherwise). `state` moves open → running → done | failed | stopped,
  // or open → dismissed. `covered`: a connection the setup pass reads, never shown. `line` is the
  // running pass's live line, `result` what it did, as JSON.
  `CREATE TABLE juno_asks (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('learn')),
    reason TEXT NOT NULL CHECK (reason IN ('setup', 'connection')),
    connection TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL CHECK (state IN ('open', 'running', 'done', 'failed', 'stopped', 'dismissed', 'covered')),
    line TEXT,
    result TEXT CHECK (result IS NULL OR json_valid(result)),
    at INTEGER NOT NULL,
    settled_at INTEGER,
    UNIQUE (kind, reason, connection)
  ) STRICT`,
]

const docs2 = [
  // Person files (SPEC 13.8): an entry of the People doc may belong to one person's file, keyed by
  // their Slack user id, in one of four sections. An entry with no person is a general People note.
  'ALTER TABLE memory_entries ADD COLUMN person TEXT',
  "ALTER TABLE memory_entries ADD COLUMN section TEXT CHECK (section IS NULL OR section IN ('role', 'work', 'talk', 'notes'))",
  'CREATE INDEX memory_entries_by_person ON memory_entries (person) WHERE person IS NOT NULL',
  'ALTER TABLE memory_writes ADD COLUMN person TEXT',
  // One row per person file. `relationship` is Juno's guess or the owner's choice (`relationship_by`).
  // `reason` is why the file exists: the owner and they exchange messages, the owner asked, or a note
  // of the older People doc named them. `owner_count`, `them_count` and `last_at` are what they
  // exchanged in DMs and threads in the last 60 days, counted at most daily (`counted_at`), so the
  // outline's order holds between counts. `learned_at` is Juno's last background update of the file.
  // A file the owner deleted keeps its row as `deleted`, with no name, so Juno does not start it again
  // on its own.
  `CREATE TABLE memory_people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    relationship TEXT CHECK (relationship IS NULL OR relationship IN ('manager', 'report', 'peer', 'skip', 'crossTeam', 'external', 'customer')),
    relationship_by TEXT CHECK (relationship_by IS NULL OR relationship_by IN ('juno', 'owner')),
    reason TEXT NOT NULL CHECK (reason IN ('interaction', 'asked', 'split')),
    owner_count INTEGER NOT NULL DEFAULT 0,
    them_count INTEGER NOT NULL DEFAULT 0,
    last_at INTEGER,
    counted_at INTEGER,
    learned_at INTEGER,
    state TEXT NOT NULL CHECK (state IN ('active', 'deleted')),
    version INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT`,
  // `people_rev` moves with a change to a person file's entries, which the outline does not show, so
  // an ordinary update leaves the outline (and the cached prefix) alone. `people_split`: the older
  // People doc's notes were split into files once.
  'ALTER TABLE memory_docs_state ADD COLUMN people_rev INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE memory_docs_state ADD COLUMN people_split INTEGER NOT NULL DEFAULT 0',
]

export const MEMORY_DOCS_MIGRATIONS: MigrationSet = { name: 'memory_docs', steps: [docs1, docs2] }
