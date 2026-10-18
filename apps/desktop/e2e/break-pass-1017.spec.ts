// Break pass of 10-17: the features that landed on 10-16 and 10-17 used
// together, the way a busy day uses them. Findings are in
// docs/reviews/2026-10-17-break-pass.md.
import { SELF_ID } from '@juno/fake-slack'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })
// A failing test attaches the send's path through the app and the fake's post calls (README, "Send trace").
test.use({ sendTrace: true })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'

async function menu(juno: Juno, id: string): Promise<void> {
  await juno.app.evaluate(({ Menu, BrowserWindow }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) throw new Error(`No menu item ${itemId}`)
    item.click(undefined, BrowserWindow.getAllWindows()[0])
  }, id)
}

async function setWindowSize(juno: Juno, width: number, height?: number): Promise<void> {
  await juno.app.evaluate(({ BrowserWindow }, [w, h]) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setSize(w!, h ?? window.getSize()[1]!)
  }, [width, height] as const)
}

test('two tabs on one topic share its draft, and a send from one clears it in both', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.sidebar.row(POSTGRES).openInNewTab()
  await expect(juno.tabs.tab(POSTGRES)).toHaveCount(2)
  await juno.topic.composer.fill('Shared draft')
  await juno.tabs.selectAt(POSTGRES, 0)
  await juno.tabs.expectActiveAt(POSTGRES, 0)
  await expect(juno.topic.composer).toHaveValue('Shared draft')
  await juno.topic.composer.press('Enter')
  await juno.topic.expectSent('Shared draft')
  await juno.tabs.selectAt(POSTGRES, 1)
  await juno.tabs.expectActiveAt(POSTGRES, 1)
  await juno.topic.expectMessage('Shared draft')
  await expect(juno.topic.composer).toHaveValue('')
  expect(fake.messages('C0ENG').filter((m) => m.text === 'Shared draft')).toHaveLength(1)
})

test('closing the last tab while its message sends posts it once and opens a new tab', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  await juno.tabs.expectCount(1)
  fake.holdNext({ method: 'chat.postMessage', before: true })
  await juno.topic.composer.fill('Sent as the tab closed')
  await juno.topic.composer.press('Enter')
  await expect.poll(() => fake.heldCount({ method: 'chat.postMessage' })).toBe(1)
  await juno.tabs.menu('close-tab')
  await juno.tabs.expectCount(1)
  await juno.tabs.expectActive('Home')
  await expect(juno.write.composer).toBeFocused()
  fake.release()
  await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Sent as the tab closed').length).toBe(1)
  await juno.tabs.menu('reopen-tab')
  await juno.topic.expectSent('Sent as the tab closed')
  await expect(juno.topic.composer).toHaveValue('')
  await juno.win.waitForTimeout(500)
  expect(fake.messages('C0ENG').filter((m) => m.text === 'Sent as the tab closed')).toHaveLength(1)
})

test('⌘T during the first sync opens a usable Home', async ({ juno, fake }) => {
  fake.holdNext({ method: 'conversations.history' })
  await juno.signIn()
  await expect(juno.sidebar.root.getByRole('status', { name: 'Sync status' })).toHaveText(/^Syncing/, { timeout: 30_000 })
  // ⌘T opens a Home beside the launch tab's, every time, each with its own draft.
  await juno.tabs.menu('new-tab')
  await juno.tabs.expectCount(2)
  await expect(juno.write.composer).toBeFocused()
  await juno.write.write('Written during sync')
  await juno.tabs.menu('new-tab')
  await juno.tabs.expectCount(3)
  await expect(juno.write.composer).toBeFocused()
  await expect(juno.write.composer).toHaveValue('')
  fake.release()
  await juno.waitForSync()
  await juno.tabs.selectAt('Home', 1)
  await expect(juno.write.composer).toHaveValue('Written during sync')
  await juno.write.pickConversation('eng', 'eng')
  await juno.write.send()
  await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Written during sync').length).toBe(1)
})

