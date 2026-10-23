// Each fault the agent tests inject really happens, seen through the real clients: pi-ai's Models
// API for the scripted model and pi-mcp for the MCP servers. The at-most-once and lost-answer tests
// in packages/agent mean something only if these do.
import { afterEach, expect, it } from 'bun:test'
import type { AssistantMessage, AssistantMessageEvent, Context } from '@earendil-works/pi-ai'
import { McpClient, StreamableHttpTransport } from '@earendil-works/pi-mcp'
import { fakeProvider, lostStream, rateLimited, rejectedKey, serverError, startFakeMcpServer, startFakeNotion, type FakeProvider } from '../src/index'
import { signIn } from './signIn'

const closers: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })

const ask: Context = { messages: [{ role: 'user', content: 'why?', timestamp: 0 }] }
const text = (m: AssistantMessage) => m.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
async function events(fake: FakeProvider) {
  const seen: AssistantMessageEvent[] = []
  for await (const event of fake.models.streamSimple(fake.model('anthropic/claude-sonnet-5.5'), ask)) seen.push(event)
  return seen
}

it('a lost stream ends part way with an error holding exactly the delivered text, and no usage', async () => {
  const answer = 'The launch moved to Tuesday because the review ran late.'
  const fake = fakeProvider()
  fake.script([lostStream(answer, { afterChars: 10 })])
  const seen = await events(fake)
  const last = seen.at(-1)!
  if (last.type !== 'error') throw new Error('expected an error event')
  expect(seen.some((e) => e.type === 'done')).toBe(false)
  const delivered = seen.map((e) => (e.type === 'text_delta' ? e.delta : '')).join('')
  expect(delivered.length).toBeGreaterThan(0)
  expect(delivered.length).toBeLessThan(answer.length)
  expect(text(last.error)).toBe(delivered)
  expect(last.error.usage.totalTokens).toBe(0)
})

it('a 5xx, a rejected key and a rate limit fail before any output, as "<status>: <body>"', async () => {
  const fake = fakeProvider()
  fake.script([serverError(503), rejectedKey(), rateLimited()])
  for (const status of [503, 401, 429]) {
    const seen = await events(fake)
    const only = seen[0]
    if (seen.length !== 1 || only?.type !== 'error') throw new Error(`expected one error event, got ${seen.map((e) => e.type).join(', ')}`)
    expect(only.error.usage.totalTokens).toBe(0)
    const [, code, body] = /^(\d{3}): (.*)$/.exec(only.error.errorMessage ?? '') ?? []
    expect([Number(code), JSON.parse(body!).error.code]).toEqual([status, status])
  }
})

it('a lost MCP call either ran the tool or did not, and the client sees an error both ways', async () => {
  let runs = 0
  const server = await startFakeMcpServer({ tools: [{ name: 'write', call: () => String(++runs) }] })
  closers.push(() => server.close())
  const client = new McpClient({ name: 'juno-test', version: '0.0.0' })
  await client.connect(new StreamableHttpTransport({ url: server.url, openGetStream: false }))
  closers.unshift(() => client.close())
  server.loseNextCall('write')
  await expect(client.callTool('write', {})).rejects.toThrow()
  expect(runs).toBe(1)
  server.loseNextCall('write', { applied: false })
  await expect(client.callTool('write', {})).rejects.toThrow()
  expect(runs).toBe(1)
  expect((await client.callTool('write', {})).content).toEqual([{ type: 'text', text: '2' }])
})

it('a lost Notion write was applied: the call fails, and only a read back shows it', async () => {
  const notion = await startFakeNotion()
  closers.push(() => notion.close())
  const { client } = await signIn(notion.url, notion.oauth)
  closers.unshift(() => client.close())
  const read = async () => {
    const [part] = (await client.callTool('notion-fetch', { id: 'page-roadmap' })).content
    return part?.type === 'text' ? JSON.parse(part.text).content : undefined
  }
  expect(await read()).not.toBe('Q4: ship search.')
  notion.loseNextWrite()
  await expect(client.callTool('notion-update-page', { page_id: 'page-roadmap', command: 'replace_content', content: 'Q4: ship search.' })).rejects.toThrow()
  expect(await read()).toBe('Q4: ship search.')
})
