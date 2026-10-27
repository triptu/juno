// Counted budgets for the engine's SQL (docs/performance.md, "Counted budgets"): the statements each
// main path runs and the rows they return, from the synced default workspace and from one of 300
// conversations, and a warm start of the synced default workspace. A budget fails when the work grows: a query per row, a window read whole for one
// change, a list that reads every conversation, a live query that re-runs for writes it does not show.
//
// Engine time is frozen after boot and moves only in fixed steps (`measured`), so timers and the live
// queries' debounce fire at the same points in every run and the counts are the same on any machine.
// Budgets are today's counts plus a little headroom; `JUNO_WORK_COUNTS=1` prints the counts.
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, it } from 'bun:test'
import { expectWork } from '@juno/testing/work-budget'
import { messagesAtom, openTopic, sendMessage, type ListWindow } from '@juno/state'
import type { MessageView, TopicRow } from '@juno/contract'
import { controlledClock, noTicks } from '../controlledClock'
import { startTestEngine, WAIT_MS, waitFor, type RunningEngine } from '../harness'
import { mutationSeed } from '../mutationSeed'
import { bootedEngine, quiet, tsOf, valueOf } from '../scenario'
import { countSql, statementsSoFar, type SqlWork } from '../sqlWork'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
const clocks: Array<{ close: () => Promise<void> }> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
  for (const clock of clocks.splice(0)) await clock.close()
})

type Time = Awaited<ReturnType<typeof controlledClock>>

async function frozen(start: (clock: Time['clock']) => Promise<RunningEngine>): Promise<{ engine: RunningEngine; time: Time }> {
  const time = await controlledClock()
  clocks.push(time)
  const engine = await start(time.clock)
  await quiet(engine)
  // Automated's rules check every conversation once after the first sync; a pass now finishes that before the steps.
  await engine.workPass('automated')
  await time.freeze()
  // A sleep that started before the freeze ends on live time (the fast profile's are under 300 ms, as Automated's
  // window after its own pass): it ends now. Then work boot left waiting on engine time runs, not in a measured step.
  await new Promise((resolve) => setTimeout(resolve, 500))
  await measured(engine, time, async () => {}, () => true)
  return { engine, time }
}

/** The counts a budget reads, and the statements behind them for the failure message. */
const counts = (sql: SqlWork) => ({ statements: sql.statements, rows: sql.rows })
const detail = (sql: SqlWork) => sql.byStatement.slice(0, 12).map((entry) => `${entry.runs}× ${entry.rows} rows  ${entry.sql.slice(0, 160)}`).join('\n')

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

/**
 * Runs `operation`, then steps engine time a second at a time, letting the fake's answers and the
 * socket's frames land between steps, until `done` holds and two steps run no more SQL.
 */
async function measured(engine: RunningEngine, time: Time, operation: () => Promise<unknown>, done: () => boolean): Promise<SqlWork> {
  const { sql } = await countSql(async () => {
    await operation()
    let unchanged = 0
    let last = -1
    const started = Date.now()
    while (unchanged < 2) {
      await engine.socketIdle()
      await engine.handle.commandIdle()
      await tick()
      await time.advance(1_000)
      await tick()
      const total = statementsSoFar(engine.userData)
      unchanged = done() && total === last ? unchanged + 1 : 0
      last = total
      if (Date.now() - started > WAIT_MS) throw new Error('the work did not settle')
    }
  }, () => engine.userData)
  return sql
}

function windowOf(engine: RunningEngine, id: string): () => ListWindow<MessageView> | undefined {
  const atom = messagesAtom(id)
  unmounts.push(engine.registry.mount(atom))
  return () => {
    const result = engine.registry.get(atom)
    return result._tag === 'Success' && result.value.meta.seq > 0 ? result.value : undefined
  }
}

const rowsOf = (engine: RunningEngine): ReadonlyArray<TopicRow> => {
  const result = engine.registry.get(engine.topicsAtom())
  return result._tag === 'Success' ? result.value.order.map((id) => result.value.rows.get(id)!) : []
}

const texts = (window: ListWindow<MessageView> | undefined) =>
  (window?.order ?? []).map((id) => window!.rows.get(id)!.body.blocks.flatMap((block) => ('children' in block ? block.children : [])).map((inline) => ('text' in inline ? inline.text : '')).join(''))

