// A custom OpenAI-compatible endpoint (SPEC 13.10) as the renderer sees it: the app's providers
// (`providerTurns`) over HTTP against a fake local model server, behind the same guard and ledger.
import { afterEach, expect, it } from 'bun:test'
import { startFakeOpenAi, type FakeOpenAi, type FakeOpenAiOptions } from '@juno/agent-testing'
import { junoText, type ChatItem, type ChatPage, type OpId } from '@juno/agent-contract'
import { run, served, closeServed } from './serve-harness'

afterEach(closeServed)

const servers: FakeOpenAi[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

const of = <T extends ChatItem['_tag']>(page: ChatPage, tag: T) => page.items.filter((item): item is Extract<ChatItem, { _tag: T }> => item._tag === tag)
const texts = (page: ChatPage) => of(page, 'juno').map((item) => junoText(item.body))

async function endpoint(options: FakeOpenAiOptions & { readonly ownerKey?: string | null } = {}) {
  const server = await startFakeOpenAi(options)
  servers.push(server)
  const harness = await served({ custom: { baseUrl: server.baseUrl, key: options.ownerKey ?? null } })
  return { server, ...harness, settings: harness.follow(harness.client['agent.settings.page']()) }
}

it('lists the endpoint models, answers through the first one, and counts it as $0 the cap cannot track', async () => {
  const { server, client, settings, pageWhere } = await endpoint()
  const page = await settings.where((p) => p.chatModels.length === 2, 'the listed models')
  expect(page.chatModels).toEqual([
    { family: 'qwen3:8b', resolved: 'qwen3:8b', provider: 'custom', selected: true },
    { family: 'llama3.3:70b', resolved: 'llama3.3:70b', provider: 'custom', selected: false },
  ])
  expect(page).toMatchObject({ provider: 'custom', compactionModels: [], spendUntracked: true, spentTodayUsd: 0, capUsd: 5, openRouterKey: 'missing' })
  expect(page.modelTyped).toBeUndefined()

  await run(client['agent.chat.send']({ opId: 'op-1' as OpId, text: 'hello' }))
  const answered = await pageWhere((p) => texts(p).length === 1 && of(p, 'status').length === 0, 'the answer')
  expect(texts(answered)).toEqual(['Hello from the local model.'])
  expect(server.requests).toEqual([{ model: 'qwen3:8b', key: 'none' }])
  // Settings still shows $0 spent and says the cap cannot track this endpoint.
  expect(await settings.where((p) => p.spendUntracked === true, 'the spend after the answer')).toMatchObject({ spentTodayUsd: 0, limitTodayUsd: 5 })

  await run(client['agent.settings.change']({ opId: 'op-2' as OpId, change: { _tag: 'model', purpose: 'chat', provider: 'custom', family: 'llama3.3:70b' } }))
  await settings.where((p) => p.chatModels.find((m) => m.selected)?.family === 'llama3.3:70b', 'llama chosen')
  await run(client['agent.chat.send']({ opId: 'op-3' as OpId, text: 'and again' }))
  await pageWhere((p) => texts(p).length === 2 && of(p, 'status').length === 0, 'the second answer')
  expect(server.requests.map((r) => r.model)).toEqual(['qwen3:8b', 'llama3.3:70b'])
})

it('takes a typed model id when the endpoint lists none', async () => {
  const { server, client, settings, pageWhere } = await endpoint({ models: null })
  const page = await settings.where((p) => p.modelTyped === true, 'a typed model')
  expect(page.chatModels).toEqual([])

  const empty = await run(client['agent.settings.change']({ opId: 'op-1' as OpId, change: { _tag: 'model', purpose: 'chat', provider: 'custom', family: '  ' } }))
  expect(empty).toMatchObject({ _tag: 'Failure', failure: { reason: 'invalid' } })
  await run(client['agent.settings.change']({ opId: 'op-2' as OpId, change: { _tag: 'model', purpose: 'chat', provider: 'custom', family: ' my-model ' } }))
  const typed = await settings.where((p) => p.chatModels.length === 1, 'the typed model')
  expect(typed.chatModels).toEqual([{ family: 'my-model', resolved: 'my-model', provider: 'custom', selected: true }])

  await run(client['agent.chat.send']({ opId: 'op-3' as OpId, text: 'hello' }))
  await pageWhere((p) => texts(p).length === 1, 'the answer')
  expect(server.requests.map((r) => [r.model, r.key])).toEqual([['my-model', 'none']])
})

it('sends the endpoint key, and says when the endpoint refused it', async () => {
  const good = await endpoint({ key: 'local-secret', ownerKey: 'local-secret' })
  await good.settings.where((p) => p.chatModels.length === 2, 'the listed models')
  await run(good.client['agent.chat.send']({ opId: 'op-1' as OpId, text: 'hello' }))
  await good.pageWhere((p) => texts(p).length === 1, 'the answer')
  expect(good.server.requests.map((r) => r.key)).toEqual(['local-secret'])

  const bad = await endpoint({ models: null, key: 'local-secret', ownerKey: 'wrong' })
  await run(bad.client['agent.settings.change']({ opId: 'op-1' as OpId, change: { _tag: 'model', purpose: 'chat', provider: 'custom', family: 'qwen3:8b' } }))
  await run(bad.client['agent.chat.send']({ opId: 'op-2' as OpId, text: 'hello' }))
  await bad.h.ended('op-2')
  const refused = await bad.settings.where((p) => p.customKeyRejected === true, 'the key refused')
  expect(refused.openRouterKey).toBe('missing')
  expect(bad.server.requests).toEqual([])
})

it('a switch to OpenRouter lists its families, and back to the endpoint lists its models', async () => {
  const { client, settings, connection, server } = await endpoint()
  await settings.where((p) => p.provider === 'custom' && p.chatModels.length === 2, 'the endpoint models')
  const openRouter = await run(client['agent.settings.change']({ opId: 'op-1' as OpId, change: { _tag: 'model', purpose: 'chat', provider: 'openrouter', family: 'Claude Opus' } }))
  expect(openRouter).toMatchObject({ _tag: 'Failure', failure: { reason: 'invalid' } })

  connection.set({ _tag: 'openRouter', key: 'sk-or-v1-test' })
  const switched = await settings.where((p) => p.provider === undefined && p.chatModels[0]?.family === 'Claude Sonnet', 'the OpenRouter families')
  expect(switched).toMatchObject({ openRouterKey: 'set', compactionModels: [{ family: 'Claude Haiku', selected: true }, { family: 'Gemini Flash' }] })
  expect(switched.spendUntracked).toBeUndefined()

  connection.set({ _tag: 'custom', baseUrl: server.baseUrl, key: null })
  await settings.where((p) => p.provider === 'custom' && p.chatModels.length === 2, 'the endpoint models again')
})
