import { startFakeSlack } from '@juno/fake-slack'
import { caughtUpSeed } from './caughtUpSeed'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'
import { hooks } from './hooks'

const badgeTest = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: caughtUpSeed })
    await use(fake)
    await fake.close()
  },
})

// The dot's rules (unread DMs, group DMs and mentions through reads, Notify me, kept-out views, Automated) are in the
// engine's notifications flow test; the host sends the dot in the DOM lane's notifications test, and what it does across
// an engine restart is in the restart journey (juno-agent/crash.spec.ts). No prompt during onboarding, and the first
// Home view asking, are in the DOM lane (`dom/strict-notification-prompt.test.ts`).

badgeTest('a denied request is remembered across a full app restart', { tag: '@electron' }, async ({ fake, slackApp, userData }) => {
  const options = { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, notificationInitial: 'notDetermined' as const, notificationResponse: 'denied' as const }
  const first = await launchApp(userData, options)
  try {
    const juno = new Juno(first.app, first.win)
    await juno.signIn()
    await expect.poll(() => hooks(first.app, 'notificationRequests')).toBe(1)
  } finally { await first.close() }
  // Deliberately report notDetermined again: even an ignored or unrecorded OS prompt must not repeat.
  const second = await launchApp(userData, options)
  try {
    const juno = new Juno(second.app, second.win)
    await juno.waitForSync()
    expect(await hooks(second.app, 'notificationRequests')).toBe(0)
    await juno.openNotifications()
    await juno.notifications.root.getByRole('button', { name: 'Allow notifications' }).click()
    await expect.poll(() => hooks(second.app, 'notificationRequests')).toBe(1)
  } finally { await second.close() }
})
