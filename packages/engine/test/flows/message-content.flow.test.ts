// What a message shows in a topic against the fake Slack: one sender's messages share a header until ten
// quiet minutes pass, Main's thread link previews the first reply and
// names the first three repliers, a user group mention reads as its handle, and an image Slack filled in late
// becomes the picture when its topic opens (architecture 9, "Late thumbnails"). Every test starts warm on the
// synced default workspace.
import { afterEach, expect, it } from 'bun:test'
import type { MessageView } from '@juno/contract'
import { messagesAtom, openTopic, type ListWindow, type LiveListAtom } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { apiCalls, quiet, threadId, tsOf, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const synced = () => syncedEngine(engines)

/** A mounted list atom: its current window, and a wait for a window `predicate` accepts. */
function watchList<Row, E>(engine: RunningEngine, atom: LiveListAtom<Row, E>) {
  unmounts.push(engine.registry.mount(atom))
  const current = (): ListWindow<Row> | undefined => {
    const result = engine.registry.get(atom)
    return result._tag === 'Success' && result.value.meta.seq > 0 ? result.value : undefined
  }
  const until = (predicate: (window: ListWindow<Row>) => boolean, label: string) =>
    waitFor(() => {
      const window = current()
      return window !== undefined && predicate(window) ? window : undefined
    }, WAIT_MS, label)
  return { current: () => current()!, until }
}

const rowsOf = <Row>(window: ListWindow<Row>) => window.order.map((id) => window.rows.get(id)!)

const textOf = (row: MessageView) =>
  row.body.blocks
    .flatMap((block) => ('children' in block ? block.children : []))
    .map((inline) => ('text' in inline ? inline.text : ''))
    .join('')

it("Main's thread link previews the first reply once the thread is opened, and names its first three repliers", async () => {
  const engine = await synced()
  const thread = threadId(engine.fake, 'C0ENG', 'checkout.spec failed again')
  const root = tsOf(thread)
  const main = watchList(engine, messagesAtom('m:C0ENG'))
  const link = (window: ListWindow<MessageView>) => window.rows.get(root)?.thread

  await step('before the thread is opened, the link has its count and no preview: Main never fetches replies', async () => {
    expect(link(await main.until((window) => link(window)?.replyCount === 5, 'the thread link'))?.preview).toBeUndefined()
  })

  await step('after the open, the link previews the first reply, not the root or the newest reply', async () => {
    expect(valueOf(await openTopic(engine.registry, thread)).outcome).toBe('fetched')
    const window = await main.until((value) => link(value)?.preview !== undefined, 'the preview')
    expect(link(window)).toMatchObject({ replyCount: 5, preview: 'Sam: Quarantining it. Ticket filed.', replierIds: ['U0SAM', 'U0DEV'] })
  })

  await step('new replies keep the first reply as the preview and add repliers up to three, in Slack order', async () => {
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', threadTs: root, text: 'I will check the frame load.' })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', threadTs: root, text: 'I can take the ticket.' })
    const window = await main.until((value) => link(value)?.replyCount === 7, 'seven replies')
    expect(link(window)).toMatchObject({ preview: 'Sam: Quarantining it. Ticket filed.', replierIds: ['U0SAM', 'U0DEV', 'U0MAYA'] })
  })
})

it('a user group mention reads as its handle in Main, a thread and the sidebar, a deleted group keeps its name, and a rename reaches the open thread', async () => {
  const engine = await synced()
  const postgres = threadId(engine.fake, 'C0ENG', 'Draft plan is in the doc')
  valueOf(await openTopic(engine.registry, postgres))
  const thread = watchList(engine, messagesAtom(postgres))
  const main = watchList(engine, messagesAtom('m:C0ENG'))
  // Slack sends the bare id; the handle comes from `usergroups.list`.
  const old = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Old pager notes from <!subteam^S0OLDOPS> are archived.' })
  const design = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: '<!subteam^S0DESIGN> the new icons are ready for review.' })
  const ask = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', threadTs: tsOf(postgres), text: '<!subteam^S0PLATFORM> can someone review the cutover runbook?' })
  const group = (window: ListWindow<MessageView>, ts: string) => window.rows.get(ts)?.body.blocks.flatMap((block) => ('children' in block ? block.children : [])).find((inline) => inline.kind === 'usergroup')

  await step('Main names the group by its handle, and a deleted group by the handle it had', async () => {
    const window = await main.until((value) => value.rows.has(old.ts) && value.rows.has(design.ts), 'the mentions in Main')
    expect([group(window, design.ts), group(window, old.ts)]).toMatchObject([{ id: 'S0DESIGN', handle: 'design-crew', name: 'Design crew' }, { id: 'S0OLDOPS', handle: 'old-ops' }])
  })

  await step('the sidebar previews read the handle, never the id', async () => {
    const rows = await engine.rowsUntil((list) => list.find((row) => row.id === 'm:C0ENG')?.preview.text.startsWith('@design-crew the new icons') === true
      && list.find((row) => row.id === postgres)?.preview.text.startsWith('@platform can someone review') === true, 'the handles in the previews')
    expect(rows.filter((row) => /S0[A-Z]+/.test(`${row.title} ${row.preview.text}`)).map((row) => row.id)).toEqual([])
  })

  await step('the thread names it, and a rename from another client reaches it', async () => {
    expect(group(await thread.until((value) => value.rows.has(ask.ts), 'the mention in the thread'), ask.ts)).toMatchObject({ id: 'S0PLATFORM', handle: 'platform', name: 'Platform team' })
    engine.fake.putUsergroup({ id: 'S0PLATFORM', handle: 'platform-core', name: 'Platform core' })
    const renamed = await thread.until((value) => JSON.stringify(group(value, ask.ts)).includes('platform-core'), 'the new handle')
    expect(group(renamed, ask.ts)).toMatchObject({ handle: 'platform-core', name: 'Platform core' })
  })
})

