// What a message's content shows and sends, with no layout. An edit of the words of a message with a Slack `table`
// block keeps the table (spec section 7, "Tables"): the edit field holds the words only, and the update goes with the
// table block as it was. A user group mention, a bare `<!subteam^S…>` from Slack, shows as a chip with the group's
// "@handle" and its name as the title, never its id; which handle, in Main, a thread, the sidebar, for a deleted
// group and after a rename, is engine data (`message-content.flow.test.ts`). A table's cells, its sideways scroll
// and the rest of what message content paints are in the browser lane (`e2e/avatars-unfurls.spec.ts`).
import { SELF_ID, tableBlock } from '@juno/fake-slack'
import { expect } from './expect'
import { domTest } from './test'

domTest('an edit of a message with a table keeps the table, and a user group shows as its handle', async ({ juno, fake, step }) => {
  const { topic } = juno

  await step('editing the words of a message with a table keeps the table', async () => {
    const statusTable = tableBlock([['Service', 'Status'], ['API', 'Healthy']])
    const posted = fake.workspace.post({
      channel: 'C0PRODUCT',
      user: SELF_ID,
      text: 'Status',
      blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Status' }] }] }, statusTable],
    })
    await juno.sidebar.row('#product').open()
    await topic.expectTitle('Main')
    await expect(topic.message('Healthy').getByRole('table')).toBeVisible({ timeout: 15_000 })

    await topic.composer.press('ArrowUp')
    await expect(topic.message('Healthy')).toBeFocused()
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

  await step('a user group mention shows as a chip with its handle and name, never its id', async () => {
    fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: '<!subteam^S0DESIGN> the new icons are ready for review.' })
    await juno.sidebar.row('#eng').open()
    await topic.expectTitle('Main')
    const design = topic.message('the new icons are ready').locator('[data-usergroup="S0DESIGN"]')
    await expect(design).toHaveText('@design-crew')
    await expect(design).toHaveAttribute('title', 'Design crew')
    await expect(topic.root).not.toContainText('S0DESIGN')
  })
})
