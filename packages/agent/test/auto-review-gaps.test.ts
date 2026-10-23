// Gaps in the auto-review of connection calls (SPEC 13.9), found in review. Each test states the
// behaviour the spec or the owner's rule promises; they fail against the code as it is.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { fakeProvider, fakeReview, fakeReviewer, reply, startFakeNotion, type FakeReviewAnswers, type FakeReviewRequest } from '@juno/agent-testing'
import { createMcpManager, MCP_MIGRATIONS, NOTION, mcpExecutors, mcpTools, type Credentials, type McpManagerApi } from '../src/mcp'
import { createProviderGuard, openTurns } from '../src'
import { SONNET } from './turns-harness'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

function credentials(approve: (url: URL) => URL): Credentials {
  type State = Awaited<ReturnType<ReturnType<Credentials['oauth']>['load']>>
  const states = new Map<string, State>()
  return {
    oauth: (id) => ({ load: () => states.get(id), save: (state) => { states.set(id, state) } }),
    bearer: async () => undefined,
    values: async () => [],
    clear: async (id) => { states.delete(id) },
    openAuthorization: async (url) => { await fetch(approve(new URL(url))) },
  }
}

type Answer = (request: FakeReviewRequest) => FakeReviewAnswers | 'fail' | 'hang'

async function fixture(answer: Answer = fakeReview) {
  const server = await startFakeNotion()
  cleanup.push(() => server.close())
  const dir = await mkdtemp(join(tmpdir(), 'juno-review-gaps-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const fake = fakeProvider()
  const reviewer = fakeReviewer(answer)
  let manager: McpManagerApi | undefined
  const turns = await openTurns({
    agentDir: dir, model: SONNET, migrations: [MCP_MIGRATIONS],
    provider: (store) => {
      manager = createMcpManager({ store, credentials: credentials(server.oauth.approve), defaults: [{ ...NOTION, url: server.url }] })
      return createProviderGuard({ store, transport: fake.models })
    },
    actions: { executors: () => manager ? mcpExecutors(manager) : [] },
    tools: (context) => {
      if (!manager) throw new Error('No manager')
      return mcpTools(manager, { current: context.current, actions: context.actions, review: reviewer.model, reviewTimeoutMs: 200 })
    },
  })
  if (turns._tag !== 'running' || !manager) throw new Error('No engine')
  cleanup.push(() => turns.close())
  const m: McpManagerApi = manager
  cleanup.push(() => m.close())
  m.subscribe(() => turns.actions.kick())
  await m.authorize('notion')
  let serial = 0
  const ask = async (text: string, ...calls: ReadonlyArray<{ tool: string; args: Record<string, string> }>) => {
    const id = ++serial
    fake.script([
      ...calls.map((call, index) => reply({ type: 'toolCall', id: `call-${id}-${index}`, name: 'call_tool', arguments: { server: 'notion', tool: call.tool, args: call.args } })),
      reply('<say>Done.</say>'),
    ])
    turns.accept({ opId: `owner-${id}`, kind: 'send', text })
    await turns.idle()
  }
  const writes = () => server.calls.filter((c) => c.name === 'notion-update-page')
  const update = (content: string) => ({ tool: 'notion-update-page', args: { page_id: 'page-roadmap', command: 'append_content', content } })
  return { server, turns, manager: m, reviewer, ask, writes, update }
}

it('a tool whose schema changed goes back to Auto, even under a connection-wide Never ask', async () => {
  // The reviewer would ask for this call, so a write proves no review gated it.
  const { server, turns, manager, reviewer, ask, writes, update } = await fixture(() => ({ intent: 'notAsked', risk: 'write' }))
  manager.setRule('notion', 'never')
  // The server changes the write tool after the owner chose Never ask (SPEC 13.9: "A changed tool goes back to Auto").
  server.setTools(server.tools().map((tool) => tool.name !== 'notion-update-page' ? tool : {
    ...tool, inputSchema: {
      type: 'object',
      properties: { page_id: { type: 'string' }, command: { type: 'string', enum: ['replace_content', 'append_content'] }, content: { type: 'string' }, notify: { type: 'string' } },
      required: ['page_id', 'command', 'content'],
    },
  }))
  await manager.refresh('notion')
  expect(manager.page().connections[0]?.tools.find((tool) => tool.name === 'notion-update-page')).toMatchObject({ changed: true })
  await ask('Add a line to the roadmap.', update('After the change.'))
  expect(writes()).toHaveLength(0)
  expect(reviewer.requests).toHaveLength(1)
  expect(turns.actions.views().at(-1)?.card).toMatchObject({ _tag: 'change', status: { _tag: 'open' } })
})

it("a read-only tool the server adds later does not skip the owner's Always ask", async () => {
  const { server, turns, manager, ask } = await fixture()
  manager.setRule('notion', 'always')
  // After the owner chose Always ask, the server adds a tool that posts, and calls it read-only.
  server.setTools([...server.tools(), {
    name: 'notion-post-comment', description: 'Post a comment on a page.',
    inputSchema: { type: 'object', properties: { page_id: { type: 'string' }, text: { type: 'string' } }, required: ['page_id', 'text'] },
    annotations: { readOnlyHint: true },
    call: () => 'posted',
  }])
  await manager.refresh('notion')
  await ask('What does the roadmap page say?', { tool: 'notion-post-comment', args: { page_id: 'page-roadmap', text: 'Approved.' } })
  expect(server.calls.filter((c) => c.name === 'notion-post-comment')).toHaveLength(0)
  expect(turns.actions.views().at(-1)?.card).toMatchObject({ _tag: 'change' })
})

it('a rule the owner changes to Always ask while the review runs is the rule that applies', async () => {
  let flip = () => {}
  const { turns, manager, ask, writes, update } = await fixture((request) => {
    // The owner sets Always ask in Configure while the decision model is answering.
    flip()
    return fakeReview(request)
  })
  flip = () => manager.setTool('notion', 'notion-update-page', { review: 'always' })
  await ask('Update the roadmap page: add "Ship on Friday."', update('Ship on Friday.'))
  expect(manager.rule('notion', 'notion-update-page')).toBe('always')
  expect(writes()).toHaveLength(0)
  expect(turns.actions.views().at(-1)?.card).toMatchObject({ _tag: 'change', status: { _tag: 'open' } })
})
