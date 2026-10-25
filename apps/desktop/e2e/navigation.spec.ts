// Navigation that needs main (spec sections 4 and 6): the sidebar's resize
// and hide. Window swipes share a launch in break-pass.spec.ts, and full
// screen in app.spec.ts. Back and Forward, the reopen stack, pinned tabs and
// the tab menu are in the DOM lane (dom/navigation.test.ts).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, launchApp, syncedTest, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

syncedTest('the sidebar resizes by its edge, resets on double-click, and hides', async ({ juno, running, userData, fake, slackApp }) => {
  const { frame, nav, sidebar } = juno

  await frame.expectWidth(384)
  await frame.drag(60)
  await frame.expectWidth(444)
  await frame.drag(200)
  await frame.expectWidth(480)
  // Past the narrowest but not below 200: it stops at 312.
  await frame.drag(-250)
  await frame.expectWidth(312)
  await frame.doubleClickEdge()
  await frame.expectWidth(384)

  await frame.drag(-40)
  await frame.expectWidth(344)

  // Hidden, the tab strip carries Show sidebar, Back and Forward.
  expect(await frame.menuLabel()).toBe('Hide Sidebar')
  await frame.toggleWithButton()
  await frame.expectHidden()
  await expect(nav.backButton).toBeVisible()
  await expect(juno.win.getByRole('region', { name: 'Workspace' }).getByRole('button', { name: 'Show sidebar ⌃⌘S' })).toBeVisible()
  await expect.poll(() => frame.menuLabel()).toBe('Show Sidebar')
  await frame.toggleWithMenu()
  await frame.expectHidden(false)
  await frame.expectWidth(344)
  await sidebar.expectRows()

  // Dragging the edge far enough left hides it and keeps its width.
  await frame.drag(-250)
  await frame.expectHidden()

  // Width and hidden state come back after a restart, once main has written them.
  await expect
    .poll(async () => {
      try {
        return (JSON.parse(await readFile(join(userData, 'launch.json'), 'utf8')) as { sidebar?: unknown }).sidebar
      } catch {
        return undefined
      }
    })
    .toEqual({ width: 344, collapsed: true })
  await running.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.frame.expectHidden()
    await restarted.frame.toggleWithMenu()
    await restarted.frame.expectWidth(344)
  } finally {
    await again.close()
  }
})
