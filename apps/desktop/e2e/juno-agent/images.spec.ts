// Images for Juno (SPEC 12 "Writing", 13.1): attached on Home with Juno chosen, or in the Juno tab,
// they go to the chat model as image parts and show as thumbnails on the owner's bubble. A file
// Juno does not read stays in the composer with a line saying so, and so does an image while the
// chat model cannot read images.
import { chatCopy } from '@juno/agent-contract'
import { brief, chart, drop, paste } from '../attach'
import { openChat, openSettings, readySynced as ready } from './agent'
import { answer, expect, JunoChatPane, test as base } from './chat'
import { startScriptedModel, type CatalogueModel, type ScriptedModel } from './model'

/** Grok reads text only here; the other models read images too, as the fake's catalogue says. */
const textOnlyGrok = (models: ReadonlyArray<CatalogueModel>): ReadonlyArray<CatalogueModel> =>
  models.map((model) => (model.id.startsWith('x-ai/grok') ? { ...model, architecture: { input_modalities: ['text'], output_modalities: ['text'] } } : model))

const test = base.extend<{ readonly model: ScriptedModel }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startScriptedModel({ answer, catalogue: textOnlyGrok })
    await use(model)
    await model.close()
  },
})

test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const chatRequests = (model: ScriptedModel) => model.requests.filter((request) => !request.compaction)

test('an image attached on Home goes to Juno as an image part and a PDF stays on Home; the Juno tab takes a dropped image on its own, and with a model that reads text only the image stays and the line says why', async ({ juno, model }) => {
  await ready(juno)
  const { write, tabs } = juno
  await write.expectDestination('Juno')
  // The attach button is there with Juno chosen.
  await expect(write.root.locator('[data-composer]').getByRole('button', { name: 'Attach files' })).toBeVisible()

  await write.write('What does this chart show?')
  await paste(write.composer, [chart(), brief()])
  await expect(write.root.locator('[data-composer] [data-attachment="ready"]')).toHaveCount(2)
  // Juno takes the image; the PDF stays, and the line says so.
  await expect(write.root.locator('[data-attachment-note]')).toHaveText(chatCopy.composer.filesLeft.other)
  await write.send()

  await tabs.expectActive('Juno')
  const chat = JunoChatPane.tab(juno.win)
  const bubble = chat.ownerBubble('What does this chart show?')
  await expect(bubble.locator('[data-owner-image="0"] img')).toBeVisible()
  await chat.expectJuno('You said: What does this chart show?')
  const sent = chatRequests(model).find((request) => request.images.length > 0)
  expect(sent?.images).toEqual([{ mimeType: 'image/png', bytes: expect.any(Number) }])
  expect(sent?.input).toContain('<image n="0" name="chart.png" width="640" height="400"/>')

  // Back on Home the PDF is still attached, for a person or channel.
  await juno.nav.back()
  await tabs.expectActive('Home')
  await expect(write.root.getByRole('button', { name: 'Remove launch-brief.pdf' })).toBeVisible()
  await expect(write.root.getByRole('button', { name: 'Remove chart.png' })).toHaveCount(0)

  // The Juno tab takes a dropped image on its own: an image alone is a message, no text needed.
  await openChat(juno)
  await expect(chat.root.locator('[data-juno-composer]').getByRole('button', { name: 'Attach files' })).toBeVisible()
  const withImage = () => chatRequests(model).filter((request) => request.images.length > 0).length
  const sentBefore = withImage()
  await drop(chat.root.locator('[data-juno-composer]'), [chart()])
  await expect(chat.root.locator('[data-juno-composer] [data-attachment="ready"] img')).toBeVisible()
  await chat.composer.press('Enter')
  await expect(chat.root.locator('[data-chat-owner] [data-owner-image="0"] img')).toHaveCount(2)
  await expect.poll(withImage, { timeout: 15_000 }).toBe(sentBefore + 1)
  await expect(chat.root.locator('[data-juno-composer] [data-attachment]')).toHaveCount(0)

  // Grok reads text only here.
  const settings = await openSettings(juno, 'Juno')
  await settings.getByLabel('Chat model').selectOption('Grok')
  await expect(settings.getByLabel('Chat model')).toHaveValue('Grok')
  const again = await openChat(juno)
  await paste(again.composer, [chart()])
  const note = again.root.locator('[data-juno-composer] [data-attachment-note]')
  await expect(note).toHaveText(chatCopy.composer.filesLeft.images, { timeout: 15_000 })

  // The words go; the image stays, and the model gets no image.
  const before = chatRequests(model).length
  await again.send('What is in it?')
  await again.expectJuno('You said: What is in it?')
  expect(chatRequests(model).slice(before).every((request) => request.images.length === 0)).toBe(true)
  await expect(again.root.locator('[data-juno-composer] [data-attachment]')).toHaveCount(1)
  await expect(note).toBeVisible()
})
