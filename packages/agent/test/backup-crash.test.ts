// Backup, move and restore under the crash harness (plan v3 §14, §16): each Mac runs as a process
// (fixtures/backup.ts) and is killed at each backup and ownership crash point. After a restart the
// backup is whole again, a released Mac stays released and publishes its move, and a staged restore
// installs into recovery.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, setDefaultTimeout } from 'bun:test'
import { crashAt, runAgent } from '@juno/agent-testing'

// Each test starts the agent as a process several times, about a second each on an idle Mac.
setDefaultTimeout(60_000)

const program = fileURLToPath(new URL('./fixtures/backup.ts', import.meta.url))
let root: string
let folder: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'juno-backup-crash-'))
  folder = join(root, 'shared')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const dirOf = (mac: string) => join(root, mac)
const args = (mac: string, ...commands: string[]) => [program, dirOf(mac), folder, mac, ...commands]

interface Summary {
  readonly state: string
  readonly epoch: number
  readonly moveCode: string | null
  readonly texts: ReadonlyArray<string>
  readonly generations: ReadonlyArray<number>
  readonly manifest: { readonly head: number; readonly owner: string; readonly name: string } | null
}

async function run(mac: string, ...commands: string[]): Promise<Summary> {
  const result = await runAgent({ args: args(mac, ...commands), timeoutMs: 60_000 })
  if (result.code !== 0) throw new Error(`agent exited with ${result.signal ?? result.code}\n${result.stderr}`)
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Summary
}

const crash = (point: Parameters<typeof crashAt>[0], mac: string, ...commands: string[]) => crashAt(point, { args: args(mac, ...commands), timeoutMs: 60_000 })

/** The new Mac gets the old Mac's recovery phrase, as main would from the owner. */
async function newMacWithPhrase(from: string, to: string) {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const phrase = (JSON.parse(readFileSync(`${dirOf(from)}.keychain.json`, 'utf8')) as { recoveryPhrase: string }).recoveryPhrase
  writeFileSync(`${dirOf(to)}.keychain.json`, JSON.stringify({ recoveryPhrase: phrase }))
}

// backup.segmentWritten hits: 1 the snapshot (folder), 2 and 3 the segments. backup.manifestRenamed hits:
// 1 the snapshot, 2 the phrase, 3 and 4 the segments.
const backingUp = ['folder', 'phrase', 'say:op-1:first', 'flush', 'say:op-2:second', 'flush']

it('a kill after a segment is written, before its manifest: the restarted Mac starts a new generation that holds every change', async () => {
  await crash('backup.segmentWritten:3', 'studio', ...backingUp)
  const after = await run('studio', 'flush')
  expect(after.generations).toEqual([2])
  expect(after.manifest).toMatchObject({ head: 0, owner: 'active' })

  await newMacWithPhrase('studio', 'laptop')
  await run('laptop', 'restore')
  const restored = await run('laptop')
  expect(restored.state).toBe('recovery')
  expect(restored.texts).toEqual(['first', 'second'])
})

it('a kill after the manifest is renamed, before the export cursor moves: the cursor never passes the manifest, and the next start backs up again whole', async () => {
  await crash('backup.manifestRenamed:4', 'studio', ...backingUp)
  const after = await run('studio', 'say:op-3:third', 'flush')
  expect(after.generations).toEqual([2])

  await newMacWithPhrase('studio', 'laptop')
  await run('laptop', 'restore')
  expect((await run('laptop')).texts).toEqual(['first', 'second', 'third'])
})

it('a kill after the move commits the release: the Mac reopens released, admits nothing, and publishes the final backup with its code', async () => {
  await crash('ownership.released', 'studio', 'folder', 'phrase', 'say:op-1:first', 'move')
  const reopened = await run('studio', 'say:op-2:late', 'idle')
  expect(reopened.state).toBe('released')
  expect(reopened.moveCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  expect(reopened.manifest).toMatchObject({ owner: 'released', name: 'studio' })
  // The late send was stored, never run, and the final backup was taken after the release.
  expect(reopened.texts).toEqual(['first'])

  await newMacWithPhrase('studio', 'laptop')
  await run('laptop', 'restore')
  const restored = await run('laptop', 'activate')
  expect(restored).toMatchObject({ state: 'active', epoch: 2, texts: ['first'] })
})

it('a kill after the restore is staged, before the restart: the next open installs it in recovery', async () => {
  await run('studio', ...backingUp)
  await newMacWithPhrase('studio', 'laptop')
  await crash('restore.staged', 'laptop', 'restore')
  const installed = await run('laptop')
  expect(installed).toMatchObject({ state: 'recovery', epoch: 1, texts: ['first', 'second'] })
})

it('a kill after the restored file replaces agent.sqlite, before recovery is written: the next open finishes the install, so nothing runs before review', async () => {
  await run('studio', ...backingUp)
  await newMacWithPhrase('studio', 'laptop')
  await run('laptop', 'restore')
  await crash('restore.swapped', 'laptop')
  const finished = await run('laptop', 'say:laptop-1:waiting')
  expect(finished).toMatchObject({ state: 'recovery', epoch: 1 })
  // The send is stored and waits for the review: no run, so the archive does not have it yet.
  expect(finished.texts).toEqual(['first', 'second'])
  const activated = await run('laptop', 'activate', 'idle')
  expect(activated).toMatchObject({ state: 'active', epoch: 2 })
  expect(activated.texts).toEqual(['first', 'second', 'waiting'])
})
