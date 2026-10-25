// Second break pass of 10-17: keys typed on Home's chip and keys held after
// ⌘T, which reach the field through `execCommand`. The rest of the pass is in
// the DOM lane (`dom/break-pass-1017b.test.ts`). Findings are in
// docs/reviews/2026-10-17-break-pass-b.md.
import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'

test("Home's field takes keys typed on its chips and a paste after ⌘T, and Esc gives focus back to a chip", async ({ juno }) => {
  await test.step('keys typed on the destination chip go into the field; arrows and Space still drive the chip', async () => {
    const { write, tabs, win } = juno

    await tabs.menu('new-message')
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await expect(write.chip).toBeFocused()
    await win.keyboard.type('What changed today?')
    await expect(write.composer).toBeFocused()
    await expect(write.composer).toHaveValue('What changed today?')
    await write.expectDestination('Juno')

    await win.keyboard.press('Shift+Tab')
    await expect(write.chip).toBeFocused()
    await win.keyboard.press('ArrowDown')
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await win.keyboard.press('Space')
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await expect(write.composer).toHaveValue('What changed today?')
  })

  await test.step("the topic chip: Esc from its list gives focus back to it, and a key typed on it goes into the field", async () => {
    const { write } = juno

    await write.composer.fill('')
    await write.pickConversation('eng', 'eng')
    await write.expectTopic('Main')
    await write.composer.press('Shift+Tab')
    await write.topicChip.press('ArrowDown')
    await expect(write.topicSearch).toBeFocused()
    await write.topicSearch.press('Escape')
    await expect(write.topicChip).toBeFocused()
    await write.topicChip.press('D')
    await expect(write.composer).toBeFocused()
    await expect(write.composer).toHaveValue('D')
  })

  await test.step('text pasted right after ⌘T goes into the new Home, in order with the keys typed around it', async () => {
    const { write, topic, sidebar, tabs, win } = juno

    await sidebar.row(POSTGRES).open()
    await topic.composer.focus()
    // ⌘T reaches the page before the menu runs it; keys and a ⌘V in that time are held for the new tab.
    await win.evaluate(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', metaKey: true, bubbles: true, cancelable: true })))
    await win.keyboard.type('Re: ')
    await win.evaluate(() => {
      const data = new DataTransfer()
      data.setData('text/plain', 'the launch brief')
      ;(document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    await win.keyboard.type('?')
    await tabs.menu('new-tab')
    await tabs.expectActiveAt('Home', 0)
    await expect(write.composer).toHaveValue('Re: the launch brief?')
    await tabs.select(POSTGRES)
    await expect(topic.composer).toHaveValue('')
  })
})
