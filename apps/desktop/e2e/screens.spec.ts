// Writes the design screenshots of the real app against the fake Slack into
// docs/design/screens/. Not part of the suite: run it by hand after a UI
// change and look at the result.
//
//   JUNO_SCREENS=1 pnpm --filter @juno/desktop exec playwright test e2e/screens.spec.ts
import { resolve } from 'node:path'
import { expect, test } from './fixtures'

const screens = resolve(__dirname, '../../../docs/design/screens')

test.skip(process.env['JUNO_SCREENS'] !== '1', 'set JUNO_SCREENS=1 to write the design screenshots')

test('the sidebar, light and dark', async ({ juno, win }) => {
  test.setTimeout(120_000)
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  const postgres = sidebar.row('Draft plan is in the doc')
  await postgres.select()
  await postgres.expectSelected()
  // The pointer rests on the empty workspace, so no row is hovered.
  await win.mouse.move(900, 400)
  await win.evaluate(() => document.fonts.ready)
  await win.waitForTimeout(300)
  await win.screenshot({ path: resolve(screens, 'sidebar-light.png') })

  await juno.setTheme('Dark')
  await win.mouse.move(900, 400)
  await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
  await win.waitForTimeout(300)
  await win.screenshot({ path: resolve(screens, 'sidebar-dark.png') })
})

test('sidebar views: the pill row with views, a mention dot and the view sheet, light and dark', async ({ juno, win, fake }) => {
  test.setTimeout(180_000)
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  // Automated is there already: the first sync put #alerts-prod and #deploys in it.
  await sidebar.createView({ name: 'Design crit', conversations: ['eng'] })
  await sidebar.createView({ name: 'Leadership', conversations: ['hiring'] })
  await sidebar.createView({ name: 'Work', icon: 'Briefcase' })
  await sidebar.filter('All')
  fake.injectMessage({ channel: 'C0ALERTSPROD', user: 'U0LEO', text: '<@U0TUSHAR> can you take the pager tonight?' })
  await sidebar.expectViewDot('Automated', true)
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') await juno.setTheme('Dark')
    await win.mouse.move(900, 400)
    await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
    await win.evaluate(() => document.fonts.ready)
    await win.waitForTimeout(300)
    await win.screenshot({ path: resolve(screens, `views-${theme}.png`) })
    await sidebar.viewMenu('Automated', 'view-edit')
    await expect(sidebar.viewSheet).toBeVisible()
    await win.waitForTimeout(300)
    await win.screenshot({ path: resolve(screens, `views-sheet-${theme}.png`) })
    await sidebar.viewSheet.getByRole('button', { name: 'Cancel' }).click()
  }
})

test('peek, light and dark', async ({ juno, win }) => {
  test.setTimeout(120_000)
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('Draft plan is in the doc').open()
  const rina = juno.sidebar.row('Rina finished the onsite.')
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') {
      await juno.setTheme('Dark')
      await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
    }
    await rina.peek()
    await juno.peek.expectMessage('Strong systems design')
    await win.evaluate(() => document.fonts.ready)
    await win.waitForTimeout(300)
    await win.screenshot({ path: resolve(screens, `peek-${theme}.png`) })
    await juno.peek.release()
    await juno.peek.expectClosed()
  }
})

test('New chat with a destination and the thread list open, light and dark', async ({ juno, win }) => {
  test.setTimeout(120_000)
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs, newChat } = juno
  await sidebar.row('Draft plan is in the doc').open()
  await tabs.newTabButton.click()
  await newChat.write('Can we move the cutover to Thursday night? Dev needs one more day on the replica check.')
  await newChat.pickConversation('eng', 'eng')
  await newChat.expectPreview('Draft plan is in the doc')
  await newChat.threadButton.click()
  await expect(newChat.list).toBeVisible()
  await win.evaluate(() => document.fonts.ready)
  await win.waitForTimeout(300)
  await win.screenshot({ path: resolve(screens, 'new-chat-light.png') })

  await win.keyboard.press('Escape')
  await juno.setTheme('Dark')
  await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
  await newChat.threadButton.click()
  await expect(newChat.list).toBeVisible()
  await win.waitForTimeout(300)
  await win.screenshot({ path: resolve(screens, 'new-chat-dark.png') })
})

