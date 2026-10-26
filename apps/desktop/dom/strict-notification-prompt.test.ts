// macOS's notification prompt waits for Home (SPEC 14): no prompt while Set up Juno shows, though the dock dot
// already does, and the first Home view after it asks once, before any banner. A denied answer remembered across a
// full restart needs main, so it is the Electron lane's (`e2e/notification-badge.spec.ts`). The dot's rules are the
// engine's notifications flow test.
import { caughtUpSeed } from '../e2e/caughtUpSeed'
import { expect } from './expect'
import { domTest } from './test'

domTest('no permission prompt during onboarding, and the first Home view asks before any notification is shown', async ({ juno }) => {
  await juno.setNotificationPermission({ authorization: 'notDetermined', badges: 'unknown' })
  await juno.signIn({ skipSetUp: false })
  await expect(juno.setUp).toBeVisible()
  await expect.poll(() => juno.dockBadge()).toBe('•')
  expect(await juno.surface.system('notificationRequests')).toBe(0)
  await juno.skipSetUp()
  await juno.waitForSync()
  await expect.poll(() => juno.surface.system('notificationRequests')).toBe(1)
  expect(await juno.osNotifications()).toEqual([])
  await juno.openNotifications()
  await expect(juno.notifications.root.getByRole('status', { name: 'Notification permission' })).toHaveCount(0)
}, { synced: false, fake: { seed: caughtUpSeed } })
