// Settings › Juno's Backup and This Mac rows, the chat's ownership banners and the Review page as the
// renderer reads them (SPEC 13.7, 13.8, 13.10), on two Macs sharing a backup folder.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { reply } from '@juno/agent-testing'
import type { ChatItem, ChatPage, OpId } from '@juno/agent-contract'
import { fakeKeychain, type FakeKeychain } from './fixtures/keychain'
import { run, served } from './serve-harness'
import { say } from './turns-harness'

const of = <T extends ChatItem['_tag']>(page: ChatPage, tag: T) => page.items.filter((item): item is Extract<ChatItem, { _tag: T }> => item._tag === tag)

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-ownership-'))
  dirs.push(dir)
  return dir
}

const mac = (name: string, keychain: FakeKeychain, dir?: string) =>
  served({ compaction: false, ...(dir ? { dir } : {}), backup: { keychain, deviceName: name, intervalMs: 0 } })

it('Move from Settings: the backup rows fill in, the Mac turns read-only with a move code, and a send is refused', async () => {
  const folder = tempDir()
  const keychain = fakeKeychain()
  const { h, client, follow, pageWhere } = await mac('Studio', keychain)
  const settings = follow(client['agent.settings.page']())
  const initial = await settings.where((p) => p.ownership._tag === 'active', 'the active owner')
  expect(initial.ownership).toEqual({ _tag: 'active', epoch: 1 })
  expect(initial.backupFolder).toBe(join(h.dir, 'backup'))

  expect(await run(client['agent.settings.change']({ opId: 'op-1' as OpId, change: { _tag: 'backupFolder', path: folder } }))).toMatchObject({ _tag: 'Success' })
  await settings.where((p) => p.backupFolder === folder && p.lastBackupAt !== undefined, 'the first backup in the new folder')
  expect(await run(client['agent.settings.change']({ opId: 'op-2' as OpId, change: { _tag: 'backupFolder', path: 'relative/path' } }))).toMatchObject({ _tag: 'Failure' })
  await run(client['agent.settings.ownership']({ opId: 'op-3' as OpId, action: { _tag: 'exportPhrase' } }))
  await settings.where((p) => p.recoveryPhraseExportedAt !== undefined, 'the phrase exported')
  expect(keychain.values().recoveryPhrase).toBeDefined()

  expect(await run(client['agent.settings.ownership']({ opId: 'op-4' as OpId, action: { _tag: 'move' } }))).toMatchObject({ _tag: 'Success' })
  const released = await settings.where((p) => p.ownership._tag === 'released' && p.ownership.moveCode !== undefined, 'the move code')
  expect(released.ownership).toMatchObject({ _tag: 'released', epoch: 1, moveCode: h.turns.ownership.owner().moveCode })
  const chat = await pageWhere((p) => p.banner._tag === 'otherDevice', 'the read-only banner')
  expect(chat.composerEnabled).toBe(false)
  const refused = await run(client['agent.chat.send']({ opId: 'op-5' as OpId, text: 'are you there?' }))
  expect(refused).toMatchObject({ _tag: 'Failure', failure: { reason: 'readOnly', message: 'Juno is working on your other Mac.' } })
})

it('Restore from Settings opens in recovery: the banner, waiting sends and the Review page, then Activate', async () => {
  const folder = tempDir()
  const oldKeychain = fakeKeychain()
  const old = await mac('Studio', oldKeychain)
  await run(old.client['agent.settings.change']({ opId: 'op-1' as OpId, change: { _tag: 'backupFolder', path: folder } }))
  await old.h.turns.backup!.exportPhrase()
  await old.h.turns.backup!.flush()

  const keychain = fakeKeychain({ recoveryPhrase: oldKeychain.values().recoveryPhrase! })
  const fresh = await mac('Laptop', keychain)
  expect(await run(fresh.client['agent.settings.ownership']({ opId: 'op-1' as OpId, action: { _tag: 'restore', backupPath: folder, oldDeviceOffOrErased: true } }))).toMatchObject({ _tag: 'Success' })
  await fresh.h.stop()

  const { h, client, follow, pageWhere } = await mac('Laptop', keychain, fresh.h.dir)
  const recovering = await pageWhere((p) => p.banner._tag === 'recovery', 'the recovery banner')
  expect(recovering.banner).toEqual({ _tag: 'recovery', pending: 0 })
  expect(recovering.composerEnabled).toBe(true)
  h.fake.script([reply(say('Here.'))])
  await run(client['agent.chat.send']({ opId: 'laptop-1' as OpId, text: 'are you there?' }))
  const waiting = await pageWhere((p) => of(p, 'owner').length === 1, 'the waiting send')
  expect(of(waiting, 'owner')[0]).toMatchObject({ delivery: { _tag: 'waiting', for: 'review' } })

  const review = follow(client['agent.review.page']())
  const page = await review.where((p) => p.page.backupAt !== undefined, 'the review page')
  expect(page.page).toEqual({ backupAt: h.turns.ownership.owner().backupAt, unchecked: true, pending: [] })
  const settings = follow(client['agent.settings.page']())
  await settings.where((p) => p.ownership._tag === 'recovery', 'recovery in Settings')

  expect(await run(client['agent.review.activate']({ opId: 'op-2' as OpId, backupAt: page.page.backupAt!, oldDeviceOffOrErased: true }))).toMatchObject({ _tag: 'Success' })
  await pageWhere((p) => p.banner._tag === 'none' && of(p, 'juno').length === 1, 'the answer after Activate')
  await settings.where((p) => p.ownership._tag === 'active' && p.ownership.epoch === 2, 'this Mac owns Juno')
  await review.where((p) => p.page.backupAt === undefined && p.page.pending.length === 0, 'the review page empty')
})

it('A folder Juno cannot use says why, and the backup stays where it was', async () => {
  const { client, follow } = await mac('Studio', fakeKeychain())
  const settings = follow(client['agent.settings.page']())
  const before = await settings.where((p) => p.ownership._tag === 'active', 'the page')
  // A path under a file: the folder can never be made.
  const file = join(tempDir(), 'notes.txt')
  writeFileSync(file, 'not a folder')
  expect(await run(client['agent.settings.change']({ opId: 'op-1' as OpId, change: { _tag: 'backupFolder', path: join(file, 'Juno') } }))).toMatchObject({
    _tag: 'Failure',
    failure: { reason: 'invalid', message: "Juno can't write to that folder. Choose another one." },
  })

  // Another Mac's backup: writing would delete it.
  const theirs = tempDir()
  const other = await mac('Laptop', fakeKeychain())
  await run(other.client['agent.settings.change']({ opId: 'op-1' as OpId, change: { _tag: 'backupFolder', path: theirs } }))
  expect(await run(client['agent.settings.change']({ opId: 'op-2' as OpId, change: { _tag: 'backupFolder', path: theirs } }))).toMatchObject({
    _tag: 'Failure',
    failure: { reason: 'invalid', message: 'That folder holds a Juno backup from another Mac. Restore from it, or choose another folder.' },
  })
  expect((await settings.where((p) => p.ownership._tag === 'active', 'the page')).backupFolder).toBe(before.backupFolder)
})
