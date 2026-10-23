/**
 * The engine's notifications reach main's `Notifier`: the real engine
 * against the fake Slack, over the host link main uses in the app, with a
 * fake Electron notification and dock.
 */
import { afterEach, expect, it } from 'vitest'
import { notificationsSetLevel, prefsSet, readsMarkRead, type MainToEngine, type NotificationTarget } from '@juno/contract'
import { runCommand } from '@juno/state'
import { Exit, Schema } from 'effect'
import { bootedEngine, readDb } from '../../../packages/engine/test/scenario'
import { waitFor, type RunningEngine } from '../../../packages/engine/test/harness'
import { HIDDEN_BODY, Notifier } from '../src/main/notifier'

const engines: RunningEngine[] = []
afterEach(async () => {
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

it('shows what the engine decides, opens the message on click, hides the topic on screen and badges unread topics', async () => {
  const engine = await bootedEngine(engines)
  const main = connect(engine)

  // Hours around now: nothing notifies outside them, not even Always.
  const minute = new Date().getHours() * 60 + new Date().getMinutes()
  const hours = { days: [0, 1, 2, 3, 4, 5, 6], from: (minute + 1380) % 1440, to: (minute + 60) % 1440 }
  await runCommand(engine.registry, prefsSet, { key: 'notifications', value: Schema.decodeUnknownSync(Schema.Json)({
    notificationHours: hours, presenceHours: hours, channels: {}, people: {},
  }) })
  await runCommand(engine.registry, notificationsSetLevel, { target: { kind: 'channel', id: 'D0SAM' }, choice: 'always' })
  const set = await runCommand(engine.registry, notificationsSetLevel, { target: { kind: 'channel', id: 'D0MAYA' }, choice: 'always' })
  expect(Exit.isSuccess(set) && set.value).toEqual({ undo: { _tag: 'notifications.setLevel', target: { kind: 'channel', id: 'D0MAYA' }, choice: 'auto' } })

  const first = engine.fake.injectMessage({ channel: 'D0MAYA', user: 'U0MAYA', text: 'Can you look at the draft?' })
  await waitFor(() => (main.shown.length === 1 ? true : undefined), 15_000, 'the first notification')
  expect(main.shown[0]).toMatchObject({ title: 'Maya', body: 'Can you look at the draft?' })
  main.shown[0]?.click()
  expect(main.opened).toEqual([{ _tag: 'message', source: { channelId: 'D0MAYA', ts: first.ts, topicId: 'm:D0MAYA' } }])

  // Sam's DM is on screen in a focused window: decided, logged, not shown. (Maya's DM stays quiet for a minute after its banner.)
  main.notifier.setViewing('m:D0SAM')
  const second = engine.fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: 'Never mind, found it' })
  await waitFor(() => readDb(engine, 'user.db', (db) => db.prepare('SELECT suppressed_at FROM notification_log WHERE ts = ?').get(second.ts))?.suppressed_at ?? undefined, 15_000, 'the suppressed row')
  expect(main.shown).toHaveLength(1)
  main.notifier.setViewing(null)

  // Privacy mode: the notification still says who it is from, never what they wrote.
  main.setPrivacy(true)
  engine.fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: 'The salary sheet is attached' })
  await waitFor(() => (main.shown.length === 2 ? true : undefined), 15_000, 'the notification in privacy mode')
  expect(main.shown[1]).toMatchObject({ title: expect.stringMatching(/^Sam/), body: HIDDEN_BODY })
  main.setPrivacy(false)

  // Reading all unread topics clears the badge; a new mention brings it back.
  const mentioned = readDb(engine, 'cache.db', (db) => db.prepare('SELECT topic_id FROM topic_index WHERE unread_count > 0').all()) as Array<{ topic_id: string }>
  expect(mentioned.length).toBeGreaterThan(0)
  expect(main.badge()).toBe('•')
  for (const { topic_id } of mentioned) await runCommand(engine.registry, readsMarkRead, { id: topic_id })
  await waitFor(() => (main.badge() === '' ? true : undefined), 15_000, 'the badge to clear')
  await runCommand(engine.registry, notificationsSetLevel, { target: { kind: 'channel', id: 'C0ENG' }, choice: 'always' })
  engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: '<@U0TUSHAR> can you review the plan?' })
  await waitFor(() => (main.badge() === '•' ? true : undefined), 15_000, 'the dock badge')
})
