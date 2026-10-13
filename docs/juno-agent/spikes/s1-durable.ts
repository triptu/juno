// S1: pi-durable 1.2.0 through a synchronous=FULL SQLite facade.
// Run: node docs/juno-agent/spikes/s1-durable.ts   (no network, uses pi-ai's faux provider)
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import { Type } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
import {
  createRegistry,
  defineExtension,
  defineTool,
  GenerationTask,
  Harness,
  hook,
} from '@earendil-works/pi-durable'
import { CURRENT_SQLITE_SCHEMA_VERSION, SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite'
import { openNodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node'

const MODEL = { provider: 'faux', modelId: 'm' }
const results: Array<[string, boolean, string]> = []
const record = (name: string, ok: boolean, detail = '') => {
  results.push([name, ok, detail])
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

// Juno's facade: pi's own Node adapter, switched to synchronous=FULL before pi touches it. On macOS
// fsync does not flush the drive cache, so fullfsync is needed for the FULL promise to hold on power loss.
async function openFull(path: string) {
  const db = await openNodeSqliteDatabase(path)
  await db.exec('PRAGMA synchronous = FULL')
  await db.exec('PRAGMA fullfsync = ON')
  await db.exec('PRAGMA checkpoint_fullfsync = ON')
  const sync = (await db.get<{ synchronous: number }>('PRAGMA synchronous'))?.synchronous
  const storage = await SqliteStorage.open(db)
  return { db, storage, sync }
}

const headSeq = async (db: Awaited<ReturnType<typeof openNodeSqliteDatabase>>) =>
  Number((await db.get<{ next_seq: number }>('SELECT next_seq FROM durable_metadata WHERE singleton = 1'))?.next_seq)

function makeFaux(contextWindow = 200_000) {
  const faux = fauxProvider({ provider: 'faux', models: [{ id: 'm', contextWindow, maxTokens: 1000 }] })
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, models }
}

const settings = {
  compaction: { enabled: false, backgroundTokens: 0 },
  retry: { maxRetries: 0 },
}

let releaseSlow: () => void = () => {}
const slowTool = defineTool({
  name: 'slow',
  description: 'Waits until the test releases it',
  parameters: Type.Object({}),
  execute: async () => {
    await new Promise<void>((resolve) => (releaseSlow = resolve))
    return { output: [{ type: 'text', text: 'slow done' }] }
  },
})
const hangTool = defineTool({
  name: 'hang',
  description: 'Never returns (the process is killed while it runs)',
  parameters: Type.Object({}),
  execute: async () => {
    process.stdout.write('IN_TOOL\n')
    await new Promise(() => {})
    return {}
  },
})

type HookMode = { mode: 'none' } | { mode: 'replace'; text: string } | { mode: 'throw' }
let hookMode: HookMode = { mode: 'none' }
const Guard = defineExtension({
  name: 'juno-guard',
  hooks: [
    hook(GenerationTask, {
      beforeRequest: (request) => {
        if (hookMode.mode === 'throw') throw new Error('builder failed')
        if (hookMode.mode === 'replace') {
          return { messages: [{ role: 'user', content: hookMode.text, timestamp: Date.now() }] }
        }
        return undefined
      },
    }),
  ],
})
const Tools = defineExtension({ name: 'spike-tools', tools: [slowTool, hangTool] })

async function openHarness(path: string, models: ReturnType<typeof createModels>, reports: unknown[] = []) {
  const { db, storage, sync } = await openFull(path)
  const registry = createRegistry()
  registry.install(Guard)
  registry.install(Tools)
  const harness = await Harness.open(
    storage,
    { models, registry, settings, onReport: (error: unknown) => reports.push(error) },
    ctx,
  )
  const root = await harness.root(ctx, { agent: { model: MODEL } })
  return { db, harness, root, sync }
}

const textOf = (messages: readonly any[]) =>
  messages
    .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((c: any) => c.text ?? '').join('')))
    .join('|')

