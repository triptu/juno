import { rm } from 'node:fs/promises'
import type { Page } from '@playwright/test'
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
  readonly openRouterKey: string
  readonly chatModels: ReadonlyArray<{ readonly family: string; readonly resolved?: string; readonly price?: string; readonly selected: boolean }>
}
type ChatPage = { readonly page: { readonly items: ReadonlyArray<{ readonly _tag: string; readonly body?: ReadonlyArray<{ readonly text?: string }> }> } }

// Settings › Juno end to end (SPEC 13.10): the key goes through main to the keychain and the agent,
// the picker lists OpenRouter's catalogue, and the chosen model answers the next message.
test('the OpenRouter key set in Settings and the chosen model reach OpenRouter', async () => {
  const openRouter = await startFakeOpenRouter({ key: KEY })
  const userData = await tempUserData()
  const { app, win, close } = await launchApp(userData, { agent: true, fakeOpenRouterUrl: openRouter.origin })
  try {
    await expect.poll(() => hooks(app, 'agentState'), { timeout: 15_000 }).toBe('ready')
    const agent = await agentClient(win)
    const settings = await agent.follow<Settings>('agent.settings.page')

    await expect.poll(async () => (await settings.latest())?.chatModels.find((m) => m.family === 'Claude Opus')?.price).toBe('$4 / $20 per million tokens')
    expect((await settings.latest())?.openRouterKey).toBe('missing')
    expect(openRouter.catalogueReads()).toBe(1)

    expect(await win.evaluate(() => window.juno.agent.setOpenRouterKey('not a key'))).toBe('invalid')
    expect(await win.evaluate((key) => window.juno.agent.setOpenRouterKey(key), KEY)).toBe('saved')
    await expect.poll(async () => (await settings.latest())?.openRouterKey).toBe('set')

    const chose = await agent.command('agent.settings.change', { opId: 'op-model', change: { _tag: 'model', purpose: 'chat', provider: 'openrouter', family: 'Claude Opus' } })
    expect(chose).toEqual({ _tag: 'Success', value: { opId: 'op-model' } })
    await expect.poll(async () => (await settings.latest())?.chatModels.find((m) => m.selected)?.family).toBe('Claude Opus')

    const chat = await agent.follow<ChatPage>('agent.chat.page', { window: { _tag: 'latest', limit: 50 } })
    await agent.command('agent.chat.send', { opId: 'op-send', text: 'hello' })
    await expect
      .poll(async () => (await chat.latest())?.page.items.filter((item) => item._tag === 'juno').map((item) => item.body?.[0]?.text), { timeout: 20_000 })
      .toEqual(['Hello from the fake.'])
    const chatRequests = openRouter.requests.filter((r) => !r.model.includes('haiku'))
    expect(chatRequests.map((r) => [r.path, r.model, r.key])).toEqual([['/api/v1/messages', 'anthropic/claude-opus-5.5', KEY]])
  } finally {
    await close()
    await openRouter.close()
    await rm(userData, { recursive: true, force: true })
  }
})