test('Settings opened from ⌘, , the avatar menu and Notifications stays one tab at the asked section', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.sidebar.row(RINA).openInNewTab()
  // Everything opens in the current tab: Settings takes Rina's.
  if (process.platform === 'darwin') await menu(juno, 'settings')
  else await juno.accountMenu.choose(/^Settings/)
  await juno.tabs.expectActive('Settings')
  await expect(juno.settings.section('General')).toHaveAttribute('aria-current', 'page')
  await juno.settings.show('Appearance')
  // From another tab, each entry focuses that one Settings tab at its section.
  await juno.tabs.select(POSTGRES)
  await juno.openNotifications()
  await juno.tabs.expectCount(2)
  await juno.tabs.select(POSTGRES)
  await juno.accountMenu.choose(/^Settings/)
  await juno.tabs.expectActive('Settings')
  await expect(juno.settings.section('General')).toHaveAttribute('aria-current', 'page')
  await juno.tabs.expectCount(2)
  await juno.tabs.expectActive('Settings')
  expect(await juno.tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), 'Settings'])
})

test('a Recent pick and its draft survive switching tabs before sending', async ({ juno, fake }) => {
  for (let i = 0; i < 6; i++) fake.injectMessage({ channel: 'C0ENG', user: SELF_ID, text: `Frequent send ${i}` })
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.newTabButton.click()
  const rows = juno.write.recent.getByRole('list', { name: 'Channels' }).getByRole('button')
  await expect(rows.first()).toHaveText('eng')
  await rows.first().click()
  await juno.write.expectDestination('#eng')
  await juno.write.write('Picked then switched')
  await juno.tabs.select(POSTGRES)
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.select('Home')
  await juno.write.expectDestination('#eng')
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'true')
  await expect(juno.write.composer).toHaveValue('Picked then switched')
  await juno.write.send()
  await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Picked then switched').length).toBe(1)
})

test('a relaunch keeps many tabs and their drafts', async ({ juno, running, userData, fake, slackApp }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.composer.fill('Draft one')
  await juno.sidebar.row(RINA).openInNewTab()
  await juno.topic.composer.fill('Draft two')
  await juno.sidebar.row(ROADMAP).openInNewTab()
  await juno.sidebar.row('#eng').openInNewTab()
  await juno.topic.composer.fill('Draft in Main')
  await juno.sidebar.row(POSTGRES).openInNewTab()
  await juno.home.navItem.click({ modifiers: ['Meta'] })
  await juno.tabs.expectCount(6)
  const before = await juno.tabs.titles()
  await juno.tabs.select('Rina')
  await juno.win.waitForTimeout(800)
  await running.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.tabs.expectCount(6)
    await expect.poll(() => restarted.tabs.titles()).toEqual(before)
    await restarted.tabs.expectActive('Rina')
    await expect(restarted.topic.composer).toHaveValue('Draft two')
    await restarted.tabs.selectAt(POSTGRES, 0)
    await expect(restarted.topic.composer).toHaveValue('Draft one')
    await restarted.tabs.select('eng')
    await expect(restarted.topic.composer).toHaveValue('Draft in Main')
    await restarted.tabs.selectAt(POSTGRES, 1)
    await expect(restarted.topic.composer).toHaveValue('Draft one')
  } finally {
    await again.close()
  }
})

test('the topic switcher with many threads keeps the selected row in view and fits the window', async ({ juno, fake }) => {
  for (let i = 0; i < 60; i++) {
    const root = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: `Busy day thread number ${i} about things` })
    fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: `Reply ${i}`, threadTs: root.ts })
  }
  await juno.signIn()
  await juno.waitForSync()
  await setWindowSize(juno, 1000, 600)
  await juno.sidebar.row('#eng').open()
  const switcher = await juno.topic.openSwitcherWithKeyboard()
  const box = await switcher.root.boundingBox()
  const height = await juno.win.evaluate(() => innerHeight)
  expect(box!.y + box!.height).toBeLessThanOrEqual(height)
  for (let i = 0; i < 40; i++) await juno.win.keyboard.press('ArrowDown')
  const activeId = await switcher.search.getAttribute('aria-activedescendant')
  expect(activeId).not.toBeNull()
  const active = switcher.root.locator(`[id="${activeId}"]`)
  await expect(active).toContainText('Busy day thread')
  await expect(active).toBeInViewport({ ratio: 1 })
  await juno.win.keyboard.press('Enter')
  await expect(switcher.root).toBeHidden()
})

test('a send while the socket and network drop goes once when they are back', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  fake.goOffline()
  fake.dropSocket()
  await juno.topic.composer.fill('Sent offline')
  await juno.topic.composer.press('Enter')
  await juno.topic.expectMessage('Sent offline')
  await juno.win.waitForTimeout(1500)
  fake.goOnline()
  await juno.topic.expectSent('Sent offline')
  await juno.win.waitForTimeout(3000)
  expect(fake.messages('C0ENG').filter((m) => m.text === 'Sent offline')).toHaveLength(1)
  await expect(juno.topic.message('Sent offline')).toHaveCount(1)
})

