/**
 * The engine's notifications reach main's `Notifier`: the real engine
 * against the fake Slack, over the host link main uses in the app, with a
 * fake Electron notification and dock. The engine's own decisions are
 * packages/engine/test/flows/notifications.flow.test.ts.
 */
import { afterEach, expect, it } from 'bun:test'
import { notificationsDecisions, notificationsPage, notificationsSetLevel, prefsSet, readsMarkRead, type MainToEngine, type NotificationDecisions, type NotificationsPage, type NotificationTarget } from '@juno/contract'
import { liveQuery, runCommand } from '@juno/state'
import { Exit, Schema } from 'effect'
import { readDb } from '../../../packages/engine/test/scenario'
import { waitFor, type RunningEngine } from '../../../packages/engine/test/harness'
import { step } from '../../../packages/engine/test/step'
import { syncedEngine } from '../../../packages/engine/test/synced'
import { HIDDEN_BODY, Notifier } from '../src/main/notifier'

const engines: RunningEngine[] = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0)) await engine.stop()
})

/** Main's notifier on the engine's host link, with Electron faked. */
function connect(engine: RunningEngine) {
  const shown: Array<{ readonly title: string; readonly body: string; click: () => void }> = []
  const opened: NotificationTarget[] = []
  let badge = ''
  let privacy = false
  const notifier = new Notifier({
    create: (options) => {
      const entry = { ...options, click: () => {} }
      return {
        show: () => shown.push(entry),
        close: () => {},
        onClick: (listener) => {
          entry.click = listener
        },
      }
    },
    setBadge: (text) => {
      badge = text
    },
    bounce: () => {},
    open: (target) => opened.push(target),
    focus: () => {},
    send: (message: MainToEngine) => engine.main.host.deliver(message),
    privacy: () => privacy,
  })
  // Main hears the engine from its start; the test connects after the boot.
  for (const message of engine.main.host.fromEngine) notifier.handle(message)
  engine.main.host.onEngine((message) => {
    notifier.handle(message)
  })
  return {
    notifier,
    shown,
    opened,
    badge: () => badge,
    setPrivacy: (on: boolean) => {
      privacy = on
    },
  }
}

/** A live query's value once `pick` finds something in it. */
function liveUntil<A, B>(engine: RunningEngine, atom: Parameters<RunningEngine['registry']['mount']>[0], pick: (value: A) => B | undefined, label: string): Promise<B> {
  unmounts.push(engine.registry.mount(atom))
  return waitFor(() => {
    const value = (engine.registry.get(atom) as { value?: A }).value
    return value === undefined ? undefined : pick(value)
  }, 15_000, label)
}

it('shows what the engine decides, opens the message on click, holds a topic on screen with its reason, hides text in privacy mode and badges unread topics', async () => {
  const engine = await syncedEngine(engines)
  const main = connect(engine)
  const level = (id: string, choice: 'always' | 'auto') => runCommand(engine.registry, notificationsSetLevel, { target: { kind: 'channel', id }, choice })

  // Hours around now: nothing notifies outside them, not even Always.
  const minute = new Date().getHours() * 60 + new Date().getMinutes()
  const hours = { days: [0, 1, 2, 3, 4, 5, 6], from: (minute + 1380) % 1440, to: (minute + 60) % 1440 }
  await runCommand(engine.registry, prefsSet, { key: 'notifications', value: Schema.decodeUnknownSync(Schema.Json)({
    notificationHours: hours, presenceHours: hours, channels: {}, people: {},
  }) })
  await level('D0SAM', 'always')

  await step('a DM on Always shows as a banner and opens its message on click', async () => {
    const set = await level('D0MAYA', 'always')
    expect(Exit.isSuccess(set) && set.value).toEqual({ undo: { _tag: 'notifications.setLevel', target: { kind: 'channel', id: 'D0MAYA' }, choice: 'auto' } })
    const first = engine.fake.injectMessage({ channel: 'D0MAYA', user: 'U0MAYA', text: 'Can you look at the draft?' })
    await waitFor(() => (main.shown.length === 1 ? true : undefined), 15_000, 'the first notification')
    expect(main.shown[0]).toMatchObject({ title: 'Maya', body: 'Can you look at the draft?' })
    main.shown[0]?.click()
    expect(main.opened).toEqual([{ _tag: 'message', source: { channelId: 'D0MAYA', ts: first.ts, topicId: 'm:D0MAYA' } }])
  })

  await step('a topic on screen in a focused window is decided and held, with why, and Today counts it the same way', async () => {
    main.notifier.setViewing('m:D0SAM')
    engine.fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: 'Never mind, found it' })
    const held = await liveUntil<NotificationDecisions, NotificationDecisions['decisions'][number]>(engine, liveQuery(notificationsDecisions)(undefined),
      (value) => value.decisions.find((row) => row.text === 'Never mind, found it' && row.outcome === 'stay'), 'the held decision')
    expect(held.reason).toBe('You had the conversation open.')
    expect(main.shown).toHaveLength(1)
    main.notifier.setViewing(null)
    const page = await liveUntil<NotificationsPage, NotificationsPage>(engine, liveQuery(notificationsPage)(undefined), (value) => value, 'the page')
    expect(page.notified).toBe(main.shown.length)
  })

  await step('privacy mode still says who it is from, never what they wrote', async () => {
    main.setPrivacy(true)
    engine.fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: 'The salary sheet is attached' })
    await waitFor(() => (main.shown.length === 2 ? true : undefined), 15_000, 'the notification in privacy mode')
    expect(main.shown[1]).toMatchObject({ title: expect.stringMatching(/^Sam/), body: HIDDEN_BODY })
    main.setPrivacy(false)
  })

  await step('reading every unread topic clears the dock badge, and a new mention brings it back', async () => {
    const unread = readDb(engine, 'cache.db', (db) => db.prepare('SELECT topic_id FROM topic_index WHERE unread_count > 0').all()) as Array<{ topic_id: string }>
    expect(unread.length).toBeGreaterThan(0)
    expect(main.badge()).toBe('•')
    for (const { topic_id } of unread) await runCommand(engine.registry, readsMarkRead, { id: topic_id })
    await waitFor(() => (main.badge() === '' ? true : undefined), 15_000, 'the badge to clear')
    await level('C0ENG', 'always')
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: '<@U0TUSHAR> can you review the plan?' })
    await waitFor(() => (main.badge() === '•' ? true : undefined), 15_000, 'the dock badge')
  })
})
