// The crash harness against a small stand-in agent that writes real SQLite files.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { CRASH_POINTS, crashAt, journalFiles, runAgent, snapshotFiles } from '../src/index'

const program = fileURLToPath(new URL('./fixtures/agent.ts', import.meta.url))
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'juno-crash-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const args = (...ops: string[]) => ['--no-warnings', program, dir, ...ops]
const state = async () => JSON.parse((await runAgent({ args: args() })).stdout)

it('kills the agent at the named point, after that commit and before the next', async () => {
  const run = await crashAt('inbox.committed', { args: args('op-1') })
  expect(run).toMatchObject({ crashed: true, signal: 'SIGKILL', stdout: '' })
  expect(await state()).toEqual({ inbox: [{ op: 'op-1', state: 'accepted' }], journal: 0, cursor: 0, rollback: false })
})

it('crashes at a later hit of the same point', async () => {
  await crashAt('bridge.submitted:2', { args: args('op-1', 'op-2') })
  expect(await state()).toEqual({
    inbox: [{ op: 'op-1', state: 'submitted' }, { op: 'op-2', state: 'accepted' }],
    journal: 2, cursor: 1, rollback: false,
  })
})

it('runs to the end without a point, and fails loudly at a point never reached', async () => {
  expect((await runAgent({ args: args('op-1') })).code).toBe(0)
  await expect(crashAt('backup.segmentWritten', { args: args('op-2') })).rejects.toThrow(
    'agent never reached crash point backup.segmentWritten (agent-recovery.qnt: after `encrypt`, before `manifest`)',
  )
})

it('simulates power loss by restoring the journal from an earlier commit boundary', async () => {
  await crashAt('inbox.committed', { args: args('op-1') })
  const boundary = snapshotFiles(dir)
  try {
    await runAgent({ args: args('op-1', 'op-2') })
    expect(await state()).toMatchObject({ journal: 2, cursor: 2, rollback: false })
    boundary.restore(journalFiles)
    // The journal is back at the boundary, behind the archive cursor: spec `rollback`.
    expect(await state()).toMatchObject({ journal: 0, cursor: 2, rollback: true })
    boundary.restore()
    expect(await state()).toEqual({ inbox: [{ op: 'op-1', state: 'accepted' }], journal: 0, cursor: 0, rollback: false })
  } finally {
    boundary.discard()
  }
})

it('names each point after transitions and scenarios that exist in its spec', () => {
  for (const point of Object.values(CRASH_POINTS)) {
    const spec = readFileSync(fileURLToPath(new URL(`../../../specs/${point.spec}`, import.meta.url)), 'utf8')
    for (const label of [point.after, point.before]) expect(spec, `${point.spec} label ${label}`).toContain(`label: "${label}"`)
    for (const scenario of point.scenarios) {
      const [name, other] = /^(\w+)(?: \((.+)\))?$/.exec(scenario)!.slice(1)
      const source = other ? readFileSync(fileURLToPath(new URL(`../../../specs/${other}`, import.meta.url)), 'utf8') : spec
      expect(source, `${scenario}`).toMatch(new RegExp(`(pure val|action) ${name}\\b`))
    }
  }
})
