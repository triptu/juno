// Topic art end to end against the fake Slack and the fake AI provider: the
// sidebar rows and the header carry a recipe once the background job has
// drawn a topic, the drawing is kept in user.db, AI assist off hides every
// drawing and draws nothing new, Redraw replaces a drawing and its undo puts
// the old one back, and a model answer outside the vocabulary leaves the
// placeholder.
import { step } from './step'
import { controlledSleep } from './controlledClock'
import { afterEach, describe, expect, it } from 'vitest'
import { artRedraw, prefsSet, type TopicRow } from '@juno/contract'
import { redrawTopic, runAction, runCommand, topicAtom, undoLast } from '@juno/state'
import { parseRecipe } from '@juno/topic-art'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { SELF_ID } from '@juno/fake-slack'
import { bootedEngine as boot, readDb, valueOf } from './scenario'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const bootedEngine = (options: Parameters<typeof boot>[1] = {}) => boot(engines, { aiJobs: true, ...options })

const isMain = (row: TopicRow) => row.kind === 'main'
const isDmMain = (row: TopicRow) => row.kind === 'main' && (row.channel.kind === 'im' || row.channel.kind === 'mpim')
const hasArt = (row: TopicRow) => typeof row.art === 'string' && row.art.length > 0

const storedArt = (engine: RunningEngine) =>
  readDb(engine, 'user.db', (db) => db.prepare('SELECT topic_id, recipe, status, source, hue, title_source FROM topic_art ORDER BY topic_id').all() as Array<{ topic_id: string; recipe: string; status: string; source: string; hue: string; title_source: string }>)

/** The rows once every thread has its AI title, every thread and channel Main in the window has been drawn, or finished trying, and every finished drawing shows. */
const drawnRows = (engine: RunningEngine) =>
  engine.rowsUntil((rows) => {
    if (rows.length === 0) return false
    if (rows.some((row) => row.kind === 'thread' && row.titleSource !== 'ai')) return false
    const stored = new Map(storedArt(engine).map((entry) => [entry.topic_id, entry]))
    return rows.filter((row) => !isDmMain(row)).every((row) => {
      const entry = stored.get(row.id)
      return entry !== undefined && !(row.titleSource === 'ai' && entry.source === 'ai' && entry.title_source === 'fallback') && (entry.status === 'ok' ? row.art === entry.recipe : row.art === undefined)
    })
  }, 'every drawable row drawn')

/** How many drawings the model was asked for. */
const artCalls = (engine: RunningEngine) =>
  readDb(engine, 'user.db', (db) => (db.prepare("SELECT coalesce(sum(repeats), 0) AS n FROM ai_calls WHERE feature = 'topicArt'").get() as { n: number }).n)

const setPref = (engine: RunningEngine, key: string, value: unknown) => runCommand(engine.registry, prefsSet, { key, value: value as never })

/** A thread posted now in #eng, with a reply from the signed-in user, so Slack follows it and it enters the sidebar. */
function liveThread(engine: RunningEngine, text: string): { readonly id: string } {
  const root = engine.fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text })
  engine.fake.workspace.post({ channel: 'C0ENG', user: SELF_ID, text: 'Looking.', threadTs: root.ts })
  return { id: `t:C0ENG:${root.ts}` }
}

async function checkInitialArt(engine: RunningEngine): Promise<void> {
  const rows = await drawnRows(engine)
  const drawn = rows.filter((row) => !isDmMain(row) && hasArt(row))
  expect(drawn.length).toBeGreaterThan(3)
  expect(drawn.some(isMain)).toBe(true)
  expect(drawn.some((row) => row.kind === 'thread' && row.channel.kind === 'im')).toBe(true)
  for (const row of drawn) {
    const parsed = parseRecipe(row.art!)
    expect(parsed.ok, `${row.title}: ${row.art}`).toBe(true)
    if (parsed.ok) expect(parsed.recipe.confident).toBe(true)
  }
  // A DM's Main is the person: no drawing, and none asked for.
  const dmMains = rows.filter(isDmMain)
  expect(dmMains.length).toBeGreaterThan(0)
  expect(dmMains.every((row) => row.art === undefined)).toBe(true)
  const stored = storedArt(engine)
  expect(stored.filter((row) => row.topic_id.startsWith('m:D0'))).toEqual([])
  for (const row of drawn) expect(stored.find((entry) => entry.topic_id === row.id)).toMatchObject({ status: 'ok', source: 'ai', recipe: row.art })

  // The header carries the same recipe as the row.
  const [first] = drawn
  unmounts.push(engine.registry.mount(topicAtom(first!.id)))
  const detail = await waitFor(() => {
    const result = engine.registry.get(topicAtom(first!.id))
    return result._tag === 'Success' && result.value?.art !== undefined ? result.value : undefined
  }, WAIT_MS, 'the header with art')
  expect(detail.art).toBe(first!.art)
}