it('an image Slack had no thumbnail for becomes the picture: retried on reopen after its lookups ran out, and an old card on open', async () => {
  // The four lookups wait 1, 3, 10 and 30 times this.
  const engine = await syncedEngine(engines, { timing: { fileRetryMillis: 5 } })
  const { fake } = engine
  const lookups = (method: string) => apiCalls(engine, method).filter((call) => call.args['_x_reason'] === 'file')
  const image = (window: ListWindow<MessageView>, text: string) => rowsOf(window).find((row) => textOf(row) === text)?.files[0]

  await step('a fresh image is looked up four times, an open asks four times more, and the reopen after Slack made it brings the picture', async () => {
    const main = watchList(engine, messagesAtom('m:C0ENG'))
    fake.holdThumbnails()
    fake.resetCalls()
    fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Slow image processing', media: [{ name: 'late.png', width: 800, height: 600 }] })
    await main.until((window) => image(window, 'Slow image processing') !== undefined, 'the card')
    await waitFor(() => (lookups('conversations.history').length === 4 ? true : undefined), WAIT_MS, 'four lookups')
    // Opened while Slack still has no thumbnail: the open's page stores the message, and its lookups start again.
    valueOf(await openTopic(engine.registry, 'm:C0ENG'))
    await waitFor(() => (lookups('conversations.history').length === 8 ? true : undefined), WAIT_MS, 'four more lookups')
    // No message update or file event comes, and the next open's page starts after the message.
    fake.releaseThumbnails({ event: 'none' })
    await quiet(engine)
    expect(image(main.current(), 'Slow image processing')?.thumb).toBeUndefined()
    valueOf(await openTopic(engine.registry, 'm:C0ENG'))
    const window = await main.until((value) => image(value, 'Slow image processing')?.thumb !== undefined, 'the picture after the reopen')
    expect(image(window, 'Slow image processing')).toMatchObject({ kind: 'image', width: 800, height: 600 })
  })

  await step('an old card stored before Slack made its thumbnail becomes the picture through file info when its topic opens', async () => {
    // Two days old as it arrives, it is too old to be asked about then.
    fake.holdThumbnails()
    fake.resetCalls()
    fake.injectMedia({ channel: 'C0PRODUCT', user: 'U0LEO', text: 'The venue floor plan', ago: 2 * 24 * 60, media: [{ name: 'floor-plan.png', width: 800, height: 600 }] })
    fake.releaseThumbnails({ event: 'none' })
    await quiet(engine)
    expect(lookups('files.info')).toHaveLength(0)
    const product = watchList(engine, messagesAtom('m:C0PRODUCT'))
    valueOf(await openTopic(engine.registry, 'm:C0PRODUCT'))
    const window = await product.until((value) => image(value, 'The venue floor plan')?.thumb !== undefined, 'the picture after the open')
    expect(image(window, 'The venue floor plan')).toMatchObject({ kind: 'image', width: 800, height: 600 })
    expect(lookups('files.info').length).toBeGreaterThan(0)
    expect(lookups('files.info').every((call) => call.ok)).toBe(true)
    expect(lookups('conversations.history')).toHaveLength(0)
  })
})

it("one sender's replies share a header until ten quiet minutes pass", async () => {
  const engine = await synced()
  const minutes = (ago: number) => engine.fake.now() - ago * 60_000
  const root = engine.fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Header gap thread', at: minutes(40), silent: true })
  for (const [text, ago] of [['First after the root', 30], ['Nine minutes later', 21], ['Ten quiet minutes later', 11], ['Right after that', 10]] as const) {
    engine.fake.workspace.post({ channel: 'C0ENG', threadTs: root.ts, user: 'U0MAYA', text, at: minutes(ago), silent: true })
  }
  const id = threadId(engine.fake, 'C0ENG', 'Header gap thread')
  const list = watchList(engine, messagesAtom(id))
  valueOf(await openTopic(engine.registry, id))
  const window = await list.until((value) => value.order.length === 5, 'the root and its four replies')
  expect(rowsOf(window).map((row) => [textOf(row), row.groupStart])).toEqual([
    ['Header gap thread', true],
    ['First after the root', true],
    ['Nine minutes later', false],
    ['Ten quiet minutes later', true],
    ['Right after that', false],
  ])
})
