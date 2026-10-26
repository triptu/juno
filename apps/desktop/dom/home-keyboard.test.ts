// Home from the keyboard (spec section 12, "Writing"): ⌘N, "+", keys typed fast or on its chips, a
// paste right after ⌘T, Home from the sidebar and its tabs, and a draft kept when a topic opens over
// Home or the tab closes. Sends from Home are in home-write.test.ts.
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const OFFSITE = 'Can eng take the Wednesday afternoon'

/** Closes every tab, which leaves one empty Home, as a fresh launch shows it. */
async function freshHome(juno: Juno): Promise<void> {
  const [first] = await juno.tabs.titles()
  await juno.tabs.contextMenu(first!, 'close-all')
  await juno.expectNothingOpen()
  await expect(juno.write.composer).toHaveValue('')
}

// One launch: each step starts from one empty Home tab, and leaves Home as it found it.
domTest('Home from the keyboard: ⌘N, "+", fast keys, keys on its chips, a paste after ⌘T, its tabs from the sidebar, and drafts it keeps', async ({ juno, fake, step }) => {
  await step('⌘N, Enter right after typing picks, Shift Tab to the chips, and the send leaves the new thread in a tab behind Home', async () => {
    // ⌘N opens Home's destination list with its search focused.
    await juno.tabs.menu('new-message')
    await expect(juno.write.search).toBeFocused()
    // As a person types once the list shows its search: Enter at once picks the match.
    await juno.win.keyboard.type('eng')
    await juno.win.keyboard.press('Enter')
    await juno.write.expectDestination('#eng')
    await expect(juno.write.composer).toBeFocused()
    await juno.win.keyboard.type('Keyboard only')
    // Shift Tab reaches the topic chip, then the destination chip (Attach files is out of the Tab order); Enter opens its list.
    await juno.win.keyboard.press('Shift+Tab')
    await expect(juno.write.topicChip).toBeFocused()
    await juno.win.keyboard.press('Shift+Tab')
    await expect(juno.write.chip).toBeFocused()
    await juno.win.keyboard.press('Enter')
    await expect(juno.write.search).toBeFocused()
    // Esc puts focus back on the chip in the browser lane.
    await juno.win.keyboard.press('Escape')
    await juno.write.expectDestination('#eng')
    await expect(juno.write.composer).toHaveValue('Keyboard only')
    await juno.write.composer.focus()
    await juno.win.keyboard.press('Enter')
    await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Keyboard only').length).toBe(1)
    // ⌘N used the launch tab's Home: it stays active and empty, with the new thread in a tab behind it.
    await expect.poll(() => juno.tabs.titles()).toEqual(['Home', expect.stringMatching(/^Keyboard only/)])
    await juno.tabs.expectActive('Home')
    await expect(juno.write.composer).toHaveValue('')
    await freshHome(juno)
  })

  await step('holding Backspace keeps the destination, and a first @ and a name typed fast with Enter picks the person typed', async () => {
    const { write, win } = juno
    await write.pickConversation('ma', 'Maya')
    await write.composer.pressSequentially('ok')
    // A held key: the first press, then repeats past the last character.
    for (let i = 0; i < 4; i++) await win.keyboard.down('Backspace')
    await win.keyboard.up('Backspace')
    await expect(write.composer).toHaveValue('')
    await write.expectDestination('Maya')
    await write.composer.press('Backspace')
    await write.expectDestination('Juno')

    await write.composer.pressSequentially('@')
    await expect(write.sendTo).toBeVisible()
    // No wait: the rows for "@j" are still on their way when Enter lands.
    await win.keyboard.type('j')
    await win.keyboard.press('Enter')
    await win.keyboard.type('Hi')
    await write.expectDestination('Jonas')
    await expect(write.composer).toHaveValue('Hi')
    await expect(write.composer).toBeFocused()
    await write.composer.fill('')
    await freshHome(juno)
  })

  await step('⌘N opens a new Home when this one has a draft, and "+" opens Home ready to write', async () => {
    const { write, tabs, sidebar, topic } = juno
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    // No Home tab is open, so ⌘N opens one and leaves the topic in its tab.
    await tabs.menu('new-message')
    await tabs.expectCount(2)
    await tabs.expectActiveAt('Home', 0)
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')

    await write.write('Half a thought')
    await tabs.menu('new-message')
    await tabs.expectCount(3)
    await tabs.expectActiveAt('Home', 1)
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await expect(write.composer).toHaveValue('')

    await tabs.newTabButton.click()
    await tabs.expectCount(4)
    await tabs.expectActiveAt('Home', 2)
    await expect(write.composer).toBeFocused()
    await write.expectDestination('Juno')
    await tabs.selectAt('Home', 0)
    await write.composer.fill('')
    await freshHome(juno)
  })

  await step('keys typed on the destination and topic chips go into the field; arrows and Space still drive the chips', async () => {
    const { write, win } = juno
    // Esc from the list gives focus back to the chip in Chromium, and to the field here (README).
    await juno.tabs.menu('new-message')
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await write.chip.focus()
    await win.keyboard.type('What changed today?')
    await expect(write.composer).toBeFocused()
    await expect(write.composer).toHaveValue('What changed today?')
    await write.expectDestination('Juno')

    await win.keyboard.press('Shift+Tab')
    await expect(write.chip).toBeFocused()
    await win.keyboard.press('ArrowDown')
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await write.chip.focus()
    await win.keyboard.press('Space')
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await expect(write.composer).toHaveValue('What changed today?')

    await write.composer.fill('')
    await write.pickConversation('eng', 'eng')
    await write.expectTopic('Main')
    await write.composer.press('Shift+Tab')
    await write.topicChip.focus()
    await write.topicChip.press('D')
    await expect(write.composer).toBeFocused()
    await expect(write.composer).toHaveValue('D')
    await write.composer.fill('')
    await freshHome(juno)
  })

  await step('text pasted right after ⌘T goes into the new Home, in order with the keys typed around it', async () => {
    const { write, topic, sidebar, tabs, win } = juno
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await topic.composer.focus()
    // ⌘T reaches the page before the menu runs it; keys and a ⌘V in that time are held for the new tab.
    const page = win.window as unknown as typeof globalThis
    page.document.activeElement?.dispatchEvent(new page.KeyboardEvent('keydown', { key: 't', code: 'KeyT', metaKey: true, bubbles: true, cancelable: true }))
    await win.keyboard.type('Re: ')
    const data = new page.DataTransfer()
    data.setData('text/plain', 'the launch brief')
    ;(page.document.activeElement ?? page.document.body).dispatchEvent(new page.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    await win.keyboard.type('?')
    await tabs.menu('new-tab')
    await tabs.expectActiveAt('Home', 0)
    await expect(write.composer).toHaveValue('Re: the launch brief?')
    await tabs.select(POSTGRES)
    await expect(topic.composer).toHaveValue('')
    await tabs.selectAt('Home', 0)
    await write.composer.fill('')
    await freshHome(juno)
  })

  await step('Home opens from the sidebar in the current tab; a plain open focuses its tab and ⌘-click opens another', async () => {
    const { tabs, sidebar, topic, nav } = juno
    const home = juno.home.navItem
    await expect(home).toHaveAttribute('aria-current', 'page')
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await expect(home).not.toHaveAttribute('aria-current', 'page')

    await home.click()
    await tabs.expectActive('Home')
    await tabs.expectCount(1)
    await expect(home).toHaveAttribute('aria-current', 'page')
    await juno.home.expectShown()
    await nav.back()
    await topic.expectTitle(POSTGRES)

    // A plain open focuses the tab that shows Home.
    await sidebar.row(OFFSITE).openInNewTab()
    await tabs.select(POSTGRES)
    await home.click()
    await tabs.expectActive('Home')
    await tabs.select(OFFSITE)
    await home.click()
    await tabs.expectCount(2)
    await tabs.expectActive('Home')

    // ⌘-click opens a second Home.
    await home.click({ modifiers: ['Meta'] })
    await tabs.expectCount(3)
    await expect(tabs.tab('Home')).toHaveCount(2)
    await tabs.expectActiveAt('Home', 1)
    await juno.home.expectShown()
    await freshHome(juno)
  })

  await step('Home keeps its draft and destination when a topic opens over it, and its typing goes on at the end', async () => {
    const { write, topic, sidebar, nav, win } = juno
    await write.pickConversation('ma', 'Maya')
    await write.write('A long thought I do not want to lose')
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await nav.back()
    await expect(write.composer).toHaveValue('A long thought I do not want to lose')
    await write.expectDestination('Maya')
    await expect(write.composer).toBeFocused()
    await win.keyboard.type(' and more')
    await expect(write.composer).toHaveValue('A long thought I do not want to lose and more')
  })

  await step('closing Home with a draft shows "Draft closed", and Undo brings the tab back with its draft', async () => {
    const { write, tabs } = juno
    await tabs.closeAt('Home', 0)
    await juno.expectToast('Draft closed')
    // The last tab closed, so a fresh Home took its place.
    await expect(write.composer).toHaveValue('')
    await write.expectDestination('Juno')

    await juno.undoFromToast()
    await expect(tabs.tab('Home')).toHaveCount(2)
    await expect(write.composer).toHaveValue('A long thought I do not want to lose and more')
    await write.expectDestination('Maya')
    await expect(write.composer).toBeFocused()
  })
}, { timeout: 120_000 })