async function checkFailedArt(engine: RunningEngine): Promise<void> {
  const thread = liveThread(engine, 'Broken drawing ::invalid-art:: for this thread')
  // Only explicit art passes run: a title must finish before its first drawing.
  await engine.rowsUntil((rows) => rows.some((row) => row.id === thread.id) && rows.filter((row) => row.kind === 'thread').every((row) => row.titleSource === 'ai'), 'all threads titled')
  await engine.workPass('art')
  const stored = await waitFor(() => storedArt(engine).find((row) => row.topic_id === thread.id), WAIT_MS, 'the failed attempt stored')
  expect(stored).toMatchObject({ status: 'failed', recipe: '' })
  const rows = await drawnRows(engine)
  expect(rows.find((row) => row.id === thread.id)!.art).toBeUndefined()
  const asked = artCalls(engine)
  // A later pass draws a new thread and does not ask about the failed one again.
  const next = liveThread(engine, 'Postgres replica lag after the failed drawing')
  await engine.rowsUntil((rows) => rows.some((row) => row.id === next.id && row.titleSource === 'ai'), 'the next thread titled')
  await engine.workPass('art')
  await engine.rowsUntil((later) => later.some((row) => row.id === next.id && hasArt(row)), 'the next thread drawn')
  expect(artCalls(engine)).toBe(asked + 1)
  const again = engine.registry.get(engine.topicsAtom())
  expect(again._tag === 'Success' ? again.value.rows.get(thread.id)?.art : 'no rows').toBeUndefined()
}

describe('topic art', () => {
  it('draws sidebar and header art, redraws and undoes it, then hides and restores it with AI assist', async () => {
    const engine = await bootedEngine()

    await step('draws every thread and channel Main in the sidebar, keeps the photo on a DM Main, and stores each drawing once', () => checkInitialArt(engine))

    await step('Redraw replaces a drawing with a different one, and Undo after a Redraw puts the previous one back', async () => {
      const rows = await drawnRows(engine)
      const target = rows.find((row) => row.kind === 'thread' && hasArt(row))!

      // Redraw replaces a drawing with a different one, in the rows and in the store.
      expect(await redrawTopic(engine.registry, target.id, { text: 'Redrawn' })).toBeUndefined()
      const after = await engine.rowsUntil((next) => {
        const row = next.find((candidate) => candidate.id === target.id)
        return row !== undefined && hasArt(row) && row.art !== target.art
      }, 'the redrawn row')
      const redrawn = after.find((row) => row.id === target.id)!
      expect(parseRecipe(redrawn.art!).ok).toBe(true)
      expect(storedArt(engine).find((row) => row.topic_id === target.id)).toMatchObject({ source: 'redraw', status: 'ok', recipe: redrawn.art })
      // Every other row kept its drawing and its object.
      for (const row of rows) if (row.id !== target.id) expect(after.find((candidate) => candidate.id === row.id)).toBe(row)

      // Undo after Redraw puts the previous drawing back, in the rows and in the store.
      const before = storedArt(engine).find((row) => row.topic_id === target.id)
      expect(await runAction(engine.registry, artRedraw, { id: target.id }, { text: 'Redrawn' })).toBe(true)
      await engine.rowsUntil((next) => next.some((row) => row.id === target.id && hasArt(row) && row.art !== redrawn.art), 'the row redrawn again')
      expect(await undoLast(engine.registry)).toBe(true)
      await engine.rowsUntil((next) => next.some((row) => row.id === target.id && row.art === redrawn.art), 'the previous drawing back')
      expect(storedArt(engine).find((row) => row.topic_id === target.id)).toEqual(before)
    })

    await step('shows the placeholder everywhere while AI assist is off, draws nothing new, and brings the drawings back when it is on again', async () => {
      // The title job can replace a fallback drawing once; wait before taking the baseline.
      await engine.rowsUntil(rows => rows.some(row => row.kind === 'thread') && rows.filter(row => row.kind === 'thread').every(row => row.titleSource === 'ai'), 'sidebar threads titled')
      const before = await drawnRows(engine)
      expect(before.some(hasArt)).toBe(true)
      const count = storedArt(engine).length

      valueOf(await setPref(engine, 'aiAssist', false))
      const off = await engine.rowsUntil((rows) => rows.length > 0 && rows.every((row) => row.art === undefined), 'every row without art')
      expect(off.length).toBe(before.length)
      // A new thread the user replies in (so Slack follows it) arrives: no drawing is made for it.
      const thread = liveThread(engine, 'Postgres replica lag while AI is off')
      await engine.rowsUntil((rows) => rows.some((row) => row.id === thread.id), 'the new thread in the sidebar')
      await engine.workPass('art')
      expect(storedArt(engine).length).toBe(count)
      expect(storedArt(engine).find((row) => row.topic_id === thread.id)).toBeUndefined()

      valueOf(await setPref(engine, 'aiAssist', true))
      const back = await drawnRows(engine)
      for (const row of before) expect(back.find((candidate) => candidate.id === row.id)?.art).toBe(row.art)
      // The thread that arrived while AI was off is drawn now.
      expect(hasArt(back.find((row) => row.id === thread.id)!)).toBe(true)
    })
  })

  it('keeps the placeholder for a topic the model cannot draw within the vocabulary, and does not ask again', async () => {
    const time = await controlledSleep(30_000)
    const engine = await bootedEngine({ clock: time.clock, timing: { artDebounceMillis: 30_000 } })
    try {
      await checkFailedArt(engine)
    } finally {
      await engine.stop()
      engines.splice(engines.indexOf(engine), 1)
      await time.close()
    }
  })
})