it('the sidebar, a topic open and reopen, a send and a live message stay within their SQL budgets', async () => {
  const { engine, time } = await frozen((clock) => syncedEngine(engines, { clock, timing: noTicks }))

  await step('the sidebar list: the first run, as at startup from the cache', async () => {
    const sql = await measured(engine, time, async () => engine.topicsAtom(), () => rowsOf(engine).length > 0)
    expectWork('sidebar first run', counts(sql), { statements: 10, rows: 35 }, detail(sql))
  })

  const main = 'm:C0ENG'
  let eng: () => ListWindow<MessageView> | undefined = () => undefined

  await step("opening #eng's Main: its window, its header and the fetch of what the store lacks", async () => {
    const sql = await measured(engine, time, async () => {
      // The app mounts the window and asks for the open together, so the window's first run and the fetch's write of
      // the range it covers land in either order: one run, or two when the write follows the first. Wait for the
      // first run, so the count is always the slower order: the window read, then read again once the fetch covers it.
      eng = windowOf(engine, main)
      await waitFor(eng)
      valueOf(await openTopic(engine.registry, main))
    }, () => eng()?.meta.windowCovered === true)
    expectWork('topic open, cold', counts(sql), { statements: 45, rows: 66 }, detail(sql))
  })

  await step('opening it again: the window is still mounted, the open asks only for what is newer', async () => {
    const sql = await measured(engine, time, () => openTopic(engine.registry, main), () => true)
    expectWork('topic open, again', counts(sql), { statements: 35, rows: 44 }, detail(sql))
  })

  await step('sending a message to Main: the pending row, the post and its echo', async () => {
    const sql = await measured(engine, time, async () => {
      valueOf(await sendMessage(engine.registry, { kind: 'channel', channelId: 'C0ENG' }, 'Counting the work of a send', main))
    }, () => texts(eng()).includes('Counting the work of a send') && engine.fake.messages('C0ENG').some((message) => message.text === 'Counting the work of a send'))
    expectWork('send', counts(sql), { statements: 112, rows: 127 }, detail(sql))
  })

  await step('a message arriving on the socket: one event, the sidebar and the open window', async () => {
    const sql = await measured(engine, time, async () => {
      engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Counting a live message' })
    }, () => texts(eng()).includes('Counting a live message') && rowsOf(engine).some((row) => row.preview.text === 'Counting a live message'))
    expectWork('live message', counts(sql), { statements: 54, rows: 102 }, detail(sql))
  })

  const plan = rowsOf(engine).find((row) => row.title === 'Draft plan is in the doc')!
  let thread: () => ListWindow<MessageView> | undefined = () => undefined
  await measured(engine, time, async () => {
    thread = windowOf(engine, plan.id)
    valueOf(await openTopic(engine.registry, plan.id))
  }, () => thread()?.meta.windowCovered === true)

  await step('a reply arriving in an open thread', async () => {
    const sql = await measured(engine, time, async () => {
      engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Counting a live reply', threadTs: tsOf(plan.id) })
    }, () => texts(thread()).includes('Counting a live reply'))
    expectWork('live reply', counts(sql), { statements: 114, rows: 172 }, detail(sql))
  })
})

it('the sidebar of 300 conversations reads its window, not the workspace', async () => {
  const { engine, time } = await frozen((clock) => bootedEngine(engines, { fakeOptions: { seed: mutationSeed() }, clock, timing: noTicks }, 60_000))
  await step('the first run', async () => {
    const sql = await measured(engine, time, async () => engine.topicsAtom(), () => rowsOf(engine).length > 0)
    expectWork('large sidebar first run', counts(sql), { statements: 10, rows: 383 }, detail(sql))
  })
  await step('one message in one of 300 conversations', async () => {
    const target = rowsOf(engine).find((row) => row.kind === 'main')!
    const sql = await measured(engine, time, async () => {
      engine.fake.injectMessage({ channel: target.channel.id, user: 'U0LEO', text: 'Counting one live message' })
    }, () => rowsOf(engine).some((row) => row.preview.text === 'Counting one live message'))
    expectWork('large sidebar live message', counts(sql), { statements: 56, rows: 681 }, detail(sql))
  })
})

it('a warm start re-indexes only the topics whose inputs changed', async () => {
  // A relaunch on a copy of a first sync's folder, against the same fake. The shared template (`synced.ts`) gets a fake
  // on another port when another file's fake holds the template's: the stored URLs then differ, and the start rewrote
  // people and their topics (784 statements with the port held, 860 once on the Mac, against 736).
  const first = await startTestEngine({ fakeOptions: { seedTime: Date.now() }, initial: (fake) => fake.signIn() })
  await first.status('ready')
  await first.phase('live')
  await quiet(first)
  const copy = await mkdtemp(join(tmpdir(), 'juno-engine-test-'))
  // Stopping closes the store, which checkpoints the WAL into the files copied here; the fake stays up.
  first.registry.dispose()
  await first.handle.stop()
  await cp(first.userData, copy, { recursive: true })
  await rm(first.userData, { recursive: true, force: true })
  const { sql } = await countSql(async () => {
    const engine = await startTestEngine({ timing: noTicks, reuse: { userData: copy, fake: first.fake, credentials: { ...first.fake.sessions()[0]!, url: first.fake.url } } })
    engines.push({ ...engine, stop: async () => {
      await engine.stop()
      await first.fake.close()
      await rm(copy, { recursive: true, force: true })
    } })
    await engine.status('ready')
    await engine.phase('live')
    await quiet(engine)
    return engine
  }, (engine) => engine.userData)
  expectWork('warm start', counts(sql), { statements: 815, rows: 950 }, detail(sql))
})
