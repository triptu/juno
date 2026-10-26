// The Juno panel beside a topic: opening and closing it, its draft and state per tab, what Juno
// sees from the topic and a selection, and Ask Juno from a person, channel or message menu. Its
// width and first frame are layout, in `e2e/juno-agent/panel.spec.ts`.
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { answer } from '../../e2e/juno-agent/model'
import { JunoChatPane, readySynced } from '../driver/agent'
import type { Juno } from '../driver/juno'
import { expect } from '../expect'
import type { Query } from '../query'
import { domTest } from '../test'

const model = () => startFakeOpenRouter({ answer })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const panelOf = (juno: Juno) => juno.win.locator('aside[data-juno-panel]')
/** Closes every tab, which leaves one Home. */
async function closeAll(juno: Juno): Promise<void> {
  const [first] = await juno.tabs.titles()
  await juno.tabs.contextMenu(first!, 'close-all')
  await juno.expectNothingOpen()
}

const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

// One launch: the panel's own state first, before any message, then what a message from it is about, the menus' Ask
// Juno, and two tabs on one topic last.
domTest('the panel opens and closes, keeps state per tab, says what each message is about, opens from the menus, and two tabs on one topic stay in step', async ({ juno, model, fake, slack, step }) => {
  await readySynced(juno)
  const panel = JunoChatPane.panel(juno.win)
  const asked = model.inputs().length

  await step('⌘J opens the panel beside a topic with its composer focused, and Esc closes it only once the composer is empty', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectTitle(POSTGRES)
    await juno.tabs.menu('juno')
    await expect(panel.composer).toBeFocused()
    await expect(juno.win.locator('[data-topic-header]')).toBeVisible()

    await panel.composer.fill('a draft')
    await panel.composer.press('Escape')
    await expect(panelOf(juno)).toHaveCount(1)
    expect(model.inputs()).toHaveLength(asked)

    await panel.composer.fill('')
    await panel.composer.press('Escape')
    await expect(panelOf(juno)).toHaveCount(0)

    // The header's Juno button opens it too, and ⌘J closes it.
    await juno.win.locator('[data-topic-header]').getByRole('button', { name: 'Juno ⌘J' }).click()
    await expect(panel.composer).toBeFocused()
    await juno.tabs.menu('juno')
    await expect(panelOf(juno)).toHaveCount(0)

    // Outside a topic tab, ⌘J opens the Juno tab.
    await junoNav(juno).click()
    await juno.tabs.menu('juno')
    await juno.tabs.expectActive('Juno')
  })

  await step('the topic chip in the panel composer names the topic Juno sees', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.tabs.menu('juno')
    const line = juno.win.locator('[data-panel-sees]')
    await expect(line).toHaveText(/^eng · Draft plan is in the doc/)
  })

  await step('the panel is open in one tab and closed in another, and each keeps its state and draft across a tab switch', async () => {
    const panel = panelOf(juno)
    await expect(panel).toHaveCount(1)
    await JunoChatPane.panel(juno.win).composer.fill('Kept while away')
    // A second topic in a new tab: the panel is closed there.
    await juno.sidebar.row(RINA).openInNewTab()
    await juno.topic.expectTitle(RINA)
    await expect(panel).toHaveCount(0)
    // Back to the first tab: still open, with its draft. And to the second: still closed.
    await juno.tabs.select(POSTGRES)
    await expect(panel).toHaveCount(1)
    await expect(JunoChatPane.panel(juno.win).composer).toHaveValue('Kept while away')
    await juno.tabs.select(RINA)
    await expect(panel).toHaveCount(0)
  })

  // Back to one Home tab.
  await closeAll(juno)

  await step('a message sent from the panel is about the topic, with the selection from ⌘J or the selection toolbar, and says so over the bubble', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectTitle(POSTGRES)
    const chip = juno.win.locator('[data-panel-selection]')
    const root = juno.topic.message('logical replication')

    await step('words selected, then ⌘J: the chip quotes them, and the message is about the topic with them', async () => {
      await select(juno, root, 'logical replication')
      await juno.tabs.menu('juno')
      // The composer adds the selection, quoted with its sender, with the whole of it as its tooltip.
      await expect(chip).toHaveText('Leo: “logical replication”')
      await expect(panel.composer).toBeFocused()

      await panel.send('is this settled?')
      await expect(panel.ownerBubble('is this settled?').locator('[data-about]')).toHaveText(/^About Draft plan is in the doc/)
      await panel.expectJuno('You said: is this settled?')
      const ts = await root.getAttribute('data-message-row')
      expect(model.inputs().at(-1)!).toMatch(/^<message id="n\d+"><about topic="t:[^"]+" title="Draft plan is in the doc[^"]*" channel="#eng" channel-id="[^"]+" kind="thread" visible="[^"]+"><selection from="Leo" ts="[^"]+">logical replication<\/selection><\/about>is this settled\?<\/message>$/)
      expect(model.inputs().at(-1)!).toContain(`<selection from="Leo" ts="${ts}">`)
      await expect(chip).toHaveCount(0)
      await juno.tabs.menu('juno')
      await expect(panelOf(juno)).toHaveCount(0)
    })

    await step('words selected: Ask Juno on the selection toolbar opens the panel with them, and the highlight and the toolbar go', async () => {
      await select(juno, root, 'logical replication')
      const toolbar = juno.win.getByRole('toolbar', { name: 'Selection' })
      await expect(toolbar.getByRole('button', { name: 'Quote' })).toBeVisible()
      const ask = toolbar.getByRole('button', { name: 'Ask Juno' })
      await ask.click()
      await expect(chip).toHaveText('Leo: “logical replication”')
      await expect(panel.composer).toBeFocused()
      await expect(toolbar).toHaveCount(0)
      expect(juno.dom.document.getSelection()?.toString()).toBe('')
      await panel.send('is this the plan?')
      await panel.expectJuno('You said: is this the plan?')
      expect(model.inputs().at(-1)!).toContain('>logical replication</selection></about>is this the plan?</message>')
    })

    await step('the same chat in the Juno tab shows the About line, and it opens the topic', async () => {
      await panel.root.getByRole('button', { name: 'Open in a tab' }).click()
      await juno.tabs.expectActive('Juno')
      await JunoChatPane.tab(juno.win).ownerBubble('is this settled?').locator('[data-about]').click()
      await juno.topic.expectTitle(POSTGRES)
    })
  })

  await step('Ask Juno in a person, channel or message menu opens the panel about it, and a chip stays in its tab until the panel closes', async () => {

    await step('a person menu: About Leo, and the chip stays in its tab', async () => {
      await juno.sidebar.row(POSTGRES).open()
      await juno.chooseNextMenuItem('ask-juno')
      await juno.win.locator('[data-topic-view] [data-person-name="Leo"]').first().click({ button: 'right' })
      await expect(panel.composer).toBeFocused()
      await expect(juno.win.locator('[data-about-chip="person"]')).toHaveText('About Leo')
      await panel.send('what is he working on?')
      await expect(panel.ownerBubble('what is he working on?').locator('[data-about]')).toHaveText('About Leo')
      await panel.expectJuno('You said: what is he working on?')
      expect(model.inputs().at(-1)!).toMatch(/^<message id="n\d+"><about person="U0LEO" name="Leo"\/>what is he working on\?<\/message>$/)
      // The chip stays until removed.
      await expect(juno.win.locator('[data-about-chip="person"]')).toBeVisible()

      // It does not follow to the panel of another tab, which asks about its own topic.
      await juno.sidebar.row(RINA).openInNewTab()
      await juno.topic.expectTitle(RINA)
      await juno.tabs.menu('juno')
      await expect(panel.composer).toBeFocused()
      await expect(juno.win.locator('[data-panel-sees]')).toHaveText(/^\S+ · Rina finished the onsite/)
      await expect(panel.root.locator('[data-about-chip]')).toHaveCount(0)
      await panel.send('what happened here?')
      await panel.expectJuno('You said: what happened here?')
      expect(model.inputs().at(-1)!).toMatch(/<about topic="t:[^"]+" title="Rina finished the onsite/)
      await juno.tabs.select(POSTGRES)
      await expect(juno.win.locator('[data-about-chip="person"]')).toHaveText('About Leo')
    })

    await step('the channel menu on the context pill asks about the channel, and closing the panel drops the chip', async () => {
      await juno.chooseNextMenuItem('ask-juno')
      await juno.win.locator('[data-topic-header]').getByRole('button', { name: /^eng, public channel/ }).click({ button: 'right' })
      await expect(panel.composer).toBeFocused()
      await expect(panel.root.locator('[data-about-chip="channel"]')).toHaveText('About #eng')
      await panel.send('anything new here?')
      await panel.expectJuno('You said: anything new here?')
      expect(model.inputs().at(-1)!).toMatch(/^<message id="n\d+"><about channel="[^"]+" name="#eng"\/>anything new here\?<\/message>$/)

      await juno.tabs.menu('juno')
      await juno.tabs.menu('juno')
      await expect(panel.composer).toBeFocused()
      await expect(panel.root.locator('[data-about-chip]')).toHaveCount(0)
    })

    await step('a message menu quotes the message beside its topic', async () => {
      slack.as('Maya').dm('Are we still on for the board deck review?')
      await juno.sidebar.row('Maya', { exact: true }).open()
      await juno.topic.expectMessage('Are we still on for the board deck review?')
      await juno.topic.chooseInMessageMenu('Are we still on for the board deck review?', 'ask-juno')
      const quote = panelOf(juno).locator('[data-panel-selection]')
      await expect(quote).toContainText(/^Maya[^:]*: “Are we still on for the…”$/)
      await expect(quote).toHaveAttribute('data-tooltip', /^Maya[^:]*: Are we still on for the board deck review\?/)
      await expect(panel.composer).toBeFocused()
    })
  })

  await step('two tabs on one topic with the panel open in one: send, react and edit stay in step', async () => {
    await closeAll(juno)
    await juno.sidebar.row('#eng').open()
    await juno.tabs.menu('juno')
    await juno.sidebar.row('#eng').openInNewTab()
    await expect(juno.tabs.tab('eng')).toHaveCount(2)
    await expect(panelOf(juno)).toHaveCount(0)
    await juno.topic.send('Sent from the plain tab')
    await juno.topic.expectSent('Sent from the plain tab')
    await (await juno.topic.messageMenu('Sent from the plain tab')).react('+1')
    await expect.poll(() => fake.messages('C0ENG').find((m) => m.text === 'Sent from the plain tab')?.reactions?.length ?? 0).toBe(1)

    await juno.tabs.selectAt('eng', 0)
    await expect(panelOf(juno)).toHaveCount(1)
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
}, { model, timeout: 120_000 })
/** Selects `words` in a message, as a drag that ends there: the selection, then the pointer's release. */
async function select(juno: Juno, row: Query, words: string): Promise<void> {
  const { document } = juno.dom
  const walker = document.createTreeWalker((await row.element()).querySelector('[data-msg-text]')!, 4)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const at = node.textContent!.indexOf(words)
    if (at < 0) continue
    const range = document.createRange()
    range.setStart(node, at)
    range.setEnd(node, at + words.length)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    const W = juno.dom.window as unknown as { PointerEvent: typeof PointerEvent }
    node.parentElement!.dispatchEvent(new W.PointerEvent('pointerup', { bubbles: true }))
    return
  }
  throw new Error(`"${words}" is not in the message`)
}
