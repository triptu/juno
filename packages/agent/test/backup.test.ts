// Backup, restore and ownership across two Macs (plan v3 §14, SPEC 13.8; spec agent-recovery.qnt). Each
// "Mac" is a turn engine on its own agent directory and keychain; they share one backup folder, as a
// synced folder would. A restore stages the backup, and reopening the directory stands in for the
// agent's restart.
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { fakeActionHost, reply, TEST_CHANNEL, type FakeActionHost } from '@juno/agent-testing'
import { generations, manifestPath, parseManifest, type Turns } from '../src/index'
import { readText } from '../src/backup/folder'
import { fakeKeychain, type FakeKeychain } from './fixtures/keychain'
import { say, turnsHarness } from './turns-harness'

type Harness = Awaited<ReturnType<typeof turnsHarness>>
interface Mac {
  readonly name: string
  readonly h: Harness
  readonly keychain: FakeKeychain
  readonly slack: FakeActionHost
  readonly restarts: () => number
}

const open: Mac[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const mac of open.splice(0)) await mac.h.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-backup-'))
  dirs.push(dir)
  return dir
}

async function startMac(name: string, keychain: FakeKeychain, options: { readonly dir?: string; readonly slack?: FakeActionHost } = {}): Promise<Mac> {
  const slack = options.slack ?? fakeActionHost()
  let restarts = 0
  const h = await turnsHarness({
    compaction: false,
    ...(options.dir ? { dir: options.dir } : {}),
    actions: { host: slack.host },
    backup: { keychain, deviceName: name, intervalMs: 0, restart: () => restarts++ },
  })
  const mac = { name, h, keychain, slack, restarts: () => restarts }
  open.push(mac)
  return mac
}

/** The agent restarts on the same directory, keychain and Slack. */
async function restart(mac: Mac): Promise<Mac> {
  open.splice(open.indexOf(mac), 1)
  await mac.h.stop()
  return startMac(mac.name, mac.keychain, { dir: mac.h.dir, slack: mac.slack })
}

let said = 0
/** Op ids are global across restores, so each Mac's sends get their own. */
async function converse(mac: Mac, text: string, answer: string) {
  mac.h.fake.script([reply(say(answer))])
  await mac.h.ended(mac.h.send(text, { opId: `${mac.name}-${++said}` }))
}

const texts = (turns: Turns) => turns.messages().map((m) => m.text)

/** The removed message's marker. Letters outside hex, so no timestamp, number or id can contain it. */
const MARKER = 'quokka'