test('a narrow window keeps the tab strip and topic inside the window', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await setWindowSize(juno, 720, 480)
  await juno.sidebar.row(POSTGRES).open()
  for (const title of [RINA, ROADMAP, '#eng']) await juno.sidebar.row(title).openInNewTab()
  for (let i = 0; i < 6; i++) await juno.tabs.menu('new-tab')
  await juno.sidebar.row(POSTGRES).open()
  expect(await juno.win.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(juno.tabs.newTabButton).toBeInViewport()
  await expect(juno.topic.composer).toBeInViewport()
  await expect(juno.topic.contextPill).toBeInViewport()
})

test('each tab gets its composer focus back after a keyboard tab switch', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.composer.click()
  await juno.topic.composer.pressSequentially('Typing in the topic')
  await juno.tabs.menu('new-tab')
  await expect(juno.write.composer).toBeFocused()
  await juno.write.composer.pressSequentially('Typing on Home')
  await juno.tabs.menu('previous-tab')
  await juno.tabs.expectActive(POSTGRES)
  await expect(juno.topic.composer).toBeFocused()
  await juno.tabs.menu('next-tab')
  await juno.tabs.expectActive('Home')
  await expect(juno.write.composer).toBeFocused()
})

test('a mouse press on a tab gives its page focus; the keyboard keeps focus in the strip', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.sidebar.row(RINA).openInNewTab()
  // Never focused in this tab: the press focuses its composer.
  await juno.tabs.select(POSTGRES)
  await expect(juno.topic.composer).toBeFocused()
  await juno.win.keyboard.type('Typed after a click')
  await expect(juno.topic.composer).toHaveValue('Typed after a click')
  // From the sidebar, a press on the active tab focuses its page too.
  await juno.sidebar.row(POSTGRES).focus()
  await juno.tabs.select(POSTGRES)
  await expect(juno.topic.composer).toBeFocused()
  // Arrow keys in the strip move the selection and keep focus on the tabs.
  await juno.tabs.tab(POSTGRES).focus()
  await juno.win.keyboard.press('ArrowRight')
  await juno.tabs.expectActive('Rina')
  await juno.tabs.expectFocused('Rina')
})

test('⌘T twice gives two Home tabs with their own drafts and destinations, and both survive a relaunch', async ({ juno, running, userData, fake, slackApp }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('new-tab')
  await juno.write.write('First note for Juno')
  await juno.tabs.menu('new-tab')
  await expect(juno.tabs.tab('Home')).toHaveCount(2)
  await juno.tabs.expectActiveAt('Home', 1)
  await expect(juno.write.composer).toHaveValue('')
  await juno.write.pickConversation('product', 'product')
  await juno.write.write('Second, for product')
  await juno.tabs.selectAt('Home', 0)
  await expect(juno.write.composer).toHaveValue('First note for Juno')
  await juno.write.expectDestination('Juno')
  await juno.win.waitForTimeout(800)
  await running.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.tabs.expectCount(3)
    await expect.poll(() => restarted.tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), 'Home', 'Home'])
    await restarted.tabs.expectActiveAt('Home', 0)
    await expect(restarted.write.composer).toHaveValue('First note for Juno')
    await restarted.tabs.selectAt('Home', 1)
    await restarted.write.expectDestination('#product')
    await expect(restarted.write.composer).toHaveValue('Second, for product')
  } finally {
    await again.close()
  }
})

test('a send from Home to a channel, a thread’s channel or a DM another tab shows leaves every tab where it was', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  await juno.sidebar.row('Maya', { exact: true }).openInNewTab()
  await juno.tabs.menu('new-tab')
  await juno.write.pickConversation('eng', 'eng')
  await juno.write.write('Sent from Home')
  await juno.write.send()
  await juno.tabs.expectActive('Home')
  await expect(juno.tabs.tab('eng')).toHaveCount(1)
  await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Sent from Home').length).toBe(1)

  await juno.write.pickConversation('maya', 'Maya')
  await juno.write.write('DM from Home')
  await juno.write.send()
  await juno.tabs.expectActive('Home')
  await expect(juno.tabs.tab('Maya')).toHaveCount(1)
  await juno.tabs.select('Maya')
  await juno.topic.expectMessage('DM from Home')
})
