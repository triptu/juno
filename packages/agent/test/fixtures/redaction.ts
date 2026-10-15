// The turn engine with removal as a process, for the removal crash tests. Opens the engine on a directory
// (recovery runs) with compaction and a fake backup whose deletion record and generations persist in
// `<dir>/backup.json`, runs the commands, prints what still holds the marker as JSON and closes. The
// scripted model answers every message with "Noted.".
//
//   node --import scripts/ts-resolve-hooks.mjs redaction.ts <dir> [command...]
//
// Commands: send:<op>:<text>  idle  remove:<op>:<send op>  purge
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeProvider, reply } from '@juno/agent-testing'
import { createProviderGuard, openTurns, type Turns } from '../../src/index'

export const SECRET = 'ZEBRA-4417'

const [dir, ...commands] = process.argv.slice(2)
if (dir === undefined) throw new Error('usage: redaction.ts <dir> [command...]')

const fake = fakeProvider()
fake.script(Array.from({ length: 8 }, () => reply('<say>Noted.</say>')))

type Backup = { record: number; generations: Array<{ gen: number; leaks: number }> }
const backupFile = join(dir, 'backup.json')
const readBackup = (): Backup => (existsSync(backupFile) ? (JSON.parse(readFileSync(backupFile, 'utf8')) as Backup) : { record: 0, generations: [] })
const writeBackup = (next: Backup) => writeFileSync(backupFile, JSON.stringify(next))

/** Rows of agent.sqlite that hold the marker. */
const leaks = (turns: Turns) =>
  (turns.store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).flatMap(({ name }) =>
    (turns.store.db.prepare(`SELECT * FROM "${name}"`).all() as unknown[]).filter((row) => JSON.stringify(row).includes(SECRET)).map(() => name),
  )

let opened: Turns | undefined
const turns = await openTurns({
  agentDir: dir,
  provider: (store) => createProviderGuard({ store, transport: fake.models }),
  model: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' },
  compaction: { provider: 'openrouter', modelId: 'anthropic/claude-haiku-5.5' },
  backup: {
    raiseDeletion: async (gen) => {
      const backup = readBackup()
      writeBackup({ ...backup, record: Math.max(backup.record, gen) })
    },
    regenerate: async (gen) => {
      // A restart resumes the purge while the engine is still opening.
      let engine = opened
      for (; engine === undefined; engine = opened) await new Promise((resolve) => setTimeout(resolve, 5))
      const backup = readBackup()
      writeBackup({ ...backup, generations: [...backup.generations, { gen, leaks: leaks(engine).length }] })
    },
  },
})
if (turns._tag === 'updateNeeded') throw new Error('update needed')
opened = turns

for (const command of commands) {
  const [name, ...rest] = command.split(':')
  switch (name) {
    case 'send': {
      const [opId, ...text] = rest
      turns.accept({ opId: opId!, kind: 'send', text: text.join(':') })
      break
    }
    case 'idle':
      await turns.idle()
      await turns.compaction.idle()
      break
    case 'remove': {
      const [opId, sendOp] = rest
      const row = turns.store.db.prepare("SELECT min(id) AS id FROM messages WHERE kind = 'user' AND origin_op = ?").get(sendOp!) as { id: number }
      await turns.redaction.remove({ opId: opId!, messageIds: [row.id], alsoRemoveReply: true })
      break
    }
    case 'purge':
      await turns.redaction.idle()
      await turns.compaction.idle()
      break
    default:
      throw new Error(`unknown command ${command}`)
  }
}

const files = readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && !entry.name.startsWith('agent.sqlite') && entry.name !== 'backup.json')
  .filter((entry) => readFileSync(join(entry.parentPath, entry.name)).includes(SECRET))
  .map((entry) => entry.name)
const summary = {
  gen: turns.memory().gen,
  removals: (turns.store.db.prepare('SELECT count(*) AS n FROM removals').get() as { n: number }).n,
  pending: turns.redaction.pending().map((row) => row.step),
  leaks: [...new Set(leaks(turns))].toSorted(),
  files,
  backup: readBackup(),
}
await turns.close()
console.log(JSON.stringify(summary))
