// Main's model providers (SPEC 13.10): OpenRouter or one OpenAI-compatible endpoint, one active at a
// time. Keys go to the keychain (a fake here) and never into argv, a file or a log; the agent gets
// only the active provider. Each test uses its own userData folder.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentProvider } from '@juno/agent-contract'
import type { ProviderState } from '@juno/contract'
import { macKeychain, memoryKeychain, OPENROUTER_ITEM, type Keychain, type SecurityRunner } from '../src/main/keychain'
import { PROVIDER_FILE, ProviderStore, type ProviderKeychains } from '../src/main/providers'

const KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'
const LOCAL = 'http://127.0.0.1:11434/v1'

const dirs: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function setup(options: { readonly dir?: string; readonly keychains?: ProviderKeychains; readonly override?: string } = {}) {
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), 'juno-providers-')))
  if (options.dir === undefined) dirs.push(dir)
  const keychains = options.keychains ?? { openRouter: memoryKeychain(), custom: memoryKeychain() }
  const sent: Array<AgentProvider | null> = []
  const states: ProviderState[] = []
  const store = new ProviderStore(dir, keychains, options.override, (state, provider) => {
    states.push(state)
    sent.push(provider)
  })
  await store.load()
  return { dir, keychains, store, sent, states }
}

it('starts with no provider, so the agent gets none', async () => {
  const { store, sent } = await setup()
  expect(store.state).toEqual({ active: null, openRouter: { key: 'missing' }, custom: { baseUrl: '', key: 'missing' } })
  expect(sent).toEqual([null])
})

it('an OpenRouter key set in Settings is stored in the keychain, made active, handed to the agent and kept for the next start', async () => {
  const { dir, keychains, store, sent } = await setup()
  expect(await store.set({ _tag: 'openRouter', key: ` ${KEY}\n` })).toBe('saved')
  expect(await keychains.openRouter.read()).toBe(KEY)
  expect(sent.at(-1)).toEqual({ _tag: 'openRouter', key: KEY })
  expect(store.state).toMatchObject({ active: 'openRouter', openRouter: { key: 'set' } })
  expect(await readFile(join(dir, PROVIDER_FILE), 'utf8')).not.toContain(KEY)

  const next = await setup({ dir, keychains })
  expect(next.sent).toEqual([{ _tag: 'openRouter', key: KEY }])
})

it('OPENROUTER_API_KEY makes OpenRouter the provider in development, over the stored key', async () => {
  const { sent, store } = await setup({ keychains: { openRouter: memoryKeychain(KEY), custom: memoryKeychain() }, override: 'sk-or-v1-from-the-environment' })
  expect(sent).toEqual([{ _tag: 'openRouter', key: 'sk-or-v1-from-the-environment' }])
  expect(store.state.active).toBe('openRouter')
})

it('a custom endpoint is set up with its base URL and an optional key, and the key stays out of the file', async () => {
  const { dir, keychains, store, sent } = await setup()
  expect(await store.set({ _tag: 'custom', baseUrl: `${LOCAL}/` })).toBe('saved')
  expect(sent.at(-1)).toEqual({ _tag: 'custom', baseUrl: LOCAL, key: null })
  expect(store.state).toEqual({ active: 'custom', openRouter: { key: 'missing' }, custom: { baseUrl: LOCAL, key: 'missing' } })

  expect(await store.set({ _tag: 'custom', baseUrl: LOCAL, key: 'local-secret' })).toBe('saved')
  expect(await keychains.custom.read()).toBe('local-secret')
  // A change of address without a key keeps the stored one.
  expect(await store.set({ _tag: 'custom', baseUrl: 'https://models.example.com/v1' })).toBe('saved')
  expect(sent.at(-1)).toEqual({ _tag: 'custom', baseUrl: 'https://models.example.com/v1', key: 'local-secret' })
  expect(await readFile(join(dir, PROVIDER_FILE), 'utf8')).not.toContain('local-secret')

  const next = await setup({ dir, keychains })
  expect(next.sent).toEqual([{ _tag: 'custom', baseUrl: 'https://models.example.com/v1', key: 'local-secret' }])
})