test('the topic header over a thread and a Main, light and dark', async ({ juno, win }) => {
  test.setTimeout(120_000)
  await juno.signIn()
  await juno.waitForSync()
  const shoot = async (name: string) => {
    // The pointer rests on the sidebar's empty end, so nothing in the topic is hovered.
    await win.mouse.move(20, 760)
    await win.evaluate(() => document.fonts.ready)
    await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
    await win.waitForTimeout(300)
    await win.screenshot({ path: resolve(screens, `${name}.png`) })
  }
  for (const theme of ['Light', 'Dark'] as const) {
    if (theme === 'Dark') await juno.setTheme('Dark')
    await juno.sidebar.row('Rina finished the onsite.').open()
    await juno.topic.expectTitle('Rina finished the onsite.')
    await shoot(`topic-thread-${theme.toLowerCase()}`)
    await juno.sidebar.row('#eng').open()
    // Main opens at its end, so its older messages fade out under the band.
    await juno.topic.expectTitle('Main')
    await shoot(`topic-main-${theme.toLowerCase()}`)
  }
})

test('sending in a Main: a failed send, a send on its way and a draft, light and dark', async ({ juno, win, fake }) => {
  test.setTimeout(120_000)
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row('#eng').open()
  await topic.expectTitle('Main')
  // The first send is refused; the second waits for Slack's answer, so it stays on its way.
  fake.forceError({ method: 'chat.postMessage', error: 'restricted_action' })
  await topic.send('Can someone look at the dashboards before Friday?')
  await expect(topic.failed('Can someone look at the dashboards').row).toBeVisible()
  fake.holdNext({ method: 'chat.postMessage', before: true })
  await topic.send('Moving the cutover to Thursday night.')
  await expect(topic.message('Moving the cutover to Thursday night.')).toHaveAttribute('data-pending', 'sending')
  await topic.composer.fill('Two things for the checklist:\nreplica lag under a second, and support signed off')
  for (const theme of ['Light', 'Dark'] as const) {
    if (theme === 'Dark') await juno.setTheme('Dark')
    await win.mouse.move(20, 760)
    await win.evaluate(() => document.fonts.ready)
    await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
    // Past --delay-pending, so the row on its way has dimmed.
    await win.waitForTimeout(1200)
    await win.screenshot({ path: resolve(screens, `send-${theme.toLowerCase()}.png`) })
  }
  fake.release()
})

test('the checks on send: the wrong-place bar, the clarity bar and the audience line, light and dark', async ({ juno, win }) => {
  test.setTimeout(180_000)
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  const shot = async (name: string) => {
    await win.mouse.move(20, 760)
    await win.evaluate(() => document.fonts.ready)
    await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
    await win.waitForTimeout(300)
    await win.screenshot({ path: resolve(screens, name) })
  }
  // Settings opens in the active tab, so the theme is set before the topic opens.
  for (const theme of ['Light', 'Dark'] as const) {
    await juno.setTheme(theme)
    await juno.sidebar.row('#eng').open()
    await topic.expectTitle('Main')
    await topic.composer.fill('the preview environments reaper should cut the staging bill')
    // The wrong-place question is asked while typing pauses; the fake model answers at once.
    await win.waitForTimeout(1000)
    await topic.composer.press('Enter')
    await expect(topic.checkBar.bar).toBeVisible()
    await shot(`send-check-route-${theme.toLowerCase()}.png`)
    await topic.composer.press('Escape')

    await topic.composer.fill('The offer for the new backend hire goes out Friday, can you recieve the the signed letter')
    await expect(topic.audienceWarning).toBeVisible()
    await topic.composer.press('Enter')
    await expect(topic.checkBar.bar).toBeVisible()
    await shot(`send-check-clarity-${theme.toLowerCase()}.png`)
    await topic.composer.press('Escape')
    await topic.composer.fill('')
  }
})

test('All topics, light and dark', async ({ juno, win }) => {
  test.setTimeout(120_000)
  await juno.signIn()
  await juno.waitForSync()
  // A resolved topic, so the page shows each status.
  await juno.sidebar.row('Proposal: cut offline mode and public').chooseInMenu('resolve')
  await juno.allTopics.open()
  for (const theme of ['Light', 'Dark'] as const) {
    if (theme === 'Dark') await juno.setTheme('Dark')
    await win.mouse.move(20, 760)
    await win.evaluate(() => document.fonts.ready)
    await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
    await win.waitForTimeout(300)
    await win.screenshot({ path: resolve(screens, `all-topics-${theme.toLowerCase()}.png`) })
  }
})
