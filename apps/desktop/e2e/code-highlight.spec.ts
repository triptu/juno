// Code colours (spec section 7, "Code blocks"): a code block whose first
// line is a language tag shows in that language's colours without the tag
// line, and a block of prose stays plain. Colours are CSS highlights over
// the block's text, so the test reads them from `CSS.highlights`.
import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

/**
 * The words of every coloured run inside `selector`, by its kind (`keyword`,
 * `string`, ...). Whitespace joins a neighbouring run, so runs are split into words.
 */
function colouredRuns(selector: string): Record<string, string[]> {
  const root = document.querySelector(selector)
  const runs: Record<string, string[]> = {}
  for (const [name, highlight] of CSS.highlights) {
    for (const range of highlight as Highlight) {
      if (!(range instanceof Range) || root === null || !root.contains(range.startContainer)) continue
      ;(runs[name.replace(/^syntax-/, '')] ??= []).push(...range.toString().split(/\s+/).filter((word) => word !== ''))
    }
  }
  return runs
}

test('a ts block shows coloured tokens and no tag line, and a prose block stays plain', async ({ juno, fake }) => {
  fake.workspace.post({
    channel: 'C0ENG',
    user: 'U0LEO',
    text: 'The retry helper',
    blocks: [{
      type: 'rich_text',
      elements: [
        { type: 'rich_text_section', elements: [{ type: 'text', text: 'The retry helper:' }] },
        { type: 'rich_text_preformatted', elements: [{ type: 'text', text: "ts\nexport const tries: number = 3 // at most\nconst name = 'retry'" }] },
        { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'The deploy is blocked until security signs off. Can someone ping Maya about it today?' }] },
      ],
    }],
  })
  await juno.sidebar.row('#eng').open()
  const message = juno.topic.message('The retry helper')
  await expect(message).toBeVisible({ timeout: 15_000 })

  const blocks = message.locator('pre')
  await expect(blocks).toHaveCount(2)
  // The tag line is not shown; the code starts at its first real line.
  await expect(blocks.first()).toHaveText("export const tries: number = 3 // at most\nconst name = 'retry'")
  await expect(message.locator('[data-code-language="typescript"]')).toHaveCount(1, { timeout: 10_000 })

  await message.locator('pre').first().evaluate((element) => element.setAttribute('data-test-code', 'tagged'))
  await message.locator('pre').last().evaluate((element) => element.setAttribute('data-test-code', 'prose'))
  await expect.poll(() => juno.win.evaluate(colouredRuns, '[data-test-code="tagged"]')).toMatchObject({
    keyword: ['export', 'const', 'const'],
    string: ["'retry'"],
    number: ['3'],
    comment: ['//', 'at', 'most'],
  })
  // The prose block keeps the text colour throughout.
  expect(await juno.win.evaluate(colouredRuns, '[data-test-code="prose"]')).toEqual({})
  await expect(message.locator('[data-code-language]')).toHaveCount(1)
})
