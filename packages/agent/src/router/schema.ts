/**
 * The router's tables (plan v3 §5.2, §8). Replicated records: a backup keeps
 * them. Steps are append-only.
 */
import type { MigrationSet } from '../store/schema'

const turns1 = [
  // One run: from an idle input to its ending. `op_id` is the input that started it; `h` is the
  // history cutoff H, the archive length before that input (§5.2). `clean` is cleared once the run
  // reads untrusted content (§6.4). `ending` is the chat contract's `Ending`, set when the run ends.
  `CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    op_id TEXT NOT NULL UNIQUE,
    origin TEXT NOT NULL CHECK (origin IN ('owner', 'wake', 'report', 'click')),
    h INTEGER NOT NULL CHECK (h >= 0),
    clean INTEGER NOT NULL CHECK (clean IN (0, 1)),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    ending TEXT CHECK (ending IS NULL OR json_valid(ending)),
    CHECK ((ended_at IS NULL) = (ending IS NULL))
  ) STRICT`,
  'CREATE UNIQUE INDEX runs_one_live ON runs ((ended_at IS NULL)) WHERE ended_at IS NULL',
  // Every inbox op delivered into a run: its first input and its steers.
  `CREATE TABLE run_inputs (
    op_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs (id),
    steer INTEGER NOT NULL CHECK (steer IN (0, 1))
  ) STRICT`,
  'CREATE INDEX run_inputs_by_run ON run_inputs (run_id)',
]

const turns2 = [
  // Reactions on chat items, by either side; the latest row per (target, by) is the state, and a null
  // emoji removes it. Targets: a Juno bubble (<runId>:<n>), a card, or an owner message (its op).
  // A reaction is never a click and never a pin.
  `CREATE TABLE reactions (
    seq INTEGER PRIMARY KEY,
    op_id TEXT NOT NULL UNIQUE,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('bubble', 'card', 'owner')),
    target_id TEXT NOT NULL,
    by TEXT NOT NULL CHECK (by IN ('owner', 'juno')),
    emoji TEXT,
    at INTEGER NOT NULL
  ) STRICT`,
  'CREATE INDEX reactions_by_target ON reactions (target_kind, target_id, by, seq)',
]

const turns3 = [
  // The run's handle table (plan v3 §19.1): each Slack message a read returned in the run gets the
  // next handle, m1, m2, …, once. A `<src m="m3">` in the run's bubbles resolves here, and only here.
  // `place` is the channel's name as the owner sees it ("#eng"), when the host gave one.
  `CREATE TABLE sources (
    run_id TEXT NOT NULL REFERENCES runs (id),
    handle TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    place TEXT,
    PRIMARY KEY (run_id, handle),
    UNIQUE (run_id, channel_id, ts)
  ) STRICT`,
]

const turns4 = [
  // Images and text files an owner message gave Juno (SPEC 12, 13.1), by the message's op and their
  // place in it. `body` is an image's base64 or a text file's text: what the model reads. It is
  // cleared once the op's run is done, since only the run it arrived in sends it; `thumb` stays for
  // the bubble. A removal deletes the rows.
  `CREATE TABLE inbox_files (
    op_id TEXT NOT NULL,
    n INTEGER NOT NULL CHECK (n >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('image', 'text')),
    mime TEXT,
    thumb TEXT,
    body TEXT,
    PRIMARY KEY (op_id, n)
  ) STRICT`,
]

const turns5 = [
  // Each tool call the model made in a run, for Activity (SPEC 13.9). Written before the call runs and
  // ended once, so a call cut off by a crash reads as unfinished. Nested calls a script made are in
  // `script_calls`. `args` is the call's arguments as the model wrote them, cut to a few hundred
  // bytes. `detail` is what came back, in a shape that never holds what Juno read: a count of lines
  // for a read's result, the first line of Juno's own tools' text, or an error's text. A removal
  // clears both for the runs that saw the removed messages.
  `CREATE TABLE run_steps (
    run_id TEXT NOT NULL REFERENCES runs (id),
    call_id TEXT NOT NULL,
    seq INTEGER NOT NULL CHECK (seq >= 0),
    tool TEXT NOT NULL,
    args TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('running', 'done', 'failed')),
    detail TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    PRIMARY KEY (run_id, call_id)
  ) STRICT`,
  // The model requests a run made, per model: how many and what they cost, as the guard reported.
  // `cost` is null while any request's cost is unknown. `name` is the model's name for people.
  `CREATE TABLE run_usage (
    run_id TEXT NOT NULL REFERENCES runs (id),
    model TEXT NOT NULL,
    name TEXT NOT NULL,
    requests INTEGER NOT NULL CHECK (requests > 0),
    cost REAL CHECK (cost IS NULL OR cost >= 0),
    PRIMARY KEY (run_id, model)
  ) STRICT`,
  // Activity reads the newest runs first, a window at a time.
  'CREATE INDEX runs_by_start ON runs (started_at DESC, id DESC) WHERE ended_at IS NOT NULL',
]

const turns6 = [
  // A reply's thread, so a source Juno found through Slack search opens in its thread even when this Mac has no copy.
  'ALTER TABLE sources ADD COLUMN thread_ts TEXT',
]

export const TURNS_MIGRATIONS: MigrationSet = { name: 'turns', steps: [turns1, turns2, turns3, turns4, turns5, turns6] }
