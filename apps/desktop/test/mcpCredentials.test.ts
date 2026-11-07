// Main's MCP keychain bridge: an MCP connection's OAuth state lives only in keychain items, in
// chunks `security -i` accepts, and only checked sign-in pages open. A fake `security` stands in.
import { expect, it } from 'bun:test'
import type { CredentialRequest } from '@juno/agent-contract'
import { macKeychain, type SecurityRunner } from '../src/main/keychain'
import { mcpCredentials } from '../src/main/mcpCredentials'

/** A fake `security`: generic passwords by service and account, and every stdin line it was given. */
function fakeSecurity() {
  const items = new Map<string, string>()
  const lines: string[] = []
  /** Writes left before `security` starts failing (a locked keychain, a kill mid-save); none set, it never fails. */
  let writesLeft = Number.POSITIVE_INFINITY
  const run: SecurityRunner = async (args, stdin) => {
    const flag = (name: string, from: ReadonlyArray<string>) => from[from.indexOf(name) + 1] ?? ''
    if (args[0] === '-i') {
      if (writesLeft <= 0) return { code: 36, stdout: '' }
      writesLeft -= 1
      lines.push(stdin ?? '')
      const words = (stdin ?? '').trim().split(' ')
      items.set(`${flag('-s', words)}/${flag('-a', words)}`, flag('-w', words))
      return { code: 0, stdout: '' }
    }
    const key = `${flag('-s', args)}/${flag('-a', args)}`
    if (args[0] === 'find-generic-password') return items.has(key) ? { code: 0, stdout: `${items.get(key)}\n` } : { code: 44, stdout: '' }
    if (args[0] === 'delete-generic-password') return items.delete(key) ? { code: 0, stdout: '' } : { code: 44, stdout: '' }
    return { code: 1, stdout: '' }
  }
  return { items, lines, run, failWritesAfter: (count: number) => { writesLeft = count } }
}

function bridge() {
  const security = fakeSecurity()
  const opened: string[] = []
  const answer = mcpCredentials({ keychain: (item) => macKeychain(item, security.run), open: async (url) => { opened.push(url) } })
  return { security, opened, ask: (request: CredentialRequest) => answer(request) }
}

it('keeps a large OAuth state in keychain chunks short enough for security, and clears every one', async () => {
  const { security, ask } = bridge()
  const state = JSON.stringify({ serverUrl: 'https://mcp.example.com/mcp', tokens: { access_token: 'a'.repeat(9000), refresh_token: 'r'.repeat(40) } })
  await ask({ _tag: 'save', id: 'notion', state })
  expect(await ask({ _tag: 'load', id: 'notion' })).toBe(state)
  expect(security.lines.every((line) => line.length < 4000)).toBe(true)
  expect([...security.items.keys()].every((key) => key.startsWith('juno-mcp/notion'))).toBe(true)

  // A smaller state replaces it and leaves no stale chunk behind.
  await ask({ _tag: 'save', id: 'notion', state: '{"serverUrl":"x"}' })
  expect(await ask({ _tag: 'load', id: 'notion' })).toBe('{"serverUrl":"x"}')
  expect(security.items.size).toBe(2)

  await ask({ _tag: 'clear', id: 'notion' })
  expect(await ask({ _tag: 'load', id: 'notion' })).toBeNull()
  expect(security.items.size).toBe(0)
})

it('a save that stops part way leaves no state rather than a mix of old and new chunks', async () => {
  const { security, ask } = bridge()
  const older = JSON.stringify({ tokens: { access_token: 'o'.repeat(7000) } })
  await ask({ _tag: 'save', id: 'notion', state: older })
  // The keychain fails after the first new chunk is in: the save ends there, as a kill mid-save would.
  security.failWritesAfter(1)
  await expect(ask({ _tag: 'save', id: 'notion', state: JSON.stringify({ tokens: { access_token: 'n'.repeat(7000) } }) })).rejects.toThrow()
  expect(await ask({ _tag: 'load', id: 'notion' })).toBeNull()
  // The owner disconnects the server: the old chunks, which no count points at any more, go too.
  security.failWritesAfter(Number.POSITIVE_INFINITY)
  await ask({ _tag: 'clear', id: 'notion' })
  expect(security.items.size).toBe(0)
})

it('runs one connection’s writes in order', async () => {
  const { ask } = bridge()
  await Promise.all([
    ask({ _tag: 'save', id: 't3', state: 'first' }),
    ask({ _tag: 'clear', id: 't3' }),
    ask({ _tag: 'save', id: 't3', state: 'last' }),
  ])
  expect(await ask({ _tag: 'load', id: 't3' })).toBe('last')
})

it('refuses ids that are not Juno’s, and opens only https or a sign-in page on this Mac', async () => {
  const { security, opened, ask } = bridge()
  await expect(ask({ _tag: 'save', id: 'x -w y', state: 'state' })).rejects.toThrow()
  expect(security.items.size).toBe(0)
  await expect(ask({ _tag: 'open', url: 'file:///etc/passwd' })).rejects.toThrow()
  await expect(ask({ _tag: 'open', url: 'http://example.com/authorize' })).rejects.toThrow()
  await ask({ _tag: 'open', url: 'https://mcp.notion.com/authorize?client_id=c' })
  await ask({ _tag: 'open', url: 'http://localhost:3773/oauth/mcp/authorize' })
  expect(opened).toEqual(['https://mcp.notion.com/authorize?client_id=c', 'http://localhost:3773/oauth/mcp/authorize'])
})