it('one provider is active: switching, and removing the active one falls back to the other, then to none', async () => {
  const { keychains, store, sent } = await setup()
  await store.set({ _tag: 'openRouter', key: KEY })
  await store.set({ _tag: 'custom', baseUrl: LOCAL })
  expect(store.state.active).toBe('custom')
  expect(await store.set({ _tag: 'use', provider: 'openRouter' })).toBe('saved')
  expect(sent.at(-1)).toEqual({ _tag: 'openRouter', key: KEY })

  expect(await store.set({ _tag: 'openRouter', key: null })).toBe('removed')
  expect(await keychains.openRouter.read()).toBeUndefined()
  expect(sent.at(-1)).toEqual({ _tag: 'custom', baseUrl: LOCAL, key: null })
  expect(await store.set({ _tag: 'custom', baseUrl: '' })).toBe('removed')
  expect(store.state).toEqual({ active: null, openRouter: { key: 'missing' }, custom: { baseUrl: '', key: 'missing' } })
  expect(sent.at(-1)).toBeNull()
})

it('refuses what is not a key, an address or a set-up provider, and reports a keychain failure, changing nothing', async () => {
  const failing: Keychain = { ...memoryKeychain(), write: async () => { throw new Error('denied') } }
  const { keychains, store, sent } = await setup({ keychains: { openRouter: failing, custom: memoryKeychain() } })
  expect(await store.set({ _tag: 'openRouter', key: 'two words' })).toBe('invalid')
  expect(await store.set({ _tag: 'openRouter', key: `${KEY} -U -s other` })).toBe('invalid')
  expect(await store.set({ _tag: 'custom', baseUrl: 'ftp://models.example.com' })).toBe('invalid')
  expect(await store.set({ _tag: 'custom', baseUrl: 'not an address' })).toBe('invalid')
  expect(await store.set({ _tag: 'custom', baseUrl: LOCAL, key: 'has a space' })).toBe('invalid')
  expect(await store.set({ _tag: 'use', provider: 'custom' })).toBe('invalid')
  expect(await store.set({ _tag: 'openRouter', key: KEY })).toBe('failed')
  expect(await keychains.custom.read()).toBeUndefined()
  expect(sent).toEqual([null])
  expect(store.state.active).toBeNull()
})

it('the keychain gets a key on stdin, never in argv, and nothing about it is logged', async () => {
  const calls: Array<{ args: ReadonlyArray<string>; stdin: string | undefined }> = []
  let saved: string | undefined
  const security: SecurityRunner = async (args, stdin) => {
    calls.push({ args, stdin })
    if (args[0] === '-i') saved = /-w (\S+)/.exec(stdin ?? '')?.[1]
    if (args[0] === 'find-generic-password') return saved === undefined ? { code: 44, stdout: '' } : { code: 0, stdout: `${saved}\n` }
    if (args[0] === 'delete-generic-password') saved = undefined
    return { code: 0, stdout: '' }
  }
  const logged = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')]
  const { store } = await setup({ keychains: { openRouter: macKeychain(OPENROUTER_ITEM, security), custom: memoryKeychain() } })
  expect(await store.set({ _tag: 'openRouter', key: KEY })).toBe('saved')
  expect(await macKeychain(OPENROUTER_ITEM, security).read()).toBe(KEY)
  expect(await store.set({ _tag: 'openRouter', key: null })).toBe('removed')

  expect(calls.map((call) => call.args)).toEqual([
    ['find-generic-password', '-w', '-s', 'juno-openrouter-key', '-a', 'openrouter'],
    ['-i'],
    ['find-generic-password', '-w', '-s', 'juno-openrouter-key', '-a', 'openrouter'],
    ['delete-generic-password', '-s', 'juno-openrouter-key', '-a', 'openrouter'],
  ])
  expect(calls[1]!.stdin).toBe(`add-generic-password -U -s juno-openrouter-key -a openrouter -w ${KEY}\n`)
  expect(calls.flatMap((call) => call.args).some((arg) => arg.includes(KEY))).toBe(false)
  for (const spy of logged) expect(spy).not.toHaveBeenCalled()
})
