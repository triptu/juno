// The durable core under the crash harness (plan v3 §3, §6.5, §16; specs/agent-recovery.qnt).
// Each test runs the real core as a process (fixtures/program.ts), kills it at a named point or
// restores files from an earlier commit boundary, restarts it, and checks the spec's post-condition.
// `raw` reads the files as the crash left them, before any recovery runs.
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { agentDatabaseFiles, crashAt, journalFiles, runAgent, snapshotFiles, type CrashPoint } from '@juno/agent-testing'

const program = fileURLToPath(new URL('./fixtures/program.ts', import.meta.url))
const hooks = fileURLToPath(new URL('../../../scripts/ts-resolve-hooks.mjs', import.meta.url))
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'juno-core-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const args = (...commands: string[]) => ['--no-warnings', '--import', hooks, program, dir, ...commands]

interface State {
  readonly state: 'running' | 'updateNeeded'
  readonly opened: 'resumed' | 'rotated'
  readonly mode: string
  readonly results: ReadonlyArray<string>
  readonly incarnation: string
  readonly incarnations: ReadonlyArray<{ readonly id: string; readonly cursor: number; readonly retiredReason: string | null }>
  readonly inbox: ReadonlyArray<{ readonly opId: string; readonly state: string; readonly reason?: string }>
  readonly messages: ReadonlyArray<{ readonly id: number; readonly kind: string; readonly text: string; readonly origin: string | null; readonly incarnation: string }>
  readonly authorizations: ReadonlyArray<string>
  readonly memory: { readonly rev: number; readonly covered: number; readonly lines: number; readonly queued: number }
  readonly chatRequests: number
  readonly compactionRequests: number
}

/** Opens the core (recovery runs), runs the commands and returns its state. */
async function run(...commands: string[]): Promise<State> {
  const result = await runAgent({ args: args(...commands), timeoutMs: 60_000 })
  if (result.code !== 0) throw new Error(`agent exited with ${result.signal ?? result.code}\n${result.stderr}`)
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as State
}

const crash = (point: CrashPoint | `${CrashPoint}:${number}`, ...commands: string[]) => crashAt(point, { args: args(...commands), timeoutMs: 60_000 })

function open(name: string): DatabaseSync {
  return new DatabaseSync(join(dir, name))
}
const journalNames = () => readdirSync(dir).filter((name) => /^pi-.+\.sqlite$/.test(name))

