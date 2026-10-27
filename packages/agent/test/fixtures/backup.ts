import { testDurability } from '@juno/agent-testing'
// One Mac's turn engine with a backup, as a process, for the backup crash tests. The keychain is a JSON
// file beside the agent directory, so a restarted process reads it again. Runs the commands, prints a
// summary as JSON and closes.
//
//   bun backup.ts <dir> <folder> <name> [command...]
//
// Commands: folder (back up into <folder>)  phrase  say:<op>:<text>  flush  move  restore (from <folder>)  activate  idle
import { mkdirSync } from 'node:fs'
import { fakeProvider, reply } from '@juno/agent-testing'
import { createProviderGuard, generations, manifestPath, openTurns, parseManifest } from '../../src/index'
import { readText } from '../../src/backup/folder'
import { fakeKeychain } from './keychain'

const [dir, folder, name, ...commands] = process.argv.slice(2)
if (dir === undefined || folder === undefined || name === undefined) throw new Error('usage: backup.ts <dir> <folder> <name> [command...]')

mkdirSync(dir, { recursive: true })
const fake = fakeProvider()
fake.script(Array.from({ length: 8 }, () => reply('<say>Noted.</say>')))
const keychain = fakeKeychain({}, `${dir}.keychain.json`)
const turns = await openTurns({
  durability: testDurability,
  agentDir: dir,
  provider: (store) => createProviderGuard({ store, transport: fake.models }),
  model: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' },
  backup: { keychain, deviceName: name, intervalMs: 0 },
})
if (turns._tag === 'updateNeeded') throw new Error('update needed')
const backup = turns.backup!

for (const command of commands) {
  const [verb, ...rest] = command.split(':')
  switch (verb) {
    case 'folder':
      await backup.setFolder(folder)
      break
    case 'phrase':
      await backup.exportPhrase()
      break
    case 'say': {
      const [opId, ...text] = rest
      turns.accept({ opId: opId!, kind: 'send', text: text.join(':') })
      await turns.idle()
      break
    }
    case 'flush':
      await backup.flush()
      break
    case 'move': {
      const moved = await turns.ownership.move()
      if (moved._tag !== 'moved') throw new Error(moved.message)
      break
    }
    case 'restore': {
      const staged = await turns.ownership.restore(folder)
      if (staged._tag !== 'staged') throw new Error(staged.message)
      break
    }
    case 'activate': {
      const owner = turns.ownership.owner()
      const activated = turns.ownership.activate({ backupAt: owner.backupAt ?? 0 })
      if (activated._tag !== 'activated') throw new Error(activated.message)
      break
    }
    case 'idle':
      await turns.idle()
      // A move a crash interrupted finishes in the background at open.
      await backup.flush()
      break
    default:
      throw new Error(`unknown command ${command}`)
  }
}

const newest = generations(folder)[0]
const manifest = newest === undefined ? undefined : parseManifest(readText(manifestPath(folder, newest))!)?.manifest
const owner = turns.ownership.owner()
const summary = {
  state: owner.state,
  epoch: owner.epoch,
  moveCode: owner.moveCode ?? null,
  /** The owner's messages in the archive, without their markup. */
  texts: turns.messages().filter((m) => m.kind === 'user').map((m) => m.text.replace(/<[^>]*>/g, '')),
  generations: generations(folder),
  manifest: manifest === undefined ? null : { head: manifest.head, owner: manifest.owner.state, name: manifest.owner.name },
}
await turns.close()
console.log(JSON.stringify(summary))
