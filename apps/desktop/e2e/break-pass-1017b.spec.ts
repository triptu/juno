// Second break pass of 10-17, what needs a browser's focus: Esc from Home's
// destination list and topic list gives focus back to their chips. Keys typed
// on the chips, a paste after ⌘T and the rest of the pass are in the DOM lane
// (`dom/break-pass-1017b.test.ts`). Findings are in
// docs/reviews/2026-10-17-break-pass-b.md.
import { expect, syncedTest } from './fixtures'

syncedTest('Esc from Home\'s destination and topic lists gives focus back to their chips', async ({ juno }) => {
  const { write, tabs } = juno
  await tabs.menu('new-message')
  await expect(write.search).toBeFocused()
  await write.search.press('Escape')
  await expect(write.chip).toBeFocused()

  await write.pickConversation('eng', 'eng')
  await write.expectTopic('Main')
  await write.composer.press('Shift+Tab')
  await write.topicChip.press('ArrowDown')
  await expect(write.topicSearch).toBeFocused()
  await write.topicSearch.press('Escape')
  await expect(write.topicChip).toBeFocused()
})
