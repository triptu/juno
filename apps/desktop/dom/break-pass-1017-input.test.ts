// Break pass of 10-17: Home from the keyboard. Emoji suggestions in the
// composers insert through `execCommand`, so they stay in the browser lane
// (`e2e/break-pass-1017-input.spec.ts`). Findings are in
// docs/reviews/2026-10-17-break-pass.md.
import { expect } from './expect'
import { domTest } from './test'

domTest('Home works from the keyboard alone', async ({ juno, fake, step }) => {
  await step('Home from the keyboard alone: ⌘N, Enter right after typing picks, Shift Tab to the chip, send', async () => {
    // ⌘N opens Home's destination list with its search focused.
    await juno.tabs.menu('new-message')
    await expect(juno.write.search).toBeFocused()
    // As a person types once the list shows its search: Enter at once picks the match.
    await juno.win.keyboard.type('eng')
    await juno.win.keyboard.press('Enter')
    await juno.write.expectDestination('#eng')
    await expect(juno.write.composer).toBeFocused()
    await juno.win.keyboard.type('Keyboard only')
    // Shift Tab reaches the topic chip, then the destination chip (Attach files is out of the Tab order); Enter opens its list, Esc closes it without a change.
    await juno.win.keyboard.press('Shift+Tab')
    await expect(juno.write.topicChip).toBeFocused()
    await juno.win.keyboard.press('Shift+Tab')
    await expect(juno.write.chip).toBeFocused()
    await juno.win.keyboard.press('Enter')
    await expect(juno.write.search).toBeFocused()
    // Esc puts focus back on the chip in the browser lane (`e2e/break-pass-1017.spec.ts`, the narrow window).
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
  })
}, { timeout: 120_000 })
