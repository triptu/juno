/**
 * Backup bookkeeping (plan v3 §14.4, G12). Local to this Mac: capture
 * never attaches to it and a snapshot carries no rows of it, so writing
 * the export cursor never makes a change to export. Steps are append-only.
 */
import { OWNERSHIP_LOCAL_TABLES } from '../ownership/schema'
import { PROVIDER_LOCAL_TABLES } from '../spend/schema'
import { LOCAL_TABLES as CORE_LOCAL_TABLES, type MigrationSet } from '../store/schema'

const backup1 = [
  // The generation this Mac writes and how far its published manifest reaches.
  //   folder     the owner's backup folder; null is the default (`<agentDir>/backup`)
  //   gen        the generation being written; 0 before the first
  //   head       the last segment the published manifest names: the export cursor (spec `exportCursor`)
  //   head_hash  that segment's hash, or the snapshot's at head 0
  //   label      the removals the generation's snapshot excludes: max(memory gen, deletion record) when taken
  //   memory_gen the memory generation when the snapshot was taken
  //   nonce      the last nonce reserved under the generation's key (spec `nextNonce`)
  //   clean      1 when the last close exported every change; a start that finds 0 begins a new generation
  //   last_at    when the last manifest was published
  //   phrase_at  when the recovery phrase was last exported
  //   phrase     the backup key wrapped by the recovery phrase, as JSON; every manifest carries it
  `CREATE TABLE backup_progress (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    folder TEXT,
    gen INTEGER NOT NULL DEFAULT 0 CHECK (gen >= 0),
    head INTEGER NOT NULL DEFAULT 0 CHECK (head >= 0),
    head_hash TEXT NOT NULL DEFAULT '',
    label INTEGER NOT NULL DEFAULT 0,
    memory_gen INTEGER NOT NULL DEFAULT 0,
    nonce INTEGER NOT NULL DEFAULT 0,
    clean INTEGER NOT NULL DEFAULT 0 CHECK (clean IN (0, 1)),
    last_at INTEGER,
    phrase_at INTEGER,
    phrase TEXT CHECK (phrase IS NULL OR json_valid(phrase))
  ) STRICT`,
]

export const BACKUP_MIGRATIONS: MigrationSet = { name: 'backup', steps: [backup1] }

export const BACKUP_LOCAL_TABLES: ReadonlyArray<string> = ['backup_progress']

/** Every folder's local tables: what a backup never carries. Add a folder's list here with its migrations. */
export const LOCAL_TABLES: ReadonlyArray<string> = [...CORE_LOCAL_TABLES, ...PROVIDER_LOCAL_TABLES, ...BACKUP_LOCAL_TABLES, ...OWNERSHIP_LOCAL_TABLES]
