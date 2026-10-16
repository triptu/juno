// Break pass of 10-17, the Juno panel used with tabs and window sizes.
// Findings are in docs/reviews/2026-10-17-break-pass.md.
import { hooks } from '../fixtures'
import type { Juno } from '../driver/juno'
import { expect, JunoChatPane, test } from './chat'

test.describe.configure({ timeout: 90_000 })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite.'

async function ready(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
}

async function setWindowWidth(juno: Juno, width: number): Promise<void> {
  await juno.app.evaluate(({ BrowserWindow }, w) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setSize(w, window.getSize()[1]!)
  }, width)
}

test('an About chip from Ask Juno in one tab does not follow to the panel of another tab', async ({ juno, model }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.chooseNextMenuItem('ask-juno')
  await juno.win.locator('[data-topic-view] [data-person-name="Leo"]').first().click({ button: 'right' })
  await expect(juno.win.locator('[data-about-chip="person"]')).toHaveText('About Leo')

  await juno.sidebar.row(RINA).openInNewTab()
  await juno.topic.expectTitle(RINA)
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await expect(panel.composer).toBeFocused()
  await expect(juno.win.locator('[data-panel-sees]')).toHaveText(/^\S+ · Rina finished the onsite/)
  await expect(panel.root.locator('[data-about-chip]')).toHaveCount(0)
  await panel.send('what happened here?')
  await panel.expectJuno('You said: what happened here?')
  expect(model.inputs().at(-1)!).toMatch(/<about topic="t:[^"]+" title="Rina finished the onsite/)

  // The first tab still asks about Leo.
  await juno.tabs.select(POSTGRES)
  await expect(juno.win.locator('[data-about-chip="person"]')).toHaveText('About Leo')
})

test('the panel keeps its draft and focus across the cover breakpoint', async ({ juno }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await expect(panel.composer).toBeFocused()
  await panel.composer.fill('Half written question')
  for (const width of [1100, 1400, 900, 1600]) {
    await setWindowWidth(juno, width)
    await expect.poll(() => juno.win.evaluate(() => innerWidth)).toBeLessThanOrEqual(width)
    await expect(panel.composer).toHaveValue('Half written question')
    await expect(panel.composer).toBeFocused()
  }
})

test('the panel draft is kept when the tab is switched away and back', async ({ juno }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await panel.composer.fill('Kept while away')
  await juno.sidebar.row(RINA).openInNewTab()
  await juno.topic.expectTitle(RINA)
  await juno.tabs.select(POSTGRES)
  await expect(panel.composer).toHaveValue('Kept while away')
})

test('two tabs on one topic with the panel open in one: send, react and edit stay in step', async ({ juno, fake }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row('#eng').open()
  await juno.tabs.menu('juno')
  await juno.sidebar.row('#eng').openInNewTab()
  await expect(juno.tabs.tab('eng')).toHaveCount(2)
  await expect(juno.win.locator('aside[data-juno-panel]')).toHaveCount(0)
  await juno.topic.send('Sent from the plain tab')
  await juno.topic.expectSent('Sent from the plain tab')
  const row = juno.topic.message('Sent from the plain tab')
  await row.hover()
  await row.getByRole('button', { name: 'React 👍' }).click()
  await expect.poll(() => fake.messages('C0ENG').find((m) => m.text === 'Sent from the plain tab')?.reactions?.length ?? 0).toBe(1)

  await juno.tabs.selectAt('eng', 0)
  await expect(juno.win.locator('aside[data-juno-panel]')).toHaveCount(1)
  const there = juno.topic.message('Sent from the plain tab')
  await expect(there).toBeVisible()
  await expect(there.getByRole('button', { name: '1 👍, including you' })).toBeVisible()
  await juno.topic.chooseInMessageMenu('Sent from the plain tab', 'edit')
  const edit = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
  await edit.fill('Edited beside the panel')
  await edit.press('Enter')
  await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === 'Edited beside the panel')).toBe(true)
  await juno.tabs.selectAt('eng', 1)
  await juno.topic.expectMessage('Edited beside the panel')
  await expect(juno.topic.message('Edited beside the panel').getByRole('button', { name: '1 👍, including you' })).toBeVisible()
})

test('in the panel, Enter takes an emoji suggestion and Esc closes the list, not the panel', async ({ juno, model }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  const list = juno.win.getByRole('listbox', { name: 'Emoji' })
  await panel.composer.pressSequentially('nice :thumbsu')
  await expect(list).toBeVisible()
  await panel.composer.press('Enter')
  await expect(panel.composer).toHaveValue(/^nice 👍 $/)
  expect(model.inputs()).toHaveLength(0)
  await panel.composer.pressSequentially(':smi')
  await expect(list).toBeVisible()
  await panel.composer.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(juno.win.locator('aside[data-juno-panel]')).toHaveCount(1)
  await expect(panel.composer).toHaveValue('nice 👍 :smi')
})

test('dark mode leaves no light surface in the panel', async ({ juno }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.setTheme('Dark')
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  await JunoChatPane.panel(juno.win).send('hello there')
  await JunoChatPane.panel(juno.win).expectJuno('You said: hello there')
  const light = await juno.win.locator('aside[data-juno-panel]').evaluate((panel) => {
    const found: string[] = []
    for (const element of [panel, ...panel.querySelectorAll<HTMLElement>('*')]) {
      if (!element.checkVisibility({ opacityProperty: true, contentVisibilityAuto: true })) continue
      const match = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(getComputedStyle(element).backgroundColor)
      if (match === null || (match[4] !== undefined && Number(match[4]) < 0.5)) continue
      const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])]
      if (0.2126 * r + 0.7152 * g + 0.0722 * b > 200) found.push(element.tagName.toLowerCase())
    }
    return found
  })
  expect(light).toEqual([])
})
