// The generic fake MCP server against pi-mcp's real client, over HTTP and in memory.
import { afterEach, expect, it } from 'vitest'
import { McpAuthRequiredError, McpClient, StreamableHttpTransport } from '@earendil-works/pi-mcp'
import { startFakeMcpServer, type FakeMcpServer, type FakeTool } from '../src/index'

let server: FakeMcpServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const echo: FakeTool = { name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, call: (args) => `echo:${String(args.text)}` }
const client = () => new McpClient({ name: 'juno-test', version: '0.0.0' })

it('lists and calls tools for a client with the right bearer token', async () => {
  server = await startFakeMcpServer({ tools: [echo], bearer: 'turn-token' })
  const c = client()
  await c.connect(new StreamableHttpTransport({ url: server.url, headers: { authorization: 'Bearer turn-token' }, openGetStream: false }))
  expect((await c.listTools()).map((tool) => tool.name)).toEqual(['echo'])
  expect((await c.callTool('echo', { text: 'ping' })).content).toEqual([{ type: 'text', text: 'echo:ping' }])
  expect(server.calls).toEqual([{ name: 'echo', args: { text: 'ping' } }])
  await c.close()
})

it('refuses a client without the token', async () => {
  server = await startFakeMcpServer({ tools: [echo], bearer: 'turn-token' })
  await expect(client().connect(new StreamableHttpTransport({ url: server.url, openGetStream: false }))).rejects.toBeInstanceOf(McpAuthRequiredError)
  expect(server.rejected()).toBeGreaterThan(0)
})

it('pages tools/list and tells connected clients when the list changes', async () => {
  const tools = ['a', 'b', 'c', 'd', 'e'].map((name): FakeTool => ({ name, call: () => name }))
  server = await startFakeMcpServer({ tools, pageSize: 2 })
  for (const transport of [new StreamableHttpTransport({ url: server.url }), server.connectInMemory()]) {
    const c = client()
    await c.connect(transport)
    expect((await c.listTools()).map((t) => t.name)).toEqual(['a', 'b', 'c', 'd', 'e'])
    // Change the list until the notification arrives: the HTTP event stream opens after connect.
    const changed = new Promise<void>((resolve) => c.onNotification('notifications/tools/list_changed', () => resolve()))
    const repeat = setInterval(() => server!.setTools(tools.slice(0, 1)), 20)
    await changed.finally(() => clearInterval(repeat))
    expect((await c.listTools()).map((t) => t.name)).toEqual(['a'])
    server.setTools(tools)
    await c.close()
  }
})

it('returns a thrown error as an MCP tool error', async () => {
  server = await startFakeMcpServer({ tools: [{ name: 'broken', call: () => { throw new Error('Database is offline.') } }] })
  const c = client()
  await c.connect(server.connectInMemory())
  expect(await c.callTool('broken', {})).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Database is offline.' }] })
  await c.close()
})

it('loses a call: applied runs the tool and loses the answer, not applied never runs it', async () => {
  let runs = 0
  server = await startFakeMcpServer({ tools: [{ name: 'write', call: () => String(++runs) }] })
  const c = client()
  await c.connect(new StreamableHttpTransport({ url: server.url, openGetStream: false }))
  server.loseNextCall('write')
  await expect(c.callTool('write', {})).rejects.toThrow()
  expect(runs).toBe(1)
  server.loseNextCall('write', { applied: false })
  await expect(c.callTool('write', {})).rejects.toThrow()
  expect(runs).toBe(1)
  expect((await c.callTool('write', {})).content).toEqual([{ type: 'text', text: '2' }])
  await c.close()
})
