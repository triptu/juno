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

  await sidebar.themeButton.click()
  await win.mouse.move(900, 400)
  await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
  await win.waitForTimeout(300)
  await win.screenshot({ path: resolve(screens, 'sidebar-dark.png') })
})
