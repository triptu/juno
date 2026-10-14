// The Littlebird fake: OAuth, paginated discovery and a tool list that changes.
import { afterEach, expect, it } from 'vitest'
import { McpClient, StreamableHttpTransport } from '@earendil-works/pi-mcp'
import { adaptOAuthProvider } from '@earendil-works/pi-mcp/oauth'
import { LITTLEBIRD_READ_TOOLS, LITTLEBIRD_WRITE_TOOLS, startFakeLittlebird, unknownTool, type FakeLittlebird } from '../src/index'
import { signIn } from './signIn'

let littlebird: FakeLittlebird | undefined
afterEach(async () => {
  await littlebird?.close()
  littlebird = undefined
})

it('asks for the scopes S8 found and offers refresh', async () => {
  littlebird = await startFakeLittlebird()
  const { client, redirects, store } = await signIn(littlebird.url, littlebird.oauth)
  expect(redirects[0]!.searchParams.get('scope')).toBe('littlebird:mcp openid email')
  expect(store.load()?.tokens?.refresh_token).toBeDefined()
  await client.close()
})

it('lists every tool across pages, including an unknown one', async () => {
  littlebird = await startFakeLittlebird({ extraTools: [unknownTool()] })
  const { client } = await signIn(littlebird.url, littlebird.oauth)
  const tools = await client.listTools()
  expect(tools.map((t) => t.name)).toEqual([...LITTLEBIRD_READ_TOOLS, ...LITTLEBIRD_WRITE_TOOLS, 'export_everything'])
  expect(tools.at(-1)?.annotations).toEqual({ readOnlyHint: true })
  await client.close()
})

it('sends list_changed when a tool appears or its schema changes', async () => {
  littlebird = await startFakeLittlebird()
  const { provider } = await signIn(littlebird.url, littlebird.oauth)
  const client = new McpClient({ name: 'juno-test', version: '0.0.0' })
  await client.connect(new StreamableHttpTransport({ url: littlebird.url, authProvider: adaptOAuthProvider(provider) }))
  let changes = 0
  const changed = () => new Promise<void>((resolve) => {
    const stop = client.onNotification('notifications/tools/list_changed', () => {
      changes++
      stop()
      resolve()
    })
  })
  // A change that changes nothing, repeated until the event stream is open.
  const open = changed()
  const repeat = setInterval(() => littlebird!.removeTool('no_such_tool'), 20)
  await open.finally(() => clearInterval(repeat))
  changes = 0

  let next = changed()
  littlebird.addTool(unknownTool('delete_workspace'))
  await next
  expect((await client.listTools()).map((t) => t.name)).toContain('delete_workspace')

  next = changed()
  littlebird.changeSchema('search_context', { type: 'object', properties: { query: { type: 'string' }, since: { type: 'string' } } })
  await next
  const search = (await client.listTools()).find((t) => t.name === 'search_context')
  expect(Object.keys(search!.inputSchema.properties as object)).toEqual(['query', 'since'])
  expect(changes).toBe(2)
  await client.close()
})
