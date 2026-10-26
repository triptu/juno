// What a message's content paints, from one cold sign-in. Photos, built from the avatar hash as live, load in
// messages, sidebar stacks, a DM row and the account menu; unfurls keep their text when their images fail, and a
// shared message's words show once. A Slack `table` block shows its cells, the first row as the header (spec
// section 7, "Tables"), keeps Slack's alignment, copies as rows of tab-separated cells, and a table wider than the
// message scrolls sideways inside its own box, its far edge shaded, without widening the message. A code block whose
// first line is a language tag shows in that language's colours without the tag line, and a block of prose stays
// plain (spec section 7, "Code blocks"); colours are CSS highlights, read from `CSS.highlights`. An edit that keeps
// a message's table and a user group's chip are in the DOM lane (`dom/strict-message-content.test.ts`); users stored
// without a photo get one on the next start in the engine's restart-cache flow test.
import type { Locator } from '@playwright/test'
import { tableBlock, unfurlFixtures } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import { schemeSrc } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const COLUMNS = ['Region', 'Requests', 'Errors', 'Error rate', 'p50 latency', 'p95 latency', 'p99 latency', 'CPU use', 'Memory use', 'Instances', 'Deployed build', 'On call', 'Notes']

/** Some photo under `scope` has loaded its bytes. */
const expectPhotoLoaded = (scope: Locator) =>
  expect.poll(() => scope.locator(`img${schemeSrc('files')}[src*="/avatar"]`).evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true)

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

