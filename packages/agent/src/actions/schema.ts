/**
 * The action ledger's own tables (plan v3 §6.1, §6.4, §12, §19.5). The core
 * set (`store/schema.ts`) already holds `authorizations`, `attempts` and
 * `receipts`; these add what comes before them and beside them. Replicated
 * records: a backup keeps them, and a restore voids approvals (WP21).
 * Steps are append-only.
 *
 * Ids are UUIDv7, global across restores. Rows in `card_revisions`,
 * `intents` and `approvals` are never updated: an edit appends a revision,
 * and a click appends approvals.
 */
import type { MigrationSet } from '../store/schema'

const actions1 = [
  // One card Juno proposed, under the run that proposed it. `call_id` names what proposed it (a tool
  // call, or a run's budget ending), so a replayed call finds the same card. `revision` is the current
  // one in `card_revisions`. `dismissed_at` is set by Dismiss, Skip, Wait until tomorrow, and Keep on a
  // remove card; the click that answered the card is in `approvals`. `replaced_by` is a newer card
  // that corrects this one (§19.6); the older card then expires.
  `CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    call_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    created_at INTEGER NOT NULL,
    source_gen INTEGER NOT NULL,
    dismissed_at INTEGER,
    replaced_by TEXT
  ) STRICT`,
  'CREATE INDEX cards_by_run ON cards (run_id)',
  // Every stored revision of a card's payload (agent-cards `CardPayload`, canonical JSON), with its digest.
  // The card renders from it and a click approves it.
  `CREATE TABLE card_revisions (
    card_id TEXT NOT NULL REFERENCES cards (id),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    digest TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (card_id, revision)
  ) STRICT`,
  // §6.1 Intents: one per child action revision (agent-cards `ChildAction`). `payload` is the executable
  // identity (§6.2) and `digest` its JCS SHA-256. `source` is the memory generation it was proposed in;
  // a redaction moves the generation and voids it. `authorizations.intent_id` names a row here.
  `CREATE TABLE intents (
    id TEXT PRIMARY KEY,
    action_id TEXT NOT NULL,
    rev INTEGER NOT NULL CHECK (rev >= 1),
    card_id TEXT NOT NULL REFERENCES cards (id),
    card_revision INTEGER NOT NULL,
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    digest TEXT NOT NULL,
    tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
    deduped INTEGER NOT NULL CHECK (deduped IN (0, 1)),
    source INTEGER NOT NULL,
    at INTEGER NOT NULL,
    UNIQUE (action_id, rev)
  ) STRICT`,
  'CREATE INDEX intents_by_card ON intents (card_id, card_revision)',
  // §6.1 Approvals: the owner's click, one row per child it approves, in the card's stored order
  // (`position`). `op_id` is the click's operation id from the renderer: the same click again is the same
  // rows. A button's data (an option, a reply) is in the payload it approves (`agent.cards.prepare`).
  // `refused` is set when the dispatcher
  // would not authorize the approval (expired, source changed, already authorized): the click never ran.
  `CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    op_id TEXT NOT NULL,
    card_id TEXT NOT NULL REFERENCES cards (id),
    card_revision INTEGER NOT NULL,
    intent_id TEXT NOT NULL REFERENCES intents (id),
    position INTEGER NOT NULL CHECK (position >= 0),
    at INTEGER NOT NULL,
    refused TEXT,
    UNIQUE (op_id, intent_id)
  ) STRICT`,
  'CREATE INDEX approvals_by_card ON approvals (card_id)',
  'CREATE INDEX approvals_by_intent ON approvals (intent_id)',
  // §6.4 Grants. `op_class` is what the grant allows (`job`: steer and stop one job; `schedule`: one
  // schedule's wakes). `target` is the job or schedule id, `bounds` its scope (a schedule's revision).
  // `authority` is the owner authority that minted it, `source_op` that authority's op (the clean run's
  // input, the click, the menu op), and `source_gen` the memory generation it is valid in: the one it was
  // minted in, or a later one a removal carried it into. The model never names a grant. Pause, AI off, a
  // removal (only when the minting run saw the removed messages), a job's Stop and a schedule's deletion revoke it.
  `CREATE TABLE grants (
    id TEXT PRIMARY KEY,
    op_class TEXT NOT NULL CHECK (op_class IN ('job', 'schedule')),
    target TEXT NOT NULL,
    bounds TEXT NOT NULL CHECK (json_valid(bounds)),
    authority TEXT NOT NULL CHECK (authority IN ('cleanRun', 'click', 'menu')),
    source_op TEXT NOT NULL,
    source_gen INTEGER NOT NULL,
    at INTEGER NOT NULL,
    revoked_at INTEGER,
    revoked_by TEXT CHECK (revoked_by IS NULL OR revoked_by IN ('pause', 'off', 'redaction', 'stop', 'delete')),
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
  ) STRICT`,
  'CREATE UNIQUE INDEX grants_one_live ON grants (op_class, target) WHERE revoked_at IS NULL',
  // What the destination said about an authorization that did not land: a rejection's reason, or why
  // it is unknown. Activity's "Copy details". Never shown in the chat, never sent to the model.
  `CREATE TABLE action_results (
    authorization_id TEXT PRIMARY KEY,
    detail TEXT NOT NULL,
    at INTEGER NOT NULL
  ) STRICT`,
  // §19.5 What the model is told about a settled card, once, with the next input it reads. `carried_by`
  // is that input's op: the outcome is in its text, and stays there if the op is delivered again.
  `CREATE TABLE card_outcomes (
    card_id TEXT PRIMARY KEY REFERENCES cards (id),
    outcome TEXT NOT NULL CHECK (outcome IN ('declined', 'expired', 'done', 'failed')),
    summary TEXT NOT NULL,
    at INTEGER NOT NULL,
    carried_by TEXT
  ) STRICT`,
  'CREATE INDEX card_outcomes_waiting ON card_outcomes (carried_by, at)',
]

const actions2 = [
  // The owner's rules (Settings › Juno), in order. Only Settings writes them.
  `CREATE TABLE owner_rules (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL
  ) STRICT`,
]

export const ACTIONS_MIGRATIONS: MigrationSet = { name: 'actions', steps: [actions1, actions2, ['ALTER TABLE cards ADD COLUMN expired_at INTEGER'], ['CREATE TABLE resolve_undos (card_id TEXT PRIMARY KEY REFERENCES cards(id))'],
  // A connection call the auto-review ran with no click keeps its card row, so the ledger and Activity
  // see it, but the chat never shows it and it takes no click.
  ['ALTER TABLE cards ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0'],
  // What a connection call a click ran gave back: `model` for the model's next input (untrusted, bounded),
  // `line` for the card's one result line. Both may be empty.
  [`CREATE TABLE action_outputs (
    attempt_id TEXT PRIMARY KEY REFERENCES attempts (id),
    model TEXT,
    line TEXT
  ) STRICT`]] }
