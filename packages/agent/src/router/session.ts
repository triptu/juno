import { projector } from '../projection/projector'
import { commitRotation, deleteRetiredJournals } from '../recovery/incarnations'
import { ROTATION_AGE_MS } from '../runtime/core'
import { crashPoint } from '../runtime/crash'
import { openJournalFile, type Journal, type JournalSettings } from '../runtime/journal'
import type { JournalPosition } from '../store/ledger'
import type { Store } from '../store/store'
import type { ModelRef, TurnsOptions } from './open'

export function createTurnSession(store: Store, options: TurnsOptions, running: () => ModelRef, poke: () => void) {
  let journal: Journal | undefined
  let projection: ReturnType<typeof projector> | undefined
  let unsubscribe: () => void = () => {}
  let settings: JournalSettings
  const attach = (next: Journal) => {
    journal = next
    projection = projector(store, next)
    unsubscribe = next.onCommit(() => {
      void projection!.catchUp().then(() => poke(), options.onReport)
    })
  }

  // A rotation in flight; close waits for it before closing the journal.
  let rotating: Promise<void> | undefined
  const rotateNow = () => (rotating = rotateJournal().finally(() => (rotating = undefined)))
  const rotateJournal = async () => {
    // Called by the loop between runs: no run is live. Drain the projection.
    await projection!.catchUp()
    crashPoint('rotation.drained')
    const old = journal!
    const incarnation = commitRotation(store, 'rotation')
    unsubscribe()
    await old.close()
    deleteRetiredJournals(options.agentDir, incarnation)
    const next = await openJournalFile(options.agentDir, incarnation)
    if (next._tag !== 'opened') throw new Error(`a new journal could not be opened (${next._tag})`)
    attach(await next.file.start({ ...settings, model: running() }))
    journal!.resume()
  }

  return {
    journal: () => journal!,
    catchUp: () => projection!.catchUp(),
    position: async (): Promise<JournalPosition> => {
      // A rotation closes the old journal, and a read of a closed journal never answers: read the new one.
      for (let current = rotating; current !== undefined; current = rotating) await current.catch(() => undefined)
      return { incarnation: journal!.incarnation, seq: await journal!.lastCommitted() }
    },
    rotate: rotateNow,
    rotationDue: () => {
      const row = store.db.prepare('SELECT created_at AS at FROM incarnations WHERE id = ?').get(journal!.incarnation) as { at: number }
      return store.now() - row.at >= ROTATION_AGE_MS
    },
    start: async (file: { readonly start: (settings: JournalSettings) => Promise<Journal> }, next: JournalSettings) => {
      settings = next
      attach(await file.start(settings))
    },
    close: async () => {
      await rotating
      unsubscribe()
      await projection!.catchUp()
      await journal!.close()
    },
  }
}