/** The files as they are, without recovery. */
function raw() {
  const agent = open('agent.sqlite')
  try {
    const current = agent.prepare('SELECT id, cursor FROM incarnations WHERE retired_at IS NULL').get() as { id: string; cursor: number }
    const journalName = `pi-${current.id}.sqlite`
    const journal = journalNames().includes(journalName) ? open(journalName) : undefined
    try {
      return {
        inbox: agent.prepare('SELECT op_id AS opId, state FROM inbox ORDER BY seq').all(),
        incarnations: (agent.prepare('SELECT count(*) AS n FROM incarnations').get() as { n: number }).n,
        current: current.id,
        cursor: current.cursor,
        messages: (agent.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n,
        authorizations: agent.prepare('SELECT outcome FROM authorizations').all().map((row) => row.outcome),
        journal: journal && {
          lastCommitted: Number((journal.prepare('SELECT next_seq FROM durable_metadata').get() as { next_seq: number }).next_seq) - 1,
          // Input submissions by op id. Resets are submissions too, without one.
          submissions: journal.prepare('SELECT request_id AS op FROM submissions WHERE request_id IS NOT NULL ORDER BY id').all().map((row) => JSON.parse(row.op as string)),
          resets: (journal.prepare("SELECT count(*) AS n FROM entries WHERE json_extract(record, '$.kind') = 'pi.reset'").get() as { n: number }).n,
        },
      }
    } finally {
      journal?.close()
    }
  } finally {
    agent.close()
  }
}

function setCursor(value: number): void {
  const agent = open('agent.sqlite')
  agent.prepare('UPDATE incarnations SET cursor = ? WHERE retired_at IS NULL').run(value)
  agent.close()
}

const userMessages = (state: State, op: string) => state.messages.filter((m) => m.kind === 'user' && m.origin === op)

it('inbox.committed: the op is durable before it is acknowledged, and runs once after a restart', async () => {
  await crash('inbox.committed', 'send:op-1:hello')
  // Spec inboxPowerLoss: the op is in the inbox, and nothing was submitted.
  expect(raw()).toMatchObject({ inbox: [{ opId: 'op-1', state: 'accepted' }], journal: { submissions: [] }, messages: 0 })

  const after = await run('idle')
  expect(after.inbox).toEqual([{ opId: 'op-1', state: 'done' }])
  expect(after.messages.map((m) => [m.kind, m.text, m.origin])).toEqual([['user', 'hello', 'op-1'], ['juno', 'Reply 1.', 'op-1']])
  expect(raw().journal!.submissions).toEqual(['op-1'])
})

it('bridge.reset: recovery resets again and submits the op once', async () => {
  await crash('bridge.reset', 'send:op-1:hello', 'idle')
  expect(raw()).toMatchObject({ inbox: [{ opId: 'op-1', state: 'accepted' }], journal: { submissions: [], resets: 1 } })

  const after = await run('idle')
  expect(after.inbox).toEqual([{ opId: 'op-1', state: 'done' }])
  expect(userMessages(after, 'op-1')).toHaveLength(1)
  // Spec bridgeReplay and bridgeDedupe: the journal holds the op once.
  expect(raw().journal!.submissions).toEqual(['op-1'])
})

it('bridge.submitted: the journal is ahead of the inbox and the archive; recovery resumes and projects', async () => {
  await crash('bridge.submitted', 'send:op-1:hello', 'idle')
  const crashed = raw()
  expect(crashed).toMatchObject({ inbox: [{ opId: 'op-1', state: 'accepted' }], journal: { submissions: ['op-1'] } })
  // The projection may already have the input; the inbox does not say submitted.
  expect(crashed.journal!.lastCommitted).toBeGreaterThanOrEqual(crashed.cursor)

  // Spec journalAheadStep: resume, and projection catches up. No reset is added once pi has the op.
  const after = await run('idle')
  expect(after.opened).toBe('resumed')
  expect(after.incarnations).toHaveLength(1)
  expect(after.inbox).toEqual([{ opId: 'op-1', state: 'done' }])
  expect(userMessages(after, 'op-1')).toHaveLength(1)
  expect(raw().journal).toMatchObject({ submissions: ['op-1'], resets: 1 })
})

it('bridge.submitted at a later hit: earlier ops stay done and the later one runs once', async () => {
  await crash('bridge.submitted:2', 'send:op-1:one', 'send:op-2:two', 'idle')
  expect(raw().inbox).toEqual([{ opId: 'op-1', state: 'done' }, { opId: 'op-2', state: 'accepted' }])
  const after = await run('idle')
  expect(after.inbox.map((op) => op.state)).toEqual(['done', 'done'])
  expect(after.messages.map((m) => m.text)).toEqual(['one', 'Reply 1.', 'two', 'Reply 1.'])
})

it('a kill during a run leaves the journal ahead; the run resumes and the op is not repeated', async () => {
  const killed = await runAgent({ args: args('hang', 'send:op-1:hello', 'killWhenRunning:op-1'), timeoutMs: 60_000 })
  expect(killed.crashed).toBe(true)
  expect(raw().inbox).toEqual([{ opId: 'op-1', state: 'submitted' }])

  const after = await run('idle')
  expect(after.opened).toBe('resumed')
  expect(after.inbox).toEqual([{ opId: 'op-1', state: 'done' }])
  expect(after.chatRequests).toBe(1)
  expect(userMessages(after, 'op-1')).toHaveLength(1)
})

it('authorization.consumed: an authorization without a receipt is unknown at startup and never sent again', async () => {
  await crash('authorization.consumed', 'authorize:intent-1')
  expect(raw().authorizations).toEqual(['consumed'])
  // Spec startupAttempt and authorityCrash: unknown before resume; the dispatcher may not send it.
  const after = await run('attempt')
  expect(after.authorizations).toEqual(['unknown'])
  expect(after.results).toEqual(['refused'])
})

it('rotation.drained: the old incarnation is still current; it reopens, and rotation runs again', async () => {
  const before = await run('send:op-1:hello', 'idle')
  await crash('rotation.drained', 'rotate')
  const crashed = raw()
  expect(crashed.incarnations).toBe(1)
  expect(crashed.current).toBe(before.incarnation)

  const reopened = await run()
  expect(reopened).toMatchObject({ opened: 'resumed', incarnation: before.incarnation })
  expect(reopened.messages).toEqual(before.messages)

  const rotated = await run('rotate', 'send:op-2:again', 'idle')
  expect(rotated.incarnations.map((i) => i.retiredReason)).toEqual(['rotation', null])
  expect(rotated.incarnation).not.toBe(before.incarnation)
  expect(journalNames()).toEqual([`pi-${rotated.incarnation}.sqlite`])
  expect(rotated.messages.slice(0, 2)).toEqual(before.messages)
  expect(rotated.messages.slice(2).map((m) => [m.id, m.text, m.incarnation])).toEqual([[2, 'again', rotated.incarnation], [3, 'Reply 1.', rotated.incarnation]])
})

it('rotation.committed: the new incarnation is never reused, and the old journal is deleted, not reopened', async () => {
  const before = await run('send:op-1:hello', 'idle')
  await crash('rotation.committed', 'rotate')
  const crashed = raw()
  expect(crashed.incarnations).toBe(2)
  expect(crashed.current).not.toBe(before.incarnation)
  expect(journalNames()).toContain(`pi-${before.incarnation}.sqlite`)

  const after = await run('send:op-2:again', 'idle')
  expect(after.incarnation).toBe(crashed.current)
  expect(after.incarnations.map((i) => [i.id, i.retiredReason])).toEqual([[before.incarnation, 'rotation'], [crashed.current, null]])
  expect(journalNames()).toEqual([`pi-${crashed.current}.sqlite`])
  expect(after.inbox).toEqual([{ opId: 'op-1', state: 'done' }, { opId: 'op-2', state: 'done' }])
  expect(after.messages.map((m) => m.id)).toEqual([0, 1, 2, 3])
})

it('rollback: a journal behind the archive is never resumed; a new incarnation starts and the live run is interrupted', async () => {
  const first = await run('send:op-1:one', 'idle')
  const boundary = snapshotFiles(dir)
  try {
    const killed = await runAgent({ args: args('hang', 'send:op-2:two', 'killWhenRunning:op-2'), timeoutMs: 60_000 })
    expect(killed.crashed).toBe(true)
    const archived = raw()
    expect(archived.inbox).toEqual([{ opId: 'op-1', state: 'done' }, { opId: 'op-2', state: 'submitted' }])

    // An older journal file comes back under the newer archive (spec rollbackJournal).
    boundary.restore(journalFiles)
    const behind = raw()
    expect(behind.journal!.lastCommitted).toBeLessThan(behind.cursor)

    const after = await run('idle')
    // Spec journalRollback: incarnation 2, op interrupted, not resumed.
    expect(after.opened).toBe('rotated')
    expect(after.incarnations.map((i) => [i.id, i.retiredReason])).toEqual([[first.incarnation, 'rollback'], [after.incarnation, null]])
    expect(after.inbox).toEqual([{ opId: 'op-1', state: 'done' }, { opId: 'op-2', state: 'interrupted', reason: 'rollback' }])
    expect(after.chatRequests).toBe(0)
    expect(after.messages.map((m) => [m.text, m.origin])).toEqual([['one', 'op-1'], ['Reply 1.', 'op-1'], ['two', 'op-2']])
    expect(journalNames()).toEqual([`pi-${after.incarnation}.sqlite`])

    // The archive goes on from where it was, in the new incarnation.
    const later = await run('send:op-3:three', 'idle')
    expect(later.messages.slice(3).map((m) => [m.id, m.text, m.incarnation])).toEqual([[3, 'three', after.incarnation], [4, 'Reply 1.', after.incarnation]])
  } finally {
    boundary.discard()
  }
})

it('next_seq: a journal whose last commit equals the cursor resumes; one position behind rotates', async () => {
  await run('send:op-1:hello', 'idle')
  // The last committed position is next_seq - 1, so equal is not behind.
  setCursor(raw().journal!.lastCommitted)
  expect((await run()).opened).toBe('resumed')

  setCursor(raw().journal!.lastCommitted + 1)
  const behind = await run()
  expect(behind.opened).toBe('rotated')
  expect(behind.incarnations.map((i) => i.retiredReason)).toEqual(['rollback', null])
})

it('power loss after the inbox commit: the files at that boundary recover to one run of the op', async () => {
  await crash('inbox.committed', 'send:op-1:hello')
  const boundary = snapshotFiles(dir)
  try {
    await run('idle', 'send:op-2:later', 'idle')
    boundary.restore()
    const after = await run('idle')
    expect(after.inbox).toEqual([{ opId: 'op-1', state: 'done' }])
    expect(after.messages.map((m) => m.text)).toEqual(['hello', 'Reply 1.'])
    expect(raw().journal!.submissions).toEqual(['op-1'])
  } finally {
    boundary.discard()
  }
})

it('power loss after the journal commit: the boundary state resumes with the journal ahead', async () => {
  await crash('bridge.submitted', 'send:op-1:hello', 'idle')
  const boundary = snapshotFiles(dir)
  try {
    await run('idle')
    boundary.restore()
    const after = await run('idle')
    expect(after.opened).toBe('resumed')
    expect(after.inbox).toEqual([{ opId: 'op-1', state: 'done' }])
    expect(userMessages(after, 'op-1')).toHaveLength(1)
  } finally {
    boundary.discard()
  }
})

it('a crash between journal commits and their projection leaves the journal ahead; recovery projects each commit once', async () => {
  await crash('inbox.committed', 'send:op-1:hello')
  const boundary = snapshotFiles(dir)
  try {
    const finished = await run('idle')
    // agent.sqlite goes back to the boundary; the journal keeps the whole run.
    boundary.restore(agentDatabaseFiles)
    const ahead = raw()
    expect(ahead).toMatchObject({ inbox: [{ opId: 'op-1', state: 'accepted' }], messages: 0, cursor: 0 })
    expect(ahead.journal!.lastCommitted).toBeGreaterThan(ahead.cursor)

    const after = await run('idle')
    expect(after.opened).toBe('resumed')
    expect(after.chatRequests).toBe(0)
    expect(after.inbox).toEqual([{ opId: 'op-1', state: 'done' }])
    expect(after.messages).toEqual(finished.messages)
  } finally {
    boundary.discard()
  }
})

it('a journal from a newer pi stops with "needs to update its records" and is left untouched', async () => {
  const before = await run('send:op-1:hello', 'idle')
  const setVersion = (version: number) => {
    const journal = open(`pi-${before.incarnation}.sqlite`)
    journal.prepare('UPDATE durable_schema SET version = ?').run(version)
    journal.close()
  }
  setVersion(99)
  const blocked = raw()
  expect(await run('send:op-2:again', 'idle')).toEqual({ state: 'updateNeeded' })
  expect(raw()).toEqual(blocked)

  setVersion(1)
  const after = await run()
  expect(after).toMatchObject({ state: 'running', opened: 'resumed', incarnation: before.incarnation })
})

it('an agent.sqlite from a newer Juno stops the same way and is not written', async () => {
  await run('send:op-1:hello', 'idle')
  const agent = open('agent.sqlite')
  agent.prepare("INSERT INTO schema_migrations (\"set\", step, applied_at) VALUES ('future', 1, 0)").run()
  agent.close()
  const blocked = raw()
  expect(await run('send:op-2:again')).toEqual({ state: 'updateNeeded' })
  expect(raw()).toEqual(blocked)
})

it('Pause and AI off stop new authorizations and cancel open ones; Pause survives a restart and sends wait', async () => {
  const paused = await run('authorize:sent', 'attempt', 'authorize:unsent', 'pause', 'authorize:late', 'send:op-1:hello')
  // Spec pause then cancel: the unsent one is cancelled, the sent one asks to cancel.
  expect(paused.results).toEqual(['authorized', 'sent', 'authorized', 'paused', 'accepted'])
  expect(paused.authorizations.toSorted()).toEqual(['cancel-requested', 'cancelled'])
  expect(paused.inbox).toEqual([{ opId: 'op-1', state: 'accepted' }])

  const restarted = await run()
  expect(restarted.mode).toBe('paused')
  // Startup: the one with the transport has no receipt, so it is unknown. Cancelled stays cancelled.
  expect(restarted.authorizations.toSorted()).toEqual(['cancelled', 'unknown'])
  expect(restarted.inbox).toEqual([{ opId: 'op-1', state: 'accepted' }])

  const resumed = await run('resume', 'idle')
  expect(resumed.inbox).toEqual([{ opId: 'op-1', state: 'done' }])

  const off = await run('off', 'send:op-2:no', 'authorize:x')
  expect(off.results).toEqual(['refused', 'off'])
  expect(off.inbox.map((op) => op.opId)).toEqual(['op-1'])
})

it('the owner lock admits one process, and the kernel drops it when the holder is killed', async () => {
  const holder = spawn(process.execPath, args('hold'), { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await new Promise<void>((resolve, reject) => {
      holder.stdout.on('data', (chunk: Buffer) => chunk.toString().includes('HOLDING') && resolve())
      holder.once('exit', () => reject(new Error('holder exited early')))
    })
    const second = await runAgent({ args: args(), timeoutMs: 60_000 })
    expect(second.code).not.toBe(0)
    expect(second.stderr).toContain('another Juno process owns')
  } finally {
    holder.kill('SIGKILL')
    await new Promise((resolve) => holder.once('close', resolve))
  }
  expect((await run()).state).toBe('running')
})

it('memory: projection queues the keys, jobs publish the view, and a restart loads it without rebuilding', async () => {
  const built = await run('send:op-1:one', 'idle', 'send:op-2:two', 'idle', 'compact')
  // Four messages: four copied leaves, then parents [0,2), [2,4) and [0,4) from the compaction model.
  expect(built.memory).toMatchObject({ covered: 4, lines: 4, queued: 0 })
  expect(built.compactionRequests).toBe(3)

  const restarted = await run()
  expect(restarted.memory).toEqual(built.memory)
  expect(restarted.compactionRequests).toBe(0)
})