async function main(dir: string) {
  // 1. FULL facade, beforeRequest replace, sessionId across reset.
  {
    const { faux, models } = makeFaux()
    const reports: unknown[] = []
    const seen: Array<{ text: string; sessionId?: string }> = []
    const capture = (reply: string) => (context: any, options: any) => {
      seen.push({ text: textOf(context.messages), sessionId: options?.sessionId })
      return fauxAssistantMessage(reply)
    }
    faux.setResponses([capture('a1'), capture('a2'), capture('a3')])
    const { harness, root, sync } = await openHarness(join(dir, 'a.sqlite'), models, reports)
    record('facade runs pi at synchronous=FULL', sync === 2, `PRAGMA synchronous = ${sync}`)

    hookMode = { mode: 'replace', text: 'BUILT-BY-JUNO' }
    const sub1 = await root.submit({ type: 'input', content: 'raw owner text', requestId: 'op-1' }, ctx)
    const s1 = await sub1.wait(ctx)
    record('beforeRequest replaces the whole request', seen[0]?.text === 'BUILT-BY-JUNO', JSON.stringify(seen[0]?.text))
    record('input answered', s1.status === 'done')

    await root.reset(undefined, ctx)
    const s2 = await (await root.submit({ type: 'input', content: 'second', requestId: 'op-2' }, ctx)).wait(ctx)
    record(
      'reset per run keeps provider sessionId',
      s2.status === 'done' && seen[0]?.sessionId !== undefined && seen[0]?.sessionId === seen[1]?.sessionId,
      `${seen[0]?.sessionId} / ${seen[1]?.sessionId}`,
    )

    const again = await root.submit({ type: 'input', content: 'raw owner text', requestId: 'op-1' }, ctx)
    record('same requestId returns the existing submission', again.id === sub1.id, `${again.id} === ${sub1.id}`)
    record('dedupe makes no extra model call', faux.state.callCount === 2, `callCount=${faux.state.callCount}`)

    // 2. A throwing beforeRequest is reported and skipped: pi sends its raw context.
    hookMode = { mode: 'throw' }
    const s3 = await (await root.submit({ type: 'input', content: 'RAW-AFTER-THROW', requestId: 'op-3' }, ctx)).wait(ctx)
    record(
      'throwing beforeRequest falls back to raw context (guard needed)',
      s3.status === 'done' && seen[2]?.text.includes('RAW-AFTER-THROW') === true && reports.length > 0,
      `sent ${JSON.stringify(seen[2]?.text.slice(0, 80))}, reported: ${String((reports[0] as Error)?.message ?? reports[0])}`,
    )
    hookMode = { mode: 'none' }
    await harness.close(ctx)
  }

  // 3. Compaction off: a transcript far over the window still sends, and no compaction entry appears.
  {
    const { faux, models } = makeFaux(2_000)
    faux.setResponses(Array.from({ length: 6 }, (_, i) => fauxAssistantMessage(`ok ${i}`)))
    const { harness, root } = await openHarness(join(dir, 'c.sqlite'), models)
    const big = 'x'.repeat(8_000)
    let allDone = true
    for (let i = 0; i < 5; i++) {
      const s = await (await root.submit({ type: 'input', content: `${i} ${big}` }, ctx)).wait(ctx)
      allDone &&= s.status === 'done'
    }
    const page = await root.entries({}, 1000, undefined, ctx)
    const compactions = page.items.filter((e) => e.kind === 'pi.compaction').length
    record('compaction off: no pi.compaction over the window', allDone && compactions === 0, `calls=${faux.state.callCount}, compactions=${compactions}`)
    await harness.close(ctx)
  }

  // 4. Steering: a steer sent during a tool round joins the run after that round.
  {
    const { faux, models } = makeFaux()
    let secondRequest = ''
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('slow', {}), { stopReason: 'toolUse' }),
      (context: any) => {
        secondRequest = textOf(context.messages)
        return fauxAssistantMessage('final')
      },
    ])
    const { harness, root } = await openHarness(join(dir, 's.sqlite'), models)
    const run = await root.submit({ type: 'input', content: 'start work' }, ctx)
    while (faux.state.callCount < 1) await new Promise((r) => setTimeout(r, 5))
    await new Promise((r) => setTimeout(r, 50))
    const steer = await root.submit({ type: 'input', content: 'STEER-NOW', whenBusy: 'steer' }, ctx)
    releaseSlow()
    const [r1, r2] = [await run.wait(ctx), await steer.wait(ctx)]
    record(
      'steer joins the running run after the tool round',
      r1.status === 'done' && r2.status === 'done' && faux.state.callCount === 2 && secondRequest.includes('slow done') && secondRequest.indexOf('STEER-NOW') > secondRequest.indexOf('slow done'),
      `calls=${faux.state.callCount}`,
    )
    await harness.close(ctx)
  }

  // 5. Crash in a non-replay-safe tool: kill -9 the process, reopen, resume.
  {
    const path = join(dir, 'k.sqlite')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [import.meta.filename, 'child', path], { stdio: ['ignore', 'pipe', 'inherit'] })
      child.stdout.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('IN_TOOL')) child.kill('SIGKILL')
      })
      child.on('exit', (code, signal) => (signal === 'SIGKILL' ? resolve() : reject(new Error(`child exited ${code}`))))
    })
    const { faux, models } = makeFaux()
    let resumedRequest = ''
    faux.setResponses([
      (context: any) => {
        resumedRequest = textOf(context.messages)
        return fauxAssistantMessage('recovered')
      },
    ])
    const { harness, root } = await openHarness(path, models)
    harness.resume()
    const again = await root.submit({ type: 'input', content: 'do the thing', requestId: 'op-crash' }, ctx)
    const settled = await again.wait(ctx)
    const entries = (await root.entries({}, 100, undefined, ctx)).items
    const toolResult = entries.find((e) => e.kind === 'pi.tool-result')
    const users = entries.filter((e) => e.kind === 'pi.user').length
    record(
      'kill -9 mid-tool: resume finishes the run, tool result is interrupted, input not duplicated',
      settled.status === 'done' && users === 1 && JSON.stringify(toolResult?.model ?? '').includes('nterrupt'),
      `status=${settled.status}, users=${users}, result=${JSON.stringify((toolResult?.model?.[0] as any)?.content)}, resumed request saw: ${JSON.stringify(resumedRequest.slice(0, 120))}`,
    )
    await harness.close(ctx)
  }

  // 6. Power loss: an older file snapshot reopens without complaint; Juno must detect journal-behind itself.
  {
    const { faux, models } = makeFaux()
    faux.setResponses(Array.from({ length: 4 }, (_, i) => fauxAssistantMessage(`r${i}`)))
    const path = join(dir, 'p.sqlite')
    let opened = await openHarness(path, models)
    await (await opened.root.submit({ type: 'input', content: 'one' }, ctx)).wait(ctx)
    await opened.harness.close(ctx)
    copyFileSync(path, join(dir, 'p.snapshot'))
    opened = await openHarness(path, models)
    await (await opened.root.submit({ type: 'input', content: 'two' }, ctx)).wait(ctx)
    const archiveCursor = await headSeq(opened.db)
    await opened.harness.close(ctx)
    copyFileSync(join(dir, 'p.snapshot'), path)
    for (const suffix of ['-wal', '-shm']) if (existsSync(path + suffix)) rmSync(path + suffix)
    const rolled = await openHarness(path, models)
    const journalHead = await headSeq(rolled.db)
    record(
      'rolled-back journal opens silently; next_seq exposes journal-behind',
      journalHead < archiveCursor,
      `journal next_seq=${journalHead} < archive cursor ${archiveCursor}`,
    )
    await rolled.harness.close(ctx)
  }

  // 7. A journal written by a newer pi refuses to open, and is left untouched.
  {
    const path = join(dir, 'p.sqlite')
    const raw = new DatabaseSync(path)
    raw.exec(`UPDATE durable_schema SET version = ${CURRENT_SQLITE_SCHEMA_VERSION + 1}`)
    raw.close()
    let error = ''
    try {
      await openFull(path)
    } catch (e) {
      error = (e as Error).message
    }
    const after = new DatabaseSync(path)
    const version = (after.prepare('SELECT version FROM durable_schema').get() as { version: number }).version
    after.close()
    record('newer journal schema refuses to open', error.includes('newer than supported') && version === CURRENT_SQLITE_SCHEMA_VERSION + 1, error)
  }

  // 8. Rotation: a new journal file gets a new provider sessionId (one cache miss per rotation).
  {
    const { faux, models } = makeFaux()
    const ids: string[] = []
    const capture = (context: any, options: any) => {
      ids.push(options?.sessionId)
      return fauxAssistantMessage('x')
    }
    faux.setResponses([capture, capture])
    for (const name of ['r1.sqlite', 'r2.sqlite']) {
      const { harness, root } = await openHarness(join(dir, name), models)
      await (await root.submit({ type: 'input', content: 'hi' }, ctx)).wait(ctx)
      await harness.close(ctx)
    }
    record('rotation: a new incarnation has a new sessionId', ids[0] !== ids[1], `${ids[0]} / ${ids[1]}`)
  }

  // 9. Commit cost: write submissions under FULL vs NORMAL (S5).
  for (const [mode, fullfsync] of [['NORMAL', 'OFF'], ['FULL', 'OFF'], ['FULL', 'ON']]) {
    const { models } = makeFaux()
    const path = join(dir, `w-${mode}-${fullfsync}.sqlite`)
    const db = await openNodeSqliteDatabase(path)
    await db.exec(`PRAGMA synchronous = ${mode}`)
    await db.exec(`PRAGMA fullfsync = ${fullfsync}`)
    const registry = createRegistry()
    const harness = await Harness.open(await SqliteStorage.open(db), { models, registry, settings }, ctx)
    const root = await harness.root(ctx, { agent: { model: MODEL } })
    const n = 300
    const start = performance.now()
    for (let i = 0; i < n; i++) await root.submit({ type: 'write', entry: { kind: 'app.note', data: { i } } }, ctx)
    const ms = performance.now() - start
    record(`write commits at synchronous=${mode} fullfsync=${fullfsync}`, true, `${n} commits in ${ms.toFixed(0)} ms, ${(ms / n).toFixed(2)} ms each`)
    await harness.close(ctx)
  }

  const failed = results.filter(([, ok]) => !ok)
  console.log(`\nS1: ${results.length - failed.length}/${results.length} passed`)
  if (failed.length > 0) process.exitCode = 1
}

async function child(path: string) {
  const { faux, models } = makeFaux()
  faux.setResponses([fauxAssistantMessage([fauxText('working'), fauxToolCall('hang', {})], { stopReason: 'toolUse' })])
  const { root } = await openHarness(path, models)
  await root.submit({ type: 'input', content: 'do the thing', requestId: 'op-crash' }, ctx)
  await new Promise(() => {})
}

if (process.argv[2] === 'child') {
  await child(process.argv[3]!)
} else {
  const dir = mkdtempSync(join(tmpdir(), 'juno-s1-'))
  try {
    await main(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
