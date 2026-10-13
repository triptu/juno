// The fake MCP server against pi-mcp's real client, the client Juno's MCP manager uses.
import { afterEach, expect, it } from 'vitest'
import { McpAuthRequiredError, McpClient, StreamableHttpTransport } from '@earendil-works/pi-mcp'
import { startFakeMcpServer, type FakeMcpServer } from '../src/index'

let server: FakeMcpServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const echo = { name: 'echo', inputSchema: { type: 'object' as const, properties: { text: { type: 'string' } } }, call: (args: Record<string, unknown>) => `echo:${String(args.text)}` }

it('lists and calls tools for a client with the right bearer token', async () => {
  server = await startFakeMcpServer({ tools: [echo], bearer: 'turn-token' })
  const client = new McpClient({ name: 'juno-test', version: '0.0.0' })
  await client.connect(new StreamableHttpTransport({ url: server.url, headers: { authorization: 'Bearer turn-token' }, openGetStream: false }))

  expect((await client.listTools()).map((tool) => tool.name)).toEqual(['echo'])
  const called = await client.callTool('echo', { text: 'ping' })
  expect(called.content).toEqual([{ type: 'text', text: 'echo:ping' }])
  expect(server.calls).toEqual([{ name: 'echo', args: { text: 'ping' } }])
  await client.close()
})

it('refuses a client without the token', async () => {
  server = await startFakeMcpServer({ tools: [echo], bearer: 'turn-token' })
  const client = new McpClient({ name: 'juno-test', version: '0.0.0' })
  await expect(client.connect(new StreamableHttpTransport({ url: server.url, openGetStream: false }))).rejects.toBeInstanceOf(McpAuthRequiredError)
  expect(server.rejected()).toBeGreaterThan(0)
})
