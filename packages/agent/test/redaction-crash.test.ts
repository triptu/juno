// A removal under the crash harness (plan v3 §4.5, §14.4, §16): the agent runs as a process
// (fixtures/redaction.ts) and is killed at each removal step. The deletion record is never behind the data,
// a committed removal is never undone, and the restarted agent finishes the purge, so nothing in the store, the
// journal or the backup holds the words afterwards.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { crashAt, runAgent } from '@juno/agent-testing'

const program = fileURLToPath(new URL('./fixtures/redaction.ts', import.meta.url))
const hooks = fileURLToPath(new URL('../../../scripts/ts-resolve-hooks.mjs', import.meta.url))
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'juno-redaction-crash-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const args = (...commands: string[]) => ['--no-warnings', '--import', hooks, program, dir, ...commands]

interface Summary {
  readonly gen: number
  readonly removals: number
  readonly pending: ReadonlyArray<string>
  readonly leaks: ReadonlyArray<string>
  readonly files: ReadonlyArray<string>
  readonly backup: { readonly record: number; readonly generations: ReadonlyArray<{ readonly gen: number; readonly leaks: number }> }
}

async function run(...commands: string[]): Promise<Summary> {
  const result = await runAgent({ args: args(...commands), timeoutMs: 60_000 })
  if (result.code !== 0) throw new Error(`agent exited with ${result.signal ?? result.code}\n${result.stderr}`)
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Summary
}

const said = ['send:op-1:The gate code is ZEBRA-4417.', 'idle', 'send:op-2:Thanks.', 'idle']
const remove = ['remove:remove-1:op-1']

/** Nothing holds the words, the purge is done, and the backup has one sanitized generation at the record. */
function settled(summary: Summary) {
  expect(summary).toMatchObject({ gen: 1, removals: 1, pending: [], leaks: [], files: [] })
  expect(summary.backup.record).toBe(1)
  expect(summary.backup.generations.at(-1)).toEqual({ gen: 1, leaks: 0 })
}

it('a kill after the deletion record is raised, before the commit: nothing is removed, and removing again commits once', async () => {
  await crashAt('redaction.deletionRaised', { args: args(...said, ...remove), timeoutMs: 60_000 })
  const after = await run('purge')
  // The record is ahead of the data: older backups stay blocked, and the words are still there to remove.
  expect(after).toMatchObject({ gen: 0, removals: 0, pending: [] })
  expect(after.backup).toEqual({ record: 1, generations: [] })
  expect(after.leaks.length).toBeGreaterThan(0)
  settled(await run(...remove, 'purge'))
})

it('a kill right after the commit: the removal holds, and the restarted agent runs the whole purge', async () => {
  await crashAt('redaction.committed', { args: args(...said, ...remove), timeoutMs: 60_000 })
  settled(await run('purge'))
})

for (const hit of [1, 2, 3]) {
  it(`a kill after purge step ${hit}: the restarted agent runs the steps left, and a done step changes nothing`, async () => {
    await crashAt(`redaction.purged:${hit}`, { args: args(...said, ...remove, 'purge'), timeoutMs: 60_000 })
    const after = await run('purge')
    settled(after)
    expect(after.backup.generations).toHaveLength(1)
  })
}
