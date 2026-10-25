// Break pass, the parts that need main: a malformed launch.json and window
// minimize. Interrupted and odd input in a topic is in the DOM lane
// (`dom/break-pass.test.ts`).
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, launchApp, syncedTest, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

test('a malformed launch.json still opens a usable window', { tag: '@electron' }, async ({ running, userData }) => {
  await running.close()
  await writeFile(join(userData, 'launch.json'), '{"theme":')
  const again = await launchApp(userData)
  try {
    await expect(again.win.getByRole('button', { name: "Use the Slack app's session" })).toBeVisible()
    await again.win.getByRole('radio', { name: 'Dark' }).click()
    await expect(again.win.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
  } finally {
    await again.close()
  }
})

// A deactivated sender and a live rename of them: the engine's live-events flow test.

syncedTest('repeated window minimize and restore keeps the draft', { tag: '@electron' }, async ({ juno, app }) => {
  await juno.sidebar.row('#eng').open()
  await juno.topic.composer.fill('Draft through window changes')
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    for (let i = 0; i < 5; i++) {
      window.minimize()
      window.restore()
    }
    window.show()
    window.focus()
  })
  await expect(juno.topic.composer).toHaveValue('Draft through window changes')
  await juno.topic.composer.press('Enter')
  await juno.topic.expectSent('Draft through window changes')
})