// Live, the edge `users/info` and `client.userBoot` carry no `image_*` urls, only `avatar_hash`; the fake answers the
// same way, so every photo here is built from the hash.
test('message content paints: photos load everywhere and unfurls keep text when images fail; a wide table scrolls in its own box; code shows in colour', async ({ juno, fake }) => {
  const fixtures = unfurlFixtures(fake.credentials().url)
  fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Preview setup', silent: true })
  for (const [name, attachment] of Object.entries(fixtures)) {
    fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `Preview ${name}`, attachments: [attachment], silent: true })
  }
  fake.workspace.post({
    channel: 'C0ENG',
    user: 'U0DEPLOYBOT',
    text: 'Traffic by region',
    silent: true,
    blocks: [tableBlock([
      COLUMNS,
      ['us-east-1', '1,284,113', '1,920', '0.15%', '38 ms', '212 ms', '480 ms', '61%', '7.2 GB', '24', [{ type: 'text', text: 'web@c91d02', style: { code: true } }], [{ type: 'user', user_id: 'U0MAYA' }], 'Capacity raised after the morning spike; check the queue depth again at the evening peak before scaling down'],
      ['eu-west-1', '842,550', '611', '0.07%', '41 ms', '198 ms', '455 ms', '54%', '6.8 GB', '16', [{ type: 'link', url: 'https://example.test/builds/c91d02', text: 'c91d02' }], null, 'No change'],
    ], [null, { align: 'right' }])],
  })
  await juno.signIn()
  await juno.waitForSync()

  await test.step('photos load in messages, sidebar stacks, a DM row and the account menu, and unfurls keep text when images fail', async () => {
    // The sidebar's people are the senders of unread messages, so check them before opening marks #eng read.
    fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Unread from Leo' })
    const stack = juno.sidebar.row('#eng').root.locator(`img${schemeSrc('files')}[src*="/avatar"]`)
    await expect.poll(() => stack.evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true)
    const dm = juno.sidebar.row('Maya', { exact: true }).root
    await expect(dm.locator(`img${schemeSrc('files')}[src*="/avatar"]`)).toHaveAttribute('src', /T0JUNO-U0MAYA-fakeu0maya-192$/)
    await expectPhotoLoaded(dm)
    await juno.sidebar.row('#eng').open()
    // A person with the default image, as well as Maya's custom one below.
    const leo = juno.topic.message('Unread from Leo')
    await leo.scrollIntoViewIfNeeded()
    await expect(leo.locator(`img${schemeSrc('files')}[src*="/avatar"]`)).toHaveAttribute('src', /T0JUNO-U0LEO-fakeu0leo-72$/)
    await expectPhotoLoaded(leo)
    const row = juno.topic.message('Preview xImage')
    await row.scrollIntoViewIfNeeded()
    await expect(row).toContainText('Small experiments make the next decision clearer.')
    await expect(row).toContainText('Avery Example (@avery_example)')
    const photo = row.locator(`img${schemeSrc('files')}[src*="/avatar"]`)
    await expect.poll(() => photo.evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true)
    await expect(photo).toHaveAttribute('src', /T0JUNO-U0MAYA-fakeu0maya-72$/)
    const previewImage = row.locator('img[alt*="Avery Example on X" i]')
    await expect.poll(() => previewImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    const failed = juno.topic.message('Preview failed')
    await failed.scrollIntoViewIfNeeded()
    await expect(failed).toContainText('The description remains readable.')
    await expect(failed.locator('section[aria-label="Attachment"] img')).toHaveCount(0)
    await expect(juno.topic.message('Preview xText')).toContainText('A text-only update from the test workspace.')
    // A shared message's words come as blocks and as text; they show once.
    const shared = juno.topic.message('Preview shared')
    await shared.scrollIntoViewIfNeeded()
    await expect(shared.locator('[data-shared-source]')).toHaveText('eng')
    expect(((await shared.textContent()) ?? '').split('Shared words appear once.').length - 1).toBe(1)
    await juno.accountMenu.open()
    const accountPhoto = juno.accountMenu.root.locator(`img${schemeSrc('files')}[src*="/avatar"]`)
    await expect.poll(() => accountPhoto.evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.naturalWidth > 0))).toBe(true)
    await juno.accountMenu.close()
  })

  await test.step('a wide table shows its cells, keeps Slack\'s alignment, copies as rows, and scrolls sideways in its own box', async () => {
    await juno.sidebar.row('#eng').open()
    const message = juno.topic.message('us-east-1')
    await expect(message).toBeVisible({ timeout: 15_000 })
    const table = message.getByRole('table')
    await expect(table.getByRole('columnheader')).toHaveText(COLUMNS)
    await expect(table.getByRole('row')).toHaveCount(3)
    await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveText(['us-east-1', '1,284,113', '1,920', '0.15%', '38 ms', '212 ms', '480 ms', '61%', '7.2 GB', '24', 'web@c91d02', '@Maya', 'Capacity raised after the morning spike; check the queue depth again at the evening peak before scaling down'])
    await expect(table.getByRole('link', { name: 'c91d02' })).toHaveAttribute('href', 'https://example.test/builds/c91d02')
    // Slack's right alignment is kept.
    await expect(table.getByRole('cell', { name: '1,284,113' })).toHaveCSS('text-align', 'right')

    // A selected table copies as a row per line, cells split by tabs.
    const copied = await table.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      const text = selection.toString()
      selection.removeAllRanges()
      return text
    })
    expect(copied.split('\n')[0]).toBe(COLUMNS.join('\t'))

    // The table is wider than the message: its box scrolls, and the message keeps the list's width.
    const box = message.locator('[data-msg-table]')
    const widths = await box.evaluate((element) => {
      const body = element.closest('[data-msg-text]')!
      return { box: element.clientWidth, content: element.scrollWidth, body: body.clientWidth, bodyContent: body.scrollWidth }
    })
    expect(widths.content).toBeGreaterThan(widths.box)
    expect(widths.box).toBeLessThanOrEqual(widths.body)
    expect(widths.bodyContent).toBe(widths.body)
    const scroller = juno.topic.scroller
    const listScroll = await scroller.evaluate((element) => element.scrollLeft)
    // While there is more to the right, the far edge is shaded; at the end it is not.
    const edge = box.locator('[data-table-edge]')
    await expect(edge).toHaveCSS('opacity', '1')
    await box.evaluate((element) => { element.scrollLeft = element.scrollWidth })
    await expect.poll(() => box.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
    await expect(table.getByRole('columnheader', { name: 'Notes' })).toBeInViewport()
    await expect(edge).toHaveCSS('opacity', '0')
    expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(listScroll)
  })

  await test.step('a ts block shows coloured tokens and no tag line, and a prose block stays plain', async () => {
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
    // A keyword shows in the keyword colour, not the code's own: this fails if the ::highlight rules go.
    const colours = await message.locator('[data-test-code="tagged"] code').evaluate((code) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--syntax-keyword)'
      code.append(probe)
      const keyword = getComputedStyle(probe).color
      probe.remove()
      return { highlight: getComputedStyle(code, '::highlight(syntax-keyword)').color, keyword, text: getComputedStyle(code).color }
    })
    expect(colours.highlight).toBe(colours.keyword)
    expect(colours.highlight).not.toBe(colours.text)
    // The prose block keeps the text colour throughout.
    expect(await juno.win.evaluate(colouredRuns, '[data-test-code="prose"]')).toEqual({})
    await expect(message.locator('[data-code-language]')).toHaveCount(1)
  })
})
