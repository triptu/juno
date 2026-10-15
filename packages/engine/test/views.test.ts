// Sidebar views (SPEC section 5, "Views") against the fake Slack: a view
// gathers its conversations, Keep these out of All takes them out of the
// other filters, and delete, add and remove undo through the commands they
// return. Views are local: nothing reaches Slack.
import { afterEach, describe, expect, it } from 'vitest'
import { topicsCounts, viewsAddChannel, viewsDelete, viewsList, viewsRemoveChannel, viewsReorder, viewsSave, type SidebarView, type TopicCounts } from '@juno/contract'
import { liveQuery, runCommand, undoStackAtom, undoLast } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { bootedEngine, valueOf } from './scenario'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

function valueUntil<A>(engine: RunningEngine, atom: Parameters<RunningEngine['registry']['mount']>[0], predicate: (value: A) => boolean, label: string): Promise<A> {
  unmounts.push(engine.registry.mount(atom))
  return waitFor(() => {
    const result = engine.registry.get(atom) as { _tag: string; value?: A }
    return result._tag === 'Success' && predicate(result.value!) ? { value: result.value! } : undefined
  }, WAIT_MS, label).then((found) => found.value)
}

const viewsUntil = (engine: RunningEngine, predicate: (views: ReadonlyArray<SidebarView>) => boolean, label: string) =>
  valueUntil<ReadonlyArray<SidebarView>>(engine, liveQuery(viewsList)(undefined), predicate, label)

const countsUntil = (engine: RunningEngine, predicate: (counts: TopicCounts) => boolean, label: string) =>
  valueUntil<TopicCounts>(engine, liveQuery(topicsCounts)({}), predicate, label)

const channelsOf = (rows: ReadonlyArray<{ readonly channel: { readonly id: string } }>) => new Set(rows.map((row) => row.channel.id))

describe('sidebar views', () => {
  it('gathers its conversations, keeps them out of All, lights its dot for a mention, and undoes a delete', async () => {
    const engine = await bootedEngine(engines)
    const callsBefore = engine.fake.callCount()
    const all = await engine.rowsUntil((rows) => channelsOf(rows).has('C0ALERTSPROD') && channelsOf(rows).has('C0HIRING'), 'alerts and hiring in All')
    expect(all.length).toBeGreaterThan(5)

    const { id } = valueOf(await runCommand(engine.registry, viewsSave, { name: '  Bots  ', icon: 'robot', keepOutOfAll: true, channels: ['C0ALERTSPROD'] }))
    const [view] = await viewsUntil(engine, (views) => views.length === 1, 'the new view')
    expect(view).toMatchObject({ id, name: 'Bots', icon: 'robot', keepOutOfAll: true, channels: [{ id: 'C0ALERTSPROD', name: 'alerts-prod', label: '#alerts-prod' }] })

    // The view shows only its conversation; All, Channels and the scope's rule follow Keep these out of All.
    const inView = await engine.rowsUntil((rows) => rows.length > 0, 'the view', { kind: 'all', unreadOnly: false, view: id })
    expect([...channelsOf(inView)]).toEqual(['C0ALERTSPROD'])
    await engine.rowsUntil((rows) => !channelsOf(rows).has('C0ALERTSPROD') && channelsOf(rows).has('C0HIRING'), 'alerts out of All')
    await engine.rowsUntil((rows) => !channelsOf(rows).has('C0ALERTSPROD') && rows.length > 0, 'alerts out of Channels', { kind: 'channels', unreadOnly: false })
    await engine.rowsUntil((rows) => channelsOf(rows).has('C0ALERTSPROD'), 'a scope still shows it', { kind: 'all', unreadOnly: false, scope: 'C0ALERTSPROD' })

    // Plain unread lights nothing; a mention lights the view's dot.
    expect((await countsUntil(engine, () => true, 'counts')).viewMentions).toEqual([])
    engine.fake.injectMessage({ channel: 'C0ALERTSPROD', user: 'U0LEO', text: '<@U0TUSHAR> the pager is yours tonight' })
    await countsUntil(engine, (counts) => counts.viewMentions.includes(id), 'the view dot')

    // Add and remove return each other as their undo.
    const added = valueOf(await runCommand(engine.registry, viewsAddChannel, { id, channel: 'C0HIRING' }))
    expect(added.undo).toEqual({ _tag: 'views.removeChannel', id, channel: 'C0HIRING' })
    await engine.rowsUntil((rows) => !channelsOf(rows).has('C0HIRING'), 'hiring kept out of All too')
    expect(valueOf(await runCommand(engine.registry, viewsAddChannel, { id, channel: 'C0HIRING' })).undo).toBeUndefined()
    valueOf(await runCommand(engine.registry, viewsRemoveChannel, { id, channel: 'C0HIRING' }))
    await engine.rowsUntil((rows) => channelsOf(rows).has('C0HIRING'), 'hiring back in All')

    // A second view goes last; reorder moves it first.
    const second = valueOf(await runCommand(engine.registry, viewsSave, { name: 'Team', keepOutOfAll: false, channels: ['C0ENG', 'D0SAM'] }))
    await viewsUntil(engine, (views) => views.map((v) => v.id).join() === `${id},${second.id}`, 'two views')
    valueOf(await runCommand(engine.registry, viewsReorder, { ids: [second.id, id] }))
    const reordered = await viewsUntil(engine, (views) => views[0]?.id === second.id, 'Team first')
    expect(reordered[0]!.channels.map((c) => c.kind)).toEqual(['public', 'im'])

    // Delete, then Undo from the stack: the view comes back whole, in its place, and keeps its conversations out of All again.
    const deleted = valueOf(await runCommand(engine.registry, viewsDelete, { id }))
    expect(deleted.undo).toMatchObject({ _tag: 'views.restore', view: { id, name: 'Bots', icon: 'robot', keepOutOfAll: true, channels: ['C0ALERTSPROD'], position: 1 } })
    await engine.rowsUntil((rows) => channelsOf(rows).has('C0ALERTSPROD'), 'alerts back in All')
    engine.registry.set(undoStackAtom, [deleted.undo!])
    expect(await undoLast(engine.registry)).toBe(true)
    const restored = await viewsUntil(engine, (views) => views.length === 2, 'the view restored')
    expect(restored.map((v) => v.id)).toEqual([second.id, id])
    await engine.rowsUntil((rows) => !channelsOf(rows).has('C0ALERTSPROD'), 'alerts out of All again')

    // Views are Juno's own: no call writes anything to Slack (the reads above are the sync's).
    const writes = engine.fake.calls.slice(callsBefore).filter((call) => call.kind === 'api' && /^(views|chat|conversations\.(mark|create|join)|subscriptions\.thread\.(add|remove)|users\.prefs)\b/.test(call.method ?? ''))
    expect(writes.map((call) => call.method)).toEqual([])
  }, 90_000)

  it('refuses a blank name', async () => {
    const engine = await bootedEngine(engines)
    const exit = await runCommand(engine.registry, viewsSave, { name: '   ', keepOutOfAll: false, channels: [] })
    expect(exit._tag).toBe('Failure')
  })
})
