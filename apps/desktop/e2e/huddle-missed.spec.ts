import { SELF_ID } from '@juno/fake-slack'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

async function revisit(juno: Juno) {
  await juno.sidebar.row('#eng').open()
  await juno.home.open()
}

test('a dismissed huddle appears after it ends; opening it clears it across a relaunch', async ({ juno, fake, win, running, userData, slackApp }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  fake.control('startHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
  const card = win.getByRole('region', { name: 'Incoming huddle' })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Dismiss' }).click()
  fake.control('endHuddle', { channel: 'D0MAYA' })
  await expect.poll(async () => {
    await revisit(juno)
    return juno.home.title('missedHuddle').allTextContents()
  }).toEqual(['Missed huddle with Maya'])
  await expect(juno.home.meta('missedHuddle')).toContainText('1 min')
  await juno.home.openItem('missedHuddle')
  await juno.topic.expectTitle('Maya')
  await revisit(juno)
  await expect(juno.home.item('missedHuddle')).toHaveCount(0)
  await running.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const next = new Juno(again.app, again.win)
    await next.waitForSync()
    await next.home.open()
    await expect(next.home.item('missedHuddle')).toHaveCount(0)
  } finally { await again.close() }
})

test('history recovers an offline miss and a later join on another device clears it', async ({ juno, fake, win }) => {
  fake.control('startHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
  fake.control('endHuddle', { channel: 'D0MAYA' })
  // Joining even briefly means this other huddle was not missed.
  fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0LEO' })
  fake.control('joinHuddle', { channel: 'C0PRODUCT', user: SELF_ID })
  fake.control('leaveHuddle', { channel: 'C0PRODUCT', user: SELF_ID })
  fake.control('endHuddle', { channel: 'C0PRODUCT' })
  await juno.signIn()
  await juno.waitForSync()
  await revisit(juno)
  await expect(juno.home.title('missedHuddle')).toHaveText('Missed huddle with Maya')
  await expect(win.getByRole('region', { name: 'Incoming huddle' })).toBeHidden()
  fake.control('startHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
  fake.control('joinHuddle', { channel: 'D0MAYA', user: SELF_ID })
  fake.control('endHuddle', { channel: 'D0MAYA' })
  await expect.poll(async () => { await revisit(juno); return juno.home.kinds() }).not.toContain('missedHuddle')
})

test('old huddles expire and incomplete participation history is not called missed', async ({ juno, fake }) => {
  fake.workspace.clock.set(Date.now() - 8 * 24 * 60 * 60_000)
  fake.control('startHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
  fake.control('endHuddle', { channel: 'D0MAYA' })
  fake.workspace.clock.resume()
  fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0LEO' })
  fake.control('endHuddle', { channel: 'C0PRODUCT' })
  const list = fake.workspace.all('C0PRODUCT')
  const at = list.findIndex((message) => message.room !== undefined)
  const message = list[at]!
  const { participant_history: _history, ...room } = message.room!
  list[at] = { ...message, room }
  await juno.signIn()
  await juno.waitForSync()
  await revisit(juno)
  await expect(juno.home.item('missedHuddle')).toHaveCount(0)
})

test('Never hides a missed huddle, Every message restores it, and ignoring the channel does not hide it', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#product').chooseInMenu('notify-never')
  fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0LEO' })
  fake.control('endHuddle', { channel: 'C0PRODUCT' })
  await revisit(juno)
  await expect(juno.home.item('missedHuddle')).toHaveCount(0)
  await juno.sidebar.row('#product').chooseInMenu('notify-every')
  await juno.sidebar.row('#product').chooseInMenu('ignore-channel')
  await expect.poll(async () => { await revisit(juno); return juno.home.title('missedHuddle').allTextContents() }).toEqual(['Missed huddle in #product'])
  await juno.home.openItem('missedHuddle')
  await juno.topic.expectTitle('#product')
})
