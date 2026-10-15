// Main's OpenRouter key (SPEC 13.10): entered once, kept in the keychain, handed to the agent, and
// never in argv, a file or a log. The keychain is a fake: `memoryKeychain`, or `macKeychain` over a
// fake `security` runner.
import { afterEach, expect, it, vi } from 'vitest'
import { macKeychain, memoryKeychain, OpenRouterKeyStore, type SecurityRunner } from '../src/main/keychain'

const KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'

afterEach(() => vi.restoreAllMocks())

function store(options: { readonly stored?: string; readonly override?: string } = {}) {
  const keychain = memoryKeychain(options.stored)
  const sent: Array<string | null> = []
  const keys = new OpenRouterKeyStore(keychain, options.override, (key) => sent.push(key))
  return { keychain, keys, sent }
}

it('a key set in Settings is stored in the keychain and handed to the agent', async () => {
  const { keychain, keys, sent } = store()
  expect(await keys.load()).toBeNull()
  expect(await keys.set(` ${KEY}\n`)).toBe('saved')
  expect(await keychain.read()).toBe(KEY)
  expect(sent).toEqual([null, KEY])
  expect(keys.current).toBe(KEY)
})

it('the next start reads the stored key; OPENROUTER_API_KEY overrides it in development', async () => {
  const stored = store({ stored: KEY })
  expect(await stored.keys.load()).toBe(KEY)
  expect(stored.sent).toEqual([KEY])

  const overridden = store({ stored: KEY, override: 'sk-or-v1-from-the-environment' })
  expect(await overridden.keys.load()).toBe('sk-or-v1-from-the-environment')
  expect(overridden.sent).toEqual(['sk-or-v1-from-the-environment'])
  // A key set in Settings replaces the override for this run and is what the keychain keeps.
  expect(await overridden.keys.set(KEY)).toBe('saved')
  expect(overridden.sent.at(-1)).toBe(KEY)
  expect(await overridden.keychain.read()).toBe(KEY)
})

it('removing the key deletes it from the keychain and tells the agent there is none', async () => {
  const { keychain, keys, sent } = store({ stored: KEY })
  await keys.load()
  expect(await keys.set(null)).toBe('removed')
  expect(await keychain.read()).toBeUndefined()
  expect(sent).toEqual([KEY, null])
})

it('refuses what is not a key, and reports a keychain failure without storing or sending anything', async () => {
  const { keychain, keys, sent } = store()
  await keys.load()
  expect(await keys.set('two words')).toBe('invalid')
  expect(await keys.set('short')).toBe('invalid')
  expect(await keys.set(`${KEY} -U -s other`)).toBe('invalid')
  expect(await keychain.read()).toBeUndefined()

  const failing = new OpenRouterKeyStore({ ...keychain, write: async () => { throw new Error('denied') } }, undefined, (key) => sent.push(key))
  await failing.load()
  expect(await failing.set(KEY)).toBe('failed')
  expect(sent).toEqual([null, null])
})

it('the keychain gets the key on stdin, never in argv, and nothing about it is logged', async () => {
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
  const keys = new OpenRouterKeyStore(macKeychain(undefined, security), undefined, () => {})
  expect(await keys.load()).toBeNull()
  expect(await keys.set(KEY)).toBe('saved')
  expect(await macKeychain(undefined, security).read()).toBe(KEY)
  expect(await keys.set(null)).toBe('removed')

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
