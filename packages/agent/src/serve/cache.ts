/** Connection-local revisions: writes and rollbacks invalidate together, including archive edits. */
import type { Store } from '../store/store'

const tables = ['inbox', 'messages', 'runs', 'run_inputs', 'reactions', 'sources', 'chat_bubbles', 'jobs', 'tool_blocks'] as const
type Table = typeof tables[number]

export function chatRevisions(store: Store) {
  const { db } = store
  db.exec('CREATE TEMP TABLE IF NOT EXISTS chat_cache_revision (name TEXT PRIMARY KEY, rev INTEGER NOT NULL)')
  for (const table of tables) {
    db.prepare('INSERT OR IGNORE INTO chat_cache_revision VALUES (?, 0)').run(table)
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
      db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS chat_cache_${table}_${action} AFTER ${action} ON main.${table}
        BEGIN UPDATE chat_cache_revision SET rev = rev + 1 WHERE name = '${table}'; END`)
    }
  }
  const read = db.prepare('SELECT name, rev FROM chat_cache_revision')
  return () => {
    const revisions = new Map(read.all().map((row) => [String(row.name), Number(row.rev)]))
    return (...names: ReadonlyArray<Table>) => names.map((name) => revisions.get(name))
  }
}

/** One typed computation; callers list every input that affects its result. A build gets the last value, to keep unchanged parts. */
export function memo<A>() {
  let previous: { readonly inputs: ReadonlyArray<unknown>; readonly value: A } | undefined
  return (inputs: ReadonlyArray<unknown>, build: (last: A | undefined) => A): A => {
    if (previous !== undefined && same(inputs, previous.inputs)) return previous.value
    const value = build(previous?.value)
    previous = { inputs, value }
    return value
  }
}

/** Sweep keys no longer present so removed runs and rows do not retain their text. */
export function keyedMemo<A>() {
  // Each entry records the last pass that used it, so a get adds no key to a set.
  const entries = new Map<string, { readonly memo: ReturnType<typeof memo<A>>; used: number }>()
  let pass = 0
  return {
    get(key: string, inputs: ReadonlyArray<unknown>, build: () => A): A {
      let entry = entries.get(key)
      if (entry === undefined) {
        entry = { memo: memo<A>(), used: pass }
        entries.set(key, entry)
      } else entry.used = pass
      return entry.memo(inputs, build)
    },
    sweep() {
      for (const [key, entry] of entries) if (entry.used !== pass) entries.delete(key)
      pass++
    },
  }
}

const same = (a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>) => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
