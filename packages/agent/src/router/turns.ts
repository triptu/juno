import type { Backup } from '../backup/backup'
import type { Compactor } from '../compactor/scheduler'
import { find } from '../inbox/inbox'
import { activePins, editPin, pinMessage, undoPin } from '../pins/pins'
import type { ProviderGuardApi } from '../providers'
import { currentIncarnation } from '../recovery/incarnations'
import type { driveScheduler } from '../schedule/driver'
import { view } from '../store/memory'
import { uuidv7, type Store } from '../store/store'
import type { createTurnModels } from './models'
import type { ArchiveMessage, Turns, TurnsOptions } from './open'
import type { createTurnServices } from './services'
import type { createTurnSession } from './session'

const PAUSED = 'Juno was paused, so the script stopped. Reads it had not finished were cancelled. Do not run it again until Juno is resumed.'
const OFF = 'AI assist was turned off, so the script stopped. Reads it had not finished were cancelled.'

interface CloseContext {
  readonly scheduleDriver: ReturnType<typeof driveScheduler>
  readonly services: ReturnType<typeof createTurnServices>
  readonly compactor: Compactor | undefined
  readonly session: ReturnType<typeof createTurnSession>
  readonly backup: Backup | undefined
  readonly release: () => void
}

export function closeTurns({ scheduleDriver, services: { redaction, actions, jobs, router, scripts, learning }, compactor, session, backup, release }: CloseContext) {
  let closed: Promise<void> | undefined
  return () => (closed ??= (async () => {
    await scheduleDriver.close()
    await learning.close()
    await redaction.close()
    await actions.close()
    await jobs.close()
    await compactor?.close()
    const stopped = router.close()
    await session.close()
    await stopped
    await scripts?.close()
    // The backup is the last writer: its final export sees every change.
    await backup?.close()
    release()
  })())
}

interface ApiContext extends Omit<CloseContext, 'release'> {
  readonly store: Store
  readonly guard: ProviderGuardApi
  readonly opened: 'resumed' | 'rotated'
  readonly options: TurnsOptions
  readonly models: ReturnType<typeof createTurnModels>
  readonly close: () => Promise<void>
}

export function turnApi({ store, guard, opened, options, services: { router, actions, redaction, ownership, jobs, scheduler, scripts, learning }, session, models, compactor, backup, scheduleDriver, close }: ApiContext): Turns {
  return {
    _tag: 'running',
    scheduler,
    checkSchedules: scheduleDriver.tick,
    store,
    guard,
    opened,
    incarnation: () => currentIncarnation(store)!,
    position: session.position,
    accept: router.accept,
    retry: router.retry,
    mode: router.mode,
    setMode: (next) => {
      actions.beforeMode(next)
      // Pause and AI off stop a running script; the reply goes on without its result (SPEC 13.9).
      if (next !== 'on') scripts?.cancelAll(next === 'paused' ? PAUSED : OFF)
      // A learning pass stops too, keeping what it wrote.
      if (next !== 'on') void learning.stopAll()
      router.setMode(next)
      actions.afterMode(next)
      compactor?.poke()
    },
    models: models.models,
    setModels: models.setModels,
    run: router.state,
    ...records(store),
    subscribe: router.subscribe,
    networkChanged: router.kick,
    idle: router.idle,
    rotate: router.rotate,
    actions,
    learning,
    redaction,
    ownership,
    ...(backup !== undefined ? { backup } : {}),
    jobs: {
      list: jobs.list,
      active: jobs.active,
      stop: async (jobId, opId) => {
        const job = jobs.get(jobId)
        if (job?.kind === 't3' && !await options.stopExternalJob?.(job, opId ?? uuidv7(store.now()))) return jobs.stopFailed(job.id)
        actions.jobStopped(jobId)
        return jobs.stop(jobId)
      },
      idle: jobs.idle,
    },
    compaction: {
      state: () => compactor?.state() ?? 'idle',
      idle: () => compactor?.idle() ?? Promise.resolve(),
    },
    close,
  }
}

function records(store: Store): Pick<Turns, 'op' | 'messages' | 'memory' | 'pins'> {
  return {
    op: (opId) => {
      const op = find(store, opId)
      return op === undefined ? undefined : { state: op.state, reason: op.reason }
    },
    messages: (from = 0, limit = 200) =>
      store.db
        .prepare('SELECT id, kind, text, at, origin_op AS opId FROM messages WHERE id >= ? ORDER BY id LIMIT ?')
        .all(from, limit) as unknown as ReadonlyArray<ArchiveMessage>,
    memory: () => view(store),
    pins: {
      active: () => activePins(store),
      pinMessage: (input) => pinMessage(store, { ...input, id: input.id ?? uuidv7(store.now()) }),
      edit: (expected, text) => editPin(store, expected, text),
      undo: (expected) => undoPin(store, expected),
    },
  }
}