/** The tables of agent.sqlite whose rows hold `word` anywhere. */
const holding = (turns: Turns, word: string) =>
  (turns.store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
    .map((row) => row.name)
    .filter((table) => JSON.stringify(turns.store.db.prepare(`SELECT * FROM "${table}"`).all()).includes(word))

const manifestOf = (folder: string, gen: number) => parseManifest(readText(manifestPath(folder, gen))!)!.manifest

let calls = 0
const sendCall = (text: string) =>
  reply({ type: 'toolCall', id: `call-send-${++calls}`, name: 'send_message', arguments: { messages: [{ topic: `m:${TEST_CHANNEL}`, text }] } as never })

/** One model turn that proposes a Send message card. */
async function proposeSend(mac: Mac, text: string) {
  mac.h.fake.script([sendCall(text), reply(say('Here is a draft.'))])
  await mac.h.ended(mac.h.send(`tell the channel: ${text}`))
}

/** Card statuses as the chat shows them. */
const statusOf = (turns: Turns) => turns.actions.views().map(turns.ownership.restored).map((view) => ('status' in view.card ? view.card.status : undefined))

/** A new Mac restores `folder` with the recovery phrase from `from`, and restarts into recovery. */
async function restoreOnNewMac(name: string, from: Mac, folder: string) {
  const keychain = fakeKeychain({ recoveryPhrase: from.keychain.values().recoveryPhrase! })
  const fresh = await startMac(name, keychain)
  const staged = await fresh.h.turns.ownership.restore(folder)
  if (staged._tag !== 'staged') throw new Error(`restore refused: ${staged.message}`)
  expect(fresh.restarts()).toBe(1)
  return { mac: await restart(fresh), staged }
}

it('a backup restores on a new Mac with the recovery phrase, opens in recovery, holds sends until Activate, then runs them', async () => {
  const folder = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(folder)
  await converse(a, 'the launch is on Friday', 'Noted, Friday.')
  await a.h.turns.backup!.exportPhrase()
  await a.h.turns.backup!.flush()
  expect(a.keychain.values().recoveryPhrase).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)

  const { mac: b, staged } = await restoreOnNewMac('Laptop', a, folder)
  expect(texts(b.h.turns)).toEqual(texts(a.h.turns))
  // No trusted deletion record on a new Mac without a move: the Review page says so (G13).
  expect(b.h.turns.ownership.owner()).toMatchObject({ state: 'recovery', epoch: 1, trusted: false, backupAt: staged.backupAt })
  expect(b.h.turns.ownership.review().page).toEqual({ backupAt: staged.backupAt, unchecked: true, pending: [] })

  // The composer works and the send waits for the review.
  b.h.fake.script([reply(say('Friday, as planned.'))])
  // Op ids are global: the restored inbox already holds the old Mac's.
  const op = b.h.send('when is the launch?', { opId: 'laptop-1' })
  await b.h.turns.idle()
  expect(b.h.turns.op(op)?.state).toBe('accepted')

  expect(b.h.turns.ownership.activate({ backupAt: staged.backupAt + 1 })).toMatchObject({ _tag: 'refused', reason: 'stale' })
  expect(b.h.turns.ownership.activate({ backupAt: staged.backupAt })).toEqual({ _tag: 'activated' })
  await b.h.ended(op)
  expect(b.h.bubbles()).toEqual([['Friday, as planned.']])
  expect(b.h.turns.ownership.owner()).toMatchObject({ state: 'active', epoch: 2 })
  // The new owner's first backup is a new generation, and the old Mac's generation is gone.
  await b.h.turns.backup!.flush()
  expect(generations(folder)).toEqual([2])
  expect(manifestOf(folder, 2).owner).toMatchObject({ name: 'Laptop', epoch: 2, state: 'active' })
})

it('changes after the snapshot travel as ordered segments, and an export with nothing new writes nothing', async () => {
  const folder = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(folder)
  await a.h.turns.backup!.exportPhrase()
  await converse(a, 'first', 'One.')
  await a.h.turns.backup!.flush()
  await converse(a, 'second', 'Two.')
  await a.h.turns.backup!.flush()
  await converse(a, 'third', 'Three.')
  await a.h.turns.backup!.flush()
  expect(generations(folder)).toEqual([1])
  const head = manifestOf(folder, 1).head
  expect(head).toBe(3)
  // The export cursor is local, so writing it is not a change to export (G12).
  await a.h.turns.backup!.flush()
  expect(manifestOf(folder, 1).head).toBe(head)
  expect(readdirSync(join(folder, 'g000001')).toSorted()).toEqual(['manifest.json', 'segment-1.bin', 'segment-2.bin', 'segment-3.bin', 'snapshot.bin'])

  const { mac: b } = await restoreOnNewMac('Laptop', a, folder)
  expect(texts(b.h.turns)).toEqual(texts(a.h.turns))
  expect(texts(b.h.turns)).toHaveLength(6)
})

it('a restore waits while a segment the manifest names has not arrived, and refuses a folder without a backup', async () => {
  const folder = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(folder)
  await a.h.turns.backup!.exportPhrase()
  await a.h.turns.backup!.flush()
  await converse(a, 'hello', 'Hi.')
  await a.h.turns.backup!.flush()

  const partial = tempDir()
  cpSync(folder, partial, { recursive: true })
  rmSync(join(partial, 'g000001', 'segment-1.bin'))
  const b = await startMac('Laptop', fakeKeychain({ recoveryPhrase: a.keychain.values().recoveryPhrase! }))
  expect(await b.h.turns.ownership.restore(partial)).toMatchObject({ _tag: 'refused', reason: 'stale' })
  expect(await b.h.turns.ownership.restore(tempDir())).toMatchObject({ _tag: 'refused', reason: 'invalid' })
  expect(b.restarts()).toBe(0)
  expect(b.h.turns.ownership.owner().state).toBe('active')
  // Without the phrase the backup cannot be opened.
  const c = await startMac('Other', fakeKeychain())
  expect(await c.h.turns.ownership.restore(folder)).toMatchObject({ _tag: 'refused', reason: 'invalid' })
})

