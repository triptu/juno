// The fake OpenRouter through pi-ai's real OpenRouter provider (Anthropic Messages for Claude), as the agent process reaches it in e2e.
import { afterEach, expect, it } from 'vitest'
import { createModels, type Context } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { OPENROUTER_MODELS } from '@earendil-works/pi-ai/providers/openrouter.models'
import { startFakeOpenRouter, type FakeOpenRouter } from '../src/index'

let fake: FakeOpenRouter | undefined
afterEach(async () => {
  await fake?.close()
  fake = undefined
})

it('answers a streamed chat request through the OpenRouter provider and records it', async () => {
  fake = await startFakeOpenRouter({ answer: (request) => `<say>You said ${request.input}</say>` })
  const model = { ...Object.values(OPENROUTER_MODELS).find((m) => m.id === 'anthropic/claude-sonnet-5.5')!, baseUrl: fake.url }
  const models = createModels()
  models.setProvider({ ...openrouterProvider(), getModels: () => [model], getAllModels: () => [model], auth: { apiKey: { name: 'OpenRouter', resolve: async () => ({ auth: { apiKey: 'k' } }) } } })
  const context: Context = { systemPrompt: 'be brief', messages: [{ role: 'user', content: 'hello', timestamp: 0 }] }

  const answer = await models.completeSimple(model, context)

  expect([answer.stopReason, answer.errorMessage]).toEqual(['stop', undefined])
  expect(answer.content).toEqual([{ type: 'text', text: '<say>You said hello</say>' }])
  expect(fake.requests.map((r) => [r.model, r.input])).toEqual([['anthropic/claude-sonnet-5.5', 'hello']])
})
