// Break pass: interrupted and odd input in a topic. A malformed launch.json and window
// minimize stay in the electron project (`e2e/break-pass.spec.ts`).
import { expect } from './expect'
import { domTest } from './test'

// Each step opens #eng and sends there; none changes what a later one checks.
domTest('interrupted and odd input in a topic: a deleted message, a deleted quote source, fast Enter and long RTL text', async ({ juno, fake, step }) => {
  await step('a deleted message cannot be edited from its already open menu', async () => {
    await juno.sidebar.row('#eng').open()
    await juno.topic.send('Delete under menu')
    await juno.topic.expectSent('Delete under menu')
    const message = fake.messages('C0ENG').find((m) => m.text === 'Delete under menu')!
    const menu = await juno.topic.messageMenu('Delete under menu')
    fake.deleteMessage({ channel: 'C0ENG', ts: message.ts })
    await expect(juno.topic.message('Delete under menu')).toHaveCount(0)
    await menu.choose('edit')
    await juno.topic.composer.fill('Still usable')
    await expect(juno.topic.list.getByRole('textbox', { name: 'Edit message' })).toHaveCount(0)
    await juno.topic.composer.press('Enter')
    await juno.topic.expectSent('Still usable')
  })

  await step('deleting the source of a Slack quote keeps the written reply', async () => {
    await juno.sidebar.row('#eng').open()
    const message = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Keep this quote' })
    const row = juno.topic.message('Keep this quote')
    await expect(row).toBeVisible()
    await (await juno.topic.messageMenu('Keep this quote')).choose('quote')
    await expect(juno.topic.composer).toHaveValue('> Keep this quote\n')
    fake.deleteMessage({ channel: 'C0ENG', ts: message.ts })
    await expect(row).toHaveCount(0)
    await expect(juno.topic.composer).toHaveValue('> Keep this quote\n')
    await juno.topic.composer.press('Enter')
    await expect.poll(() => fake.messages('C0ENG').some((m) => m.text?.includes('Keep this quote'))).toBe(true)
  })

  await step('fast Enter presses send the draft once while the post waits', async () => {
    await juno.sidebar.row('#eng').open()
    fake.holdNext({ method: 'chat.postMessage', before: true })
    await juno.topic.composer.fill('Only one copy')
    await juno.topic.composer.press('Enter')
    await juno.topic.composer.press('Enter')
    await juno.topic.composer.press('Enter')
    await expect(juno.topic.composer).toHaveValue('')
    fake.release()
    await juno.topic.expectSent('Only one copy')
    await juno.topic.send('After the burst')
    await juno.topic.expectSent('After the burst')
    expect(fake.messages('C0ENG').filter((m) => m.text === 'Only one copy')).toHaveLength(1)
  })

  await step('long RTL and zero-width text leaves the composer usable', async () => {
    await juno.sidebar.row('#eng').open()
    const text = 'مرحبا\u200b עולם '.repeat(700) + 'End of long message'
    fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text })
    await expect(juno.topic.message('End of long message')).toBeVisible()
    await juno.topic.send('Reply after long text')
    await juno.topic.expectSent('Reply after long text')
  })
}, { timeout: 120_000 })
