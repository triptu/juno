// Tables in messages (spec section 7, "Tables"): a Slack `table` block shows
// its cells, the first row as the header; a table wider than the message
// scrolls sideways inside its own box, its far edge shaded, and never widens
// the message; a message that is only a table reads "Table: " and its
// first row in the sidebar; and an edit of a message's words keeps its table.
import { SELF_ID, tableBlock } from '@juno/fake-slack'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const COLUMNS = ['Region', 'Requests', 'Errors', 'Error rate', 'p50 latency', 'p95 latency', 'p99 latency', 'CPU use', 'Memory use', 'Instances', 'Deployed build', 'On call', 'Notes']

// One launch: the wide table from a bot in #eng, and a message of your own with a table in #product to edit.
test('a table shows its cells, scrolls sideways in its own box, reads as a table in the sidebar, and survives an edit of its words', async ({ juno, fake }) => {
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
  const statusTable = tableBlock([['Service', 'Status'], ['API', 'Healthy']])
  const posted = fake.workspace.post({
    channel: 'C0PRODUCT',
    user: SELF_ID,
    text: 'Status',
    silent: true,
    blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Status' }] }] }, statusTable],
  })
  await juno.signIn()
  await juno.waitForSync()

  await test.step('a wide table shows its cells, scrolls in its own box, and reads as a table in the sidebar', async () => {
    const row = juno.sidebar.row('#eng')
    await row.expectPreview(`Deploy Bot: Table: ${COLUMNS.join(', ')}`)
    await row.open()

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

  await test.step('editing the words of a message with a table keeps the table', async () => {
    await juno.sidebar.row('#product').open()
    const { topic } = juno
    await expect(topic.message('Healthy').getByRole('table')).toBeVisible({ timeout: 15_000 })

    await topic.composer.press('ArrowUp')
    await topic.message('Healthy').press('e')
    const field = topic.list.getByRole('textbox', { name: 'Edit message' })
    // The field holds the words; the table is not in it.
    await expect(field).toHaveValue('Status')
    await field.fill('Status updated')
    await field.press('Enter')

    const stored = () => fake.messages('C0PRODUCT').find((message) => message.ts === posted.ts)
    await expect.poll(() => stored()?.text).toBe('Status updated')
    expect(stored()?.blocks?.map((block) => block.type)).toEqual(['rich_text', 'table'])
    expect(stored()?.blocks?.[1]).toEqual(statusTable)
    await expect(topic.message('Status updated').getByRole('table')).toContainText('Healthy')
  })
})
