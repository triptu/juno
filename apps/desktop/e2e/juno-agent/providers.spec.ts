import { rm } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { startFakeOpenAi } from '@juno/agent-testing/openai'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { expect, hooks, launchApp, tempUserData, test } from '../fixtures'

const KEY = 'sk-or-v1-e2e0123456789abcdef0123456789abcdef'

/**
 * A minimal client of the agent's RPCs in the page, on the port main brokers (the effect/workers
 * framing: [0, message] each way after the runner's [0] ready). Streams keep their latest value;
 * commands keep their exit.
 */
async function agentClient(win: Page) {
  await win.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        setTimeout(() => reject(new Error('no port to the agent')), 10_000)
        const onMessage = (event: MessageEvent) => {
          if (event.source !== window || (event.data as { _tag?: string } | null)?._tag !== 'juno.agentPort') return
          window.removeEventListener('message', onMessage)
          const port = event.ports[0]!
          const state = { latest: {} as Record<string, unknown>, exits: {} as Record<string, unknown>, next: 1 }
          port.addEventListener('message', (reply) => {
            const [kind, message] = reply.data as [number, { _tag: string; requestId: string; values?: unknown[]; exit?: unknown }]
            if (kind !== 1) return
            if (message._tag === 'Chunk') {
              state.latest[message.requestId] = message.values!.at(-1)
              port.postMessage([0, { _tag: 'Ack', requestId: message.requestId }])
            } else if (message._tag === 'Exit') state.exits[message.requestId] = message.exit
          })
          port.start()
          Object.assign(window, {
            agentRpc: (tag: string, payload: unknown) => {
              const id = String(state.next++)
              port.postMessage([0, { _tag: 'Request', id, tag, payload, headers: [] }])
              return id
            },
            agentRpcState: state,
          })
          resolve()
        }
        window.addEventListener('message', onMessage)
        void window.juno.agent.requestPort().then((result) => {
          if (result !== 'sent') reject(new Error(`main answered ${String(result)}`))
        })
      }),
  )
  const call = (tag: string, payload: unknown) => win.evaluate(([t, p]) => (window as unknown as { agentRpc: (t: string, p: unknown) => string }).agentRpc(t, p), [tag, payload] as const)
  const state = () => win.evaluate(() => (window as unknown as { agentRpcState: { latest: Record<string, unknown>; exits: Record<string, unknown> } }).agentRpcState)
  return {
    /** Follows a stream; `latest()` reads its newest value. */
    follow: async <A>(tag: string, payload: unknown = null) => {
      const id = await call(tag, payload)
      return { latest: async () => (await state()).latest[id] as A | undefined }
    },
    /** Sends a command and waits for its exit. */
    command: async (tag: string, payload: unknown) => {
      const id = await call(tag, payload)
      await expect.poll(async () => (await state()).exits[id] !== undefined).toBe(true)
      return (await state()).exits[id]
    },
  }
}

type Settings = {
  readonly provider?: string
  readonly openRouterKey: string
  readonly spendUntracked?: true
  readonly chatModels: ReadonlyArray<{ readonly family: string; readonly resolved?: string; readonly price?: string; readonly selected: boolean }>
}
type ChatPage = { readonly page: { readonly items: ReadonlyArray<{ readonly _tag: string; readonly body?: ReadonlyArray<{ readonly text?: string }> }> } }
type ProviderState = { readonly active: string | null; readonly openRouter: { readonly key: string }; readonly custom: { readonly baseUrl: string; readonly key: string } }

const NONE: ProviderState = { active: null, openRouter: { key: 'missing' }, custom: { baseUrl: '', key: 'missing' } }

/** Records every provider state main pushes to the page. */
async function watchProvider(win: Page) {
  await win.evaluate(() => {
    const seen: unknown[] = []
    Object.assign(window, { providerStates: seen })
    window.juno.agent.onProvider((state) => seen.push(state))
  })
  return () => win.evaluate(() => (window as unknown as { providerStates: ProviderState[] }).providerStates)
}

async function bubbles(agent: Awaited<ReturnType<typeof agentClient>>, text: string) {
  const chat = await agent.follow<ChatPage>('agent.chat.page', { window: { _tag: 'latest', limit: 50 } })
  await agent.command('agent.chat.send', { opId: 'op-send', text })
  return () => chat.latest().then((page) => page?.page.items.filter((item) => item._tag === 'juno').map((item) => item.body?.[0]?.text))
}

// SPEC 13.10: with no provider set up the agent does not run, and asking for its port says so at once.
test('with no provider the agent does not run', async ({ app, win }) => {
  expect(await win.evaluate(() => window.juno.agent.provider())).toEqual(NONE)
  expect(await win.evaluate(() => window.juno.agent.requestPort())).toBe('failed')
  // Nothing starts later either.
  await win.waitForTimeout(1_000)
  expect(await hooks(app, 'agentState')).toBe('stopped')
  expect(await hooks(app, 'agentPid')).toBeUndefined()
})

