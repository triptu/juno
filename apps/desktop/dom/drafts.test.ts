// Drafts synced with Slack (SPEC 8, "Drafts"), as the composer shows them: a draft changed on another
// device appears in an open topic whose composer is not being typed in, and a change from another device
// made before the user's typing never replaces it: the focused field keeps its text and caret, and its text
// goes back to Slack. The rules for every order of events are in specs/drafts.qnt; the engine's side is in
// packages/engine/test/flows/drafts.flow.test.ts.
import { expect } from './expect'
import { domTest } from './test'

domTest('a draft from another device shows in an idle composer, and never replaces typing in a focused one', async ({ juno, fake, step }) => {
  const { topic, sidebar } = juno
  await sidebar.row('#eng').open()
  await topic.expectTitle('Main')

  await step('another device’s draft appears in the open topic', async () => {
    // Leaving the field: the composer is open but nobody is typing in it.
    await topic.composer.press('Escape')
    await expect(topic.composer).not.toBeFocused()
    fake.putDraft({ channel: 'C0ENG', text: 'Started this on my phone' })
    await expect(topic.composer).toHaveValue('Started this on my phone')
  })

  await step('a change from before the typing arrives late: the field keeps its text, which goes back to Slack', async () => {
    const beforeTyping = fake.now()
    await topic.composer.click()
    await topic.composer.fill('')
    await topic.composer.pressSequentially('Rewritten here instead')
    // The other device saved before this typing, but its event comes after it.
    fake.holdFrames({ types: ['draft_update'] })
    fake.putDraft({ channel: 'C0ENG', text: 'An older edit from the phone', at: beforeTyping })
    fake.releaseFrames()
    await expect.poll(() => fake.draftText('C0ENG'), { timeout: 15_000 }).toBe('Rewritten here instead')
    await expect(topic.composer).toHaveValue('Rewritten here instead')
    await expect(topic.composer).toBeFocused()
  })
})
