// ↑ from a topic's composer (SPEC section 7, Keyboard): a plain ↑ with the
// caret on the draft's first visual line selects the newest message and keeps
// the draft and its caret for ↓; from a lower line, a wrapped one included, it
// moves the caret. Shift ↑ and the open @ suggestions keep the key. Esc selects
// the message under the pointer, else the newest, and message keys act on a
// hovered message when focus is on no row or field.
import type { Locator } from '@playwright/test'
import type { FakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const NEWEST = 'Looking at the replica lag now'

async function openMain(juno: Juno, fake: FakeSlack): Promise<void> {
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  await juno.topic.send(NEWEST)
  await juno.topic.expectSent(NEWEST)
  await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === NEWEST)).toBe(true)
}

const caretOf = (field: Locator) => field.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])
const putCaret = (field: Locator, at: number) => field.evaluate((el: HTMLTextAreaElement, to) => el.setSelectionRange(to, to), at)

test('↑ on the composer’s first line selects the newest message, keeping the draft and caret for ↓', async ({ juno, fake }) => {
  await openMain(juno, fake)
  const { topic, win } = juno
  const newest = topic.message(NEWEST)

  await test.step('two lines, caret on the second: ↑ moves the caret, ↑ again selects, ↓ comes back', async () => {
    const draft = 'first line\nsecond line'
    await topic.composer.fill(draft)
    await putCaret(topic.composer, draft.length)
    await topic.composer.press('ArrowUp')
    await expect(topic.composer).toBeFocused()
    const [at] = await caretOf(topic.composer)
    expect(at).toBeLessThanOrEqual(draft.indexOf('\n'))
    await topic.composer.press('ArrowUp')
    await expect(newest).toBeFocused()
    await win.keyboard.press('ArrowDown')
    await expect(topic.composer).toBeFocused()
    await expect(topic.composer).toHaveValue(draft)
    expect(await caretOf(topic.composer)).toEqual([at, at])
  })

  await test.step('a first paragraph that wraps: ↑ from its last visual line moves the caret, from its first it selects', async () => {
    const draft = 'a long first paragraph that wraps '.repeat(8).trim()
    await topic.composer.fill(draft)
    await putCaret(topic.composer, draft.length)
    await topic.composer.press('ArrowUp')
    await expect(topic.composer).toBeFocused()
    expect((await caretOf(topic.composer))[0]).toBeLessThan(draft.length)
    await putCaret(topic.composer, 3)
    await topic.composer.press('ArrowUp')
    await expect(newest).toBeFocused()
    await win.keyboard.press('ArrowDown')
    await expect(topic.composer).toHaveValue(draft)
  })

  await test.step('Shift ↑ on the first line selects text and stays in the composer', async () => {
    await topic.composer.fill('one line')
    await putCaret(topic.composer, 4)
    await topic.composer.press('Shift+ArrowUp')
    await expect(topic.composer).toBeFocused()
    expect(await caretOf(topic.composer)).toEqual([0, 4])
  })

  await test.step('with the @ suggestions open, ↑ moves in the list', async () => {
    await topic.composer.fill('')
    await topic.composer.pressSequentially('@')
    await expect(topic.suggestions.getByRole('option').nth(1)).toBeVisible()
    await expect(topic.composer).toHaveAttribute('aria-activedescendant', /.+/)
    const before = (await topic.composer.getAttribute('aria-activedescendant'))!
    await topic.composer.press('ArrowUp')
    await expect(topic.composer).toBeFocused()
    await expect(topic.suggestions).toBeVisible()
    await expect(topic.composer).not.toHaveAttribute('aria-activedescendant', before)
  })
})

test('Esc in the composer selects the message under the pointer, else the newest; keys act on a hovered message', async ({ juno, fake }) => {
  const HOVERED = 'Hover target for Esc'
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  for (const text of [HOVERED, NEWEST]) {
    await juno.topic.send(text)
    await juno.topic.expectSent(text)
  }
  await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === NEWEST)).toBe(true)
  const { topic, win } = juno
  const editField = topic.list.getByRole('textbox', { name: 'Edit message' })

  await test.step('hovered: Esc selects it, and E edits it', async () => {
    await topic.composer.focus()
    await topic.message(HOVERED).hover()
    await topic.composer.press('Escape')
    await expect(topic.message(HOVERED)).toBeFocused()
    await win.keyboard.press('e')
    await expect(editField).toHaveValue(HOVERED)
    await editField.press('Escape')
    await expect(topic.composer).toBeFocused()
  })

  await test.step('nothing hovered: Esc selects the newest message', async () => {
    await topic.composer.hover()
    await topic.composer.press('Escape')
    await expect(topic.message(NEWEST)).toBeFocused()
  })

  await test.step('focus on no row or field: E edits the message under the pointer', async () => {
    await topic.message(NEWEST).evaluate((row: HTMLElement) => row.blur())
    await topic.message(HOVERED).hover()
    await win.keyboard.press('e')
    await expect(editField).toHaveValue(HOVERED)
  })
})
