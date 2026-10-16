// Break pass of 10-17: the features that landed on 10-16 and 10-17 used
// together, the way a busy day uses them. Findings are in
// docs/reviews/2026-10-17-break-pass.md.
import { SELF_ID } from '@juno/fake-slack'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

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
  await juno.tabs.expectActive('New chat')
  await expect(juno.newChat.composer).toBeFocused()
  fake.release()
  await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Sent as the tab closed').length).toBe(1)
  await juno.tabs.menu('reopen-tab')
  await juno.topic.expectSent('Sent as the tab closed')
  await expect(juno.topic.composer).toHaveValue('')
  await juno.win.waitForTimeout(500)
  expect(fake.messages('C0ENG').filter((m) => m.text === 'Sent as the tab closed')).toHaveLength(1)
})

test('⌘T during the first sync opens a usable New chat', async ({ juno, fake }) => {
  fake.holdNext({ method: 'conversations.history' })
  await juno.signIn()
  await expect(juno.sidebar.root.getByRole('status', { name: 'Sync status' })).toHaveText(/^Syncing/, { timeout: 30_000 })
  await juno.tabs.menu('new-tab')
  // The launch tab is an untouched New chat, so ⌘T focuses it rather than adding another.
  await juno.tabs.expectCount(1)
  await expect(juno.newChat.composer).toBeFocused()
  await juno.newChat.write('Written during sync')
  await juno.tabs.menu('new-tab')
  await juno.tabs.expectCount(2)
  await expect(juno.newChat.composer).toBeFocused()
  await expect(juno.newChat.composer).toHaveValue('')
  fake.release()
  await juno.waitForSync()
  await juno.tabs.selectAt('New chat', 0)
  await expect(juno.newChat.composer).toHaveValue('Written during sync')
  await juno.newChat.pickConversation('eng', 'eng')
  await juno.newChat.send()
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

test('a Frequent pick and its draft survive switching tabs before sending', async ({ juno, fake }) => {
  for (let i = 0; i < 6; i++) fake.injectMessage({ channel: 'C0ENG', user: SELF_ID, text: `Frequent send ${i}` })
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.newTabButton.click()
  const rows = juno.newChat.root.getByRole('list', { name: 'Frequent conversations' }).getByRole('button')
  await expect(rows.first()).toHaveText('eng')
  await rows.first().dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' })
  await juno.newChat.expectConversation('eng')
  await juno.newChat.write('Picked then switched')
  await juno.tabs.select(POSTGRES)
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.select('eng')
  await juno.newChat.expectConversation('eng')
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'true')
  await expect(juno.newChat.composer).toHaveValue('Picked then switched')
  await juno.newChat.send()
  await juno.topic.expectMessage('Picked then switched')
  expect(fake.messages('C0ENG').filter((m) => m.text === 'Picked then switched')).toHaveLength(1)
})

test('a relaunch keeps many tabs and their drafts', async ({ juno, running, userData, fake, slackApp }) => {
  await juno.signIn()
  await juno.waitForSync()
  // Recent threads get AI titles in the background; let them settle so the tab titles compared below are final.
  for (const title of [POSTGRES, RINA, ROADMAP]) {
    await expect(juno.sidebar.row(title).root).toHaveAttribute('data-title-source', 'ai', { timeout: 15_000 })
  }
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

// Open finding: a New chat's draft and destination live only while the app runs (`newChatAtom`).
test('a relaunch keeps a New chat tab with its destination and draft', async ({ juno, running, userData, fake, slackApp }) => {
  test.fail()
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.newTabButton.click()
  await juno.newChat.write('New chat draft')
  await juno.newChat.pickConversation('product', 'product')
  await juno.tabs.expectActive('product')
  await juno.win.waitForTimeout(800)
  await running.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.tabs.expectCount(2)
    await restarted.newChat.expectConversation('product')
    await expect(restarted.newChat.composer).toHaveValue('New chat draft')
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
  for (let i = 0; i < 6; i++) await juno.tabs.menu('new-chat')
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
  await juno.tabs.menu('new-chat')
  await expect(juno.newChat.composer).toBeFocused()
  await juno.newChat.composer.pressSequentially('Typing in New chat')
  await juno.tabs.menu('previous-tab')
  await juno.tabs.expectActive(POSTGRES)
  await expect(juno.topic.composer).toBeFocused()
  await juno.tabs.menu('next-tab')
  await juno.tabs.expectActive('New chat')
  await expect(juno.newChat.composer).toBeFocused()
})

test('New chat works from the keyboard alone: write, pick with Enter, send', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.tabs.menu('new-chat')
  await expect(juno.newChat.composer).toBeFocused()
  await juno.win.keyboard.type('Keyboard only')
  // Enter with no destination opens the conversation list and keeps the draft.
  await juno.win.keyboard.press('Enter')
  await expect(juno.newChat.search).toBeFocused()
  // Esc closes the list and puts focus on its button; Space opens it again.
  await juno.win.keyboard.press('Escape')
  await expect(juno.newChat.conversationButton).toBeFocused()
  await juno.win.keyboard.press('Space')
  await expect(juno.newChat.search).toBeFocused()
  await juno.win.keyboard.type('eng')
  await expect(juno.newChat.option('eng')).toBeVisible()
  await juno.win.keyboard.press('Enter')
  await juno.newChat.expectConversation('eng')
  await expect(juno.newChat.composer).toBeFocused()
  await expect(juno.newChat.composer).toHaveValue('Keyboard only')
  // Shift Tab reaches Attach files, then the thread picker; Esc from its list goes back without a change.
  await juno.win.keyboard.press('Shift+Tab')
  await expect(juno.newChat.root.getByRole('button', { name: 'Attach files' })).toBeFocused()
  await juno.win.keyboard.press('Shift+Tab')
  await expect(juno.newChat.threadButton).toBeFocused()
  await juno.win.keyboard.press('Enter')
  await expect(juno.newChat.search).toBeFocused()
  await juno.win.keyboard.press('Escape')
  await expect(juno.newChat.threadButton).toBeFocused()
  await juno.newChat.expectThread('Main')
  await juno.win.keyboard.press('Tab')
  await juno.win.keyboard.press('Tab')
  await expect(juno.newChat.composer).toBeFocused()
  await juno.win.keyboard.press('Enter')
  await juno.topic.expectMessage('Keyboard only')
  expect(fake.messages('C0ENG').filter((m) => m.text === 'Keyboard only')).toHaveLength(1)
})

test('dark mode leaves no light surface in New chat, the switcher and Settings', async ({ juno, fake }) => {
  for (let i = 0; i < 6; i++) fake.injectMessage({ channel: 'C0ENG', user: SELF_ID, text: `Frequent send ${i}` })
  await juno.signIn()
  await juno.waitForSync()
  await juno.setTheme('Dark')
  const lightSurfaces = () =>
    juno.win.evaluate(() => {
      const light: string[] = []
      for (const element of document.querySelectorAll<HTMLElement>('body *')) {
        // Rows off screen skip style (content-visibility), and hidden actions are at opacity 0.
        if (!element.checkVisibility({ opacityProperty: true, contentVisibilityAuto: true })) continue
        const match = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(getComputedStyle(element).backgroundColor)
        if (match === null || (match[4] !== undefined && Number(match[4]) < 0.5)) continue
        const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])]
        if (0.2126 * r + 0.7152 * g + 0.0722 * b > 200) light.push(`${element.tagName.toLowerCase()} "${element.getAttribute('aria-label') ?? element.textContent?.slice(0, 30)}" ${match[0]} in ${element.parentElement?.closest('[aria-label]')?.getAttribute('aria-label')}`)
      }
      return light
    })
  await juno.tabs.menu('new-chat')
  await expect(juno.newChat.root.getByRole('list', { name: 'Frequent conversations' }).getByRole('button').first()).toBeVisible()
  expect(await lightSurfaces()).toEqual([])
  await juno.newChat.conversationButton.click()
  await expect(juno.newChat.list).toBeVisible()
  expect(await lightSurfaces()).toEqual([])
  await juno.win.keyboard.press('Escape')
  await juno.sidebar.row('#eng').open()
  await juno.topic.openSwitcher()
  expect(await lightSurfaces()).toEqual([])
  await juno.win.keyboard.press('Escape')
  await juno.openSettings('General')
  expect(await lightSurfaces()).toEqual([])
})

test('Enter right after typing in the conversation search picks the match', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.tabs.menu('new-chat')
  await juno.win.keyboard.type('Typed fast')
  await juno.win.keyboard.press('Enter')
  await expect(juno.newChat.search).toBeFocused()
  await juno.win.keyboard.type('eng')
  await juno.win.keyboard.press('Enter')
  await juno.newChat.expectConversation('eng')
  await expect(juno.newChat.composer).toBeFocused()
  await juno.win.keyboard.press('Enter')
  await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Typed fast').length).toBe(1)
})
