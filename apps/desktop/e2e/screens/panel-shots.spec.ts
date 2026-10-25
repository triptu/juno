// Writes the Juno panel review shots of the real app against the fake Slack
// and a fake model into docs/design/reviews/2026-10-17-juno-panel/. Not part
// of the suite: run it by hand after a change to the panel and look at them.
//
//   JUNO_SCREENS=1 JUNO_SHOTS_PREFIX=after bun run test:desktop e2e/screens/panel-shots.spec.ts
import { resolve } from 'node:path'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test } from '../juno-agent/chat'

const shots = resolve(__dirname, '../../../../docs/design/reviews/2026-10-17-juno-panel')
const prefix = process.env['JUNO_SHOTS_PREFIX'] ?? 'after'

test.skip(process.env['JUNO_SCREENS'] !== '1', 'set JUNO_SCREENS=1 to write the review shots')

const asks = [
  'Where did the Postgres 16 cutover plan land?',
  'Who still has to review it before Thursday?',
  'Did Leo say anything about keeping the old primary as a fallback, and for how long?',
  'Summarize what changed in the plan since Monday, in two lines.',
  'Is anyone from platform on the hook for the replication slots?',
  'What would block the cutover window on Saturday morning?',
  'Draft a short reply asking Maya to confirm the window.',
  'Which of these threads can I resolve?',
]

test('the Juno panel beside a thread and a Main, light and dark', async ({ juno, win }) => {
  test.setTimeout(240_000)
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await juno.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await juno.sidebar.row('Draft plan is in the doc').open()
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(win)
  for (const ask of asks) {
    await panel.send(ask)
    await panel.expectJuno(`You said: ${ask}`)
  }
  const aside = win.locator('aside[data-juno-panel]')
  const reopen = async () => {
    if ((await aside.count()) > 0) await juno.tabs.menu('juno')
    await expect(aside).toHaveCount(0)
    await juno.tabs.menu('juno')
    await expect(panel.composer).toBeFocused()
  }
  // Every transition and animation on the page has run to its end.
  const settled = () => win.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)))
  const shoot = async (name: string) => {
    await win.mouse.move(20, 880)
    await win.evaluate(() => document.fonts.ready)
    await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
    await settled()
    await win.screenshot({ path: resolve(shots, `${prefix}-${name}.png`) })
  }
  for (const theme of ['Light', 'Dark'] as const) {
    if (theme === 'Dark') await juno.setTheme('Dark')
    await juno.sidebar.row('Draft plan is in the doc').open()
    // Closed and opened again, so the shot shows where it opens.
    await reopen()
    await shoot(`thread-${theme.toLowerCase()}`)
    await juno.sidebar.row('#eng').open()
    await juno.topic.expectTitle('Main')
    await reopen()
    await shoot(`main-${theme.toLowerCase()}`)
  }

  // The panel alone in every accent, both themes: nothing in it should take the accent but the owner's bubbles and the focus ring.
  if (process.env['JUNO_SHOTS_ACCENTS'] !== '1') return
  const accents = ['Coral', 'Near-black', 'Marigold', 'Teal', 'Midnight blue', 'Dark emerald', 'Claret', 'Cyan']
  for (const theme of ['Dark', 'Light'] as const) {
    if (theme === 'Light') await juno.setTheme('Light')
    for (const accent of accents) {
      await juno.openSettings('Appearance')
      await juno.settings.root.getByRole('button', { name: accent, exact: true }).click()
      await juno.tabs.close('Settings')
      await juno.sidebar.row('Draft plan is in the doc').open()
      await reopen()
      await win.mouse.move(20, 880)
      await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
      await settled()
      await win.locator('aside[data-juno-panel]').screenshot({ path: resolve(shots, `accents/${prefix}-${theme.toLowerCase()}-${accent.toLowerCase().replace(/ /g, '-')}.png`) })
    }
  }
})