it('a move: the old Mac stops, writes a final backup and shows a code; the new Mac shows the same code, and a reviewed click runs once after Activate', async () => {
  const folder = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(folder)
  await a.h.turns.backup!.exportPhrase()
  await proposeSend(a, 'On my way.')
  expect(statusOf(a.h.turns)).toEqual([{ _tag: 'open' }])

  const moved = await a.h.turns.ownership.move()
  if (moved._tag !== 'moved') throw new Error(moved.message)
  expect(moved.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  expect(a.h.turns.ownership.owner()).toMatchObject({ state: 'released', epoch: 1, moveCode: moved.code })
  expect(manifestOf(folder, generations(folder)[0]!).owner.state).toBe('released')
  // The old Mac is read-only: a send is stored but never runs, and a second move is refused.
  const late = a.h.send('one more thing', { opId: 'studio-late' })
  await a.h.turns.idle()
  expect(a.h.turns.op(late)?.state).toBe('accepted')
  expect(await a.h.turns.ownership.move()).toMatchObject({ _tag: 'refused', reason: 'readOnly' })

  const { mac: b, staged } = await restoreOnNewMac('Laptop', a, folder)
  expect(staged.moveCode).toBe(moved.code)
  const review = b.h.turns.ownership.review()
  // A move's manifest is a trusted deletion record: no "can't check" line.
  expect(review.page).toMatchObject({ moveCode: moved.code, backupAt: staged.backupAt })
  expect(review.page.unchecked).toBeUndefined()
  expect(review.page.pending.map((card) => ('status' in card ? card.status : undefined))).toEqual([{ _tag: 'open', mayHaveHappened: true }])

  // A click on the Review page waits while Juno is in recovery.
  const binding = review.cards[0]!
  expect(b.h.turns.actions.approve('review-click', binding.identity, binding.children)).toEqual({ _tag: 'accepted' })
  await b.h.turns.actions.idle()
  expect(b.slack.messages()).toEqual([])

  expect(b.h.turns.ownership.activate({ backupAt: staged.backupAt })).toEqual({ _tag: 'activated' })
  await b.h.turns.actions.idle()
  expect(b.slack.messages().map((m) => m.text)).toEqual(['On my way.'])
  expect(statusOf(b.h.turns)).toEqual([{ _tag: 'done', line: 'Sent' }])
  expect(b.h.turns.ownership.owner()).toMatchObject({ state: 'active', epoch: 2 })

  // The old Mac stays released after a restart and writes nothing more.
  const reopened = await restart(a)
  expect(reopened.h.turns.ownership.owner()).toMatchObject({ state: 'released', moveCode: moved.code })
  await b.h.turns.backup!.flush()
  const newest = generations(folder)[0]!
  await reopened.h.turns.backup!.flush()
  expect(generations(folder)[0]).toBe(newest)
  expect(a.slack.messages()).toEqual([])
})

it('a click made before the backup but never authorized is void after a restore; Activate expires the card unsent', async () => {
  const folder = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(folder)
  await a.h.turns.backup!.exportPhrase()
  await proposeSend(a, 'Running late.')
  a.h.turns.setMode('paused')
  const view = a.h.turns.actions.views()[0]!
  expect(a.h.turns.actions.approve('paused-click', view.binding!.identity, view.binding!.children)).toEqual({ _tag: 'accepted' })
  await a.h.turns.actions.idle()
  expect(a.slack.messages()).toEqual([])
  await a.h.turns.backup!.flush()

  const { mac: b, staged } = await restoreOnNewMac('Laptop', a, folder)
  // Spec restoreApproval: the restored click does not authorize anything.
  expect(statusOf(b.h.turns)).toEqual([{ _tag: 'open', mayHaveHappened: true }])
  expect(b.h.turns.ownership.pending()).toBe(1)
  expect(b.h.turns.ownership.activate({ backupAt: staged.backupAt })).toEqual({ _tag: 'activated' })
  await b.h.turns.actions.idle()
  expect(statusOf(b.h.turns)).toEqual([{ _tag: 'expired' }])
  expect(b.slack.messages()).toEqual([])
})

it('a stale owner: a Mac still running after a forced restore elsewhere stops when it reads the new owner in the shared folder', async () => {
  const folder = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(folder)
  await a.h.turns.backup!.exportPhrase()
  await converse(a, 'hello', 'Hi.')
  await a.h.turns.backup!.flush()

  const { mac: b, staged } = await restoreOnNewMac('Laptop', a, folder)
  b.h.turns.ownership.activate({ backupAt: staged.backupAt })
  await b.h.turns.backup!.flush()
  // Until it reads the folder, the old Mac still believes it owns Juno (spec staleOwnerCannotAuthorize,
  // a documented v1 limit).
  expect(a.h.turns.ownership.owner().state).toBe('active')

  a.h.fake.script([reply(say('Yes.'))])
  await a.h.ended(a.h.send('still here?', { opId: 'studio-2' }))
  await a.h.turns.backup!.flush()
  expect(a.h.turns.ownership.owner()).toMatchObject({ state: 'released', deviceName: 'Laptop' })
  expect(a.h.turns.ownership.admits()).toBe(false)
  // It wrote nothing over the new owner's backup.
  expect(generations(folder)).toEqual([2])
  expect(manifestOf(folder, 2).owner.name).toBe('Laptop')
})

it('a removal raises the deletion record, its purge regenerates the backup without the message and destroys the old generation; an older copy of the folder is refused on this Mac', async () => {
  const folder = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(folder)
  await a.h.turns.backup!.exportPhrase()
  await converse(a, `the safe word is ${MARKER}`, 'Got it.')
  await converse(a, 'lunch at noon', 'Noted.')
  await a.h.turns.backup!.flush()
  const before = tempDir()
  cpSync(folder, before, { recursive: true })

  // The owner's Remove (WP16): the record is raised first, then the removal commits, then the purge
  // regenerates the backup.
  const secret = a.h.turns.messages().find((m) => m.kind === 'user' && m.text.includes(MARKER))!
  expect(await a.h.turns.redaction.remove({ opId: 'remove-1', messageIds: [secret.id], alsoRemoveReply: false })).toMatchObject({ _tag: 'removed', gen: 1 })
  expect(a.keychain.values().deletionRecord).toBe('1')
  await a.h.turns.redaction.idle()
  expect(a.h.turns.redaction.pending()).toEqual([])
  expect(generations(folder)).toEqual([2])
  expect(manifestOf(folder, 2)).toMatchObject({ label: 1, deletion: 1 })

  const { mac: b } = await restoreOnNewMac('Laptop', a, folder)
  expect(holding(b.h.turns, MARKER)).toEqual([])
  expect(texts(b.h.turns).join('\n')).toContain('lunch at noon')

  // This Mac's keychain holds the record, so the copy from before the removal is refused.
  expect(await a.h.turns.ownership.restore(before)).toMatchObject({ _tag: 'refused', reason: 'stale' })
  // A new Mac has no trusted record: it restores the old copy and the Review page says it cannot check
  // (spec staleFolderCannotRestoreRemoved, a documented v1 limit while the strict option is off).
  const { mac: c } = await restoreOnNewMac('Spare', a, before)
  expect(texts(c.h.turns).join('\n')).toContain(MARKER)
  expect(c.h.turns.ownership.review().page.unchecked).toBe(true)
})

it('a deletion record ahead of the backup (a crash before the removal committed) starts a new generation at the next export', async () => {
  const folder = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(folder)
  await converse(a, 'hello', 'Hi.')
  await a.h.turns.backup!.flush()
  await a.h.turns.backup!.removal.raiseDeletion(1)
  await a.h.turns.backup!.flush()
  expect(generations(folder)).toEqual([2])
  expect(manifestOf(folder, 2)).toMatchObject({ label: 1, deletion: 1 })
  // So this Mac can restore again: the newest generation is not older than its record.
  const staged = await a.h.turns.ownership.restore(folder)
  expect(staged).toMatchObject({ _tag: 'staged' })
})

it('a new Mac pointed at the old Mac’s folder before restoring writes nothing there, and the restore still works', async () => {
  const folder = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(folder)
  await a.h.turns.backup!.exportPhrase()
  await converse(a, 'hello', 'Hi.')
  await a.h.turns.backup!.flush()

  const b = await startMac('Laptop', fakeKeychain({ recoveryPhrase: a.keychain.values().recoveryPhrase! }))
  await expect(b.h.turns.backup!.setFolder(folder)).rejects.toThrow('holds another Juno backup')
  expect(b.h.turns.backup!.folder()).not.toBe(folder)
  expect(generations(folder)).toEqual([1])
  expect(await b.h.turns.ownership.restore(folder)).toMatchObject({ _tag: 'staged' })
})

it('a new backup folder starts a generation there and removes this Mac’s generations from the old one', async () => {
  const first = tempDir()
  const second = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(first)
  await a.h.turns.backup!.flush()
  expect(generations(first)).toEqual([1])
  await a.h.turns.backup!.setFolder(second)
  expect(generations(second)).toEqual([2])
  expect(generations(first)).toEqual([])
  expect(a.h.turns.backup!.folder()).toBe(second)
})

it('a new Mac that already backed up restores with the phrase, takes the backup key, and its next generations open with the same phrase', async () => {
  const folder = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(folder)
  await a.h.turns.backup!.exportPhrase()
  await converse(a, 'the launch is on Friday', 'Noted.')
  await a.h.turns.backup!.flush()

  // The new Mac ran for a while: it has its own key and a backup in its own folder.
  const keychain = fakeKeychain({ recoveryPhrase: a.keychain.values().recoveryPhrase! })
  const fresh = await startMac('Laptop', keychain)
  await fresh.h.turns.backup!.flush()
  const ownKey = keychain.values().backupKey
  expect(ownKey).toBeDefined()
  const staged = await fresh.h.turns.ownership.restore(folder)
  if (staged._tag !== 'staged') throw new Error(staged.message)
  const b = await restart(fresh)
  expect(keychain.values().backupKey).toBe(a.keychain.values().backupKey)

  b.h.turns.ownership.activate({ backupAt: staged.backupAt })
  await converse(b, 'and the demo on Monday', 'Noted.')
  await b.h.turns.backup!.flush()
  expect(generations(folder)).toEqual([2])
  // The old Mac reads the new owner's manifest, and a third Mac opens it with the phrase the owner has.
  await a.h.turns.backup!.flush()
  expect(a.h.turns.ownership.owner()).toMatchObject({ state: 'released', deviceName: 'Laptop' })
  const { mac: c } = await restoreOnNewMac('Spare', a, folder)
  expect(texts(c.h.turns).join('\n')).toContain('demo on Monday')
})

it('a removal record from the store a new Mac had before does not block restoring another Mac’s backup', async () => {
  const folder = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(folder)
  await a.h.turns.backup!.exportPhrase()
  await converse(a, 'hello', 'Hi.')
  await a.h.turns.backup!.flush()

  const keychain = fakeKeychain({ recoveryPhrase: a.keychain.values().recoveryPhrase!, deletionRecord: '3' })
  const fresh = await startMac('Laptop', keychain)
  const staged = await fresh.h.turns.ownership.restore(folder)
  expect(staged).toMatchObject({ _tag: 'staged' })
  const b = await restart(fresh)
  expect(b.h.turns.ownership.owner()).toMatchObject({ state: 'recovery', trusted: false })
  // The record is the restored store's now.
  expect(keychain.values().deletionRecord).toBe('0')
})

it('a folder change whose first backup fails still clears the old folder once a later backup lands', async () => {
  const first = tempDir()
  const second = tempDir()
  const a = await startMac('Studio', fakeKeychain())
  await a.h.turns.backup!.setFolder(first)
  expect(generations(first)).toEqual([1])
  // A folder Juno cannot create: the export fails after the setting changed.
  await expect(a.h.turns.backup!.setFolder('/dev/null/backup')).rejects.toThrow()
  expect(generations(first)).toEqual([1])
  await a.h.turns.backup!.setFolder(second)
  expect(generations(second)).toHaveLength(1)
  expect(generations(first)).toEqual([])
})