// Adding an OpenRouter key turns the agent on: the key goes through main to the keychain and the agent,
// the picker lists OpenRouter's catalogue, and the chosen model answers the next message.
test('adding an OpenRouter key turns the agent on, and the chosen model answers', async () => {
  const openRouter = await startFakeOpenRouter({ key: KEY })
  const userData = await tempUserData()
  const { app, win, close } = await launchApp(userData, { fakeOpenRouterUrl: openRouter.origin })
  try {
    const states = await watchProvider(win)
    expect(await hooks(app, 'agentState')).toBe('stopped')
    expect(await win.evaluate(() => window.juno.agent.setOpenRouterKey('not a key'))).toBe('invalid')
    expect(await win.evaluate((key) => window.juno.agent.setOpenRouterKey(key), KEY)).toBe('saved')
    expect(await states()).toEqual([{ ...NONE, active: 'openRouter', openRouter: { key: 'set' } }])
    await expect.poll(() => hooks(app, 'agentState'), { timeout: 15_000 }).toBe('ready')

    const agent = await agentClient(win)
    const settings = await agent.follow<Settings>('agent.settings.page')
    await expect.poll(async () => (await settings.latest())?.chatModels.find((m) => m.family === 'Claude Opus')?.price).toBe('$4 in, $20 out per million tokens')
    expect(await settings.latest()).toMatchObject({ openRouterKey: 'set' })
    expect(openRouter.catalogueReads()).toBe(1)

    const chose = await agent.command('agent.settings.change', { opId: 'op-model', change: { _tag: 'model', purpose: 'chat', provider: 'openrouter', family: 'Claude Opus' } })
    expect(chose).toEqual({ _tag: 'Success', value: { opId: 'op-model' } })
    await expect.poll(async () => (await settings.latest())?.chatModels.find((m) => m.selected)?.family).toBe('Claude Opus')

    const answers = await bubbles(agent, 'hello')
    await expect.poll(answers, { timeout: 20_000 }).toEqual(['Hello from the fake.'])
    const chatRequests = openRouter.requests.filter((r) => !r.model.includes('haiku'))
    expect(chatRequests.map((r) => [r.path, r.model, r.key])).toEqual([['/api/v1/messages', 'anthropic/claude-opus-5.5', KEY]])
  } finally {
    await close()
    await openRouter.close()
    await rm(userData, { recursive: true, force: true })
  }
})

// A custom OpenAI-compatible endpoint (a local model server) set up in Settings › Juno runs the chat.
test('a custom endpoint turns the agent on and answers through its model', async () => {
  const endpoint = await startFakeOpenAi()
  const userData = await tempUserData()
  const { app, win, close } = await launchApp(userData)
  try {
    expect(await win.evaluate(() => window.juno.agent.setProvider({ _tag: 'custom', baseUrl: 'not an address' }))).toBe('invalid')
    expect(await win.evaluate((baseUrl) => window.juno.agent.setProvider({ _tag: 'custom', baseUrl }), endpoint.baseUrl)).toBe('saved')
    expect(await win.evaluate(() => window.juno.agent.provider())).toEqual({ ...NONE, active: 'custom', custom: { baseUrl: endpoint.baseUrl, key: 'missing' } })
    await expect.poll(() => hooks(app, 'agentState'), { timeout: 15_000 }).toBe('ready')

    const agent = await agentClient(win)
    const settings = await agent.follow<Settings>('agent.settings.page')
    await expect.poll(async () => (await settings.latest())?.chatModels.map((m) => [m.family, m.selected])).toEqual([
      ['qwen3:8b', true],
      ['llama3.3:70b', false],
    ])
    expect(await settings.latest()).toMatchObject({ provider: 'custom', spendUntracked: true })

    const answers = await bubbles(agent, 'hello')
    await expect.poll(answers, { timeout: 20_000 }).toEqual(['Hello from the local model.'])
    expect(endpoint.requests).toEqual([{ model: 'qwen3:8b', key: 'none' }])

    // Removing the only provider stops the agent.
    expect(await win.evaluate(() => window.juno.agent.setProvider({ _tag: 'custom', baseUrl: '' }))).toBe('removed')
    await expect.poll(() => hooks(app, 'agentState')).toBe('stopped')
    expect(await win.evaluate(() => window.juno.agent.requestPort())).toBe('failed')
  } finally {
    await close()
    await endpoint.close()
    await rm(userData, { recursive: true, force: true })
  }
})
