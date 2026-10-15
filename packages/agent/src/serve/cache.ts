/** Connection-local revisions: writes and rollbacks invalidate together, including archive edits. */
import type { Store } from '../store/store'

const tables = ['inbox', 'messages', 'runs', 'run_inputs', 'reactions', 'sources', 'chat_bubbles', 'jobs'] as const
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

/** One typed computation; callers list every input that affects its result. */
export function memo<A>() {
  let previous: { readonly inputs: ReadonlyArray<unknown>; readonly value: A } | undefined
  return (inputs: ReadonlyArray<unknown>, build: () => A): A => {
    const known = previous
    if (known !== undefined && inputs.length === known.inputs.length && inputs.every((input, i) => input === known.inputs[i])) return known.value
    const value = build()
    previous = { inputs, value }
    return value
  }
}

/** Sweep keys no longer present so removed runs and rows do not retain their text. */
export function keyedMemo<A>() {
  const entries = new Map<string, ReturnType<typeof memo<A>>>()
  let used = new Set<string>()
  return {
    get(key: string, inputs: ReadonlyArray<unknown>, build: () => A): A {
      used.add(key)
      let entry = entries.get(key)
      if (entry === undefined) {
        entry = memo<A>()
        entries.set(key, entry)
      }
      return entry(inputs, build)
    },
    sweep() {
      for (const key of entries.keys()) if (!used.has(key)) entries.delete(key)
      used = new Set()
    },
  }
}
