// A connection tool with a large argument schema (about 30 KB, nested, with $defs), as PostHog's
// MCP server has: the model loads the whole schema with find_tools, calls the tool with valid
// arguments, the call follows the auto-review, and the ledger counts the schema's tokens. Then the
// same in PostHog's own shape, one `exec` tool that takes a command line (docs/research/posthog-mcp.md):
// its lookups run with no card under Auto, and a write through it still asks.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { fakeProvider, fakeReviewer, json, reply, startFakeMcpServer } from '@juno/agent-testing'
import { createMcpManager, MCP_MIGRATIONS, mcpExecutors, mcpTools, type Credentials, type McpManagerApi } from '../src/mcp'
import { SCHEMA_LIMIT } from '../src/mcp/discovery'
import { createProviderGuard, openTurns } from '../src'
import { dollars } from '../src/spend'
import { SONNET } from './turns-harness'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

const credentials: Credentials = {
  oauth: () => ({ load: () => undefined, save: () => {} }),
  bearer: async () => undefined,
  values: async () => [],
  clear: async () => {},
  openAuthorization: async () => {},
}

/** Long field notes, as real servers write them. */
const note = (field: string) => `${field}. ` + `This field is described at length so the schema is as large as a real one. `.repeat(6)

const OPERATORS = ['exact', 'is_not', 'icontains', 'not_icontains', 'regex', 'not_regex', 'gt', 'gte', 'lt', 'lte', 'is_set', 'is_not_set']

/** A nested schema of about 30 KB: filters, groups, property filters of three kinds, variants and payloads. */
function flagSchema() {
  const property = (type: string) => ({
    type: 'object', description: note(`A ${type} property filter`),
    properties: {
      type: { const: type, description: note('The kind of property') },
      key: { type: 'string', description: note('The property key') },
      value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }], description: note('The value to compare') },
      operator: { enum: OPERATORS, description: note('How to compare') },
    },
    required: ['type', 'key'], additionalProperties: false,
  })
  return {
    type: 'object',
    properties: {
      key: { type: 'string', description: note('The flag key') },
      active: { type: 'boolean', description: note('Whether the flag is on') },
      filters: { $ref: '#/$defs/Filters' },
    },
    required: ['key'], additionalProperties: false,
    $defs: {
      Filters: {
        type: 'object', description: note('Who gets the flag'),
        properties: {
          groups: { type: 'array', items: { $ref: '#/$defs/Group' }, description: note('Release conditions') },
          multivariate: { $ref: '#/$defs/Multivariate' },
          payloads: { type: 'object', additionalProperties: { type: 'string' }, description: note('Payload per variant') },
        },
        additionalProperties: false,
      },
      Group: {
        type: 'object', description: note('One release condition'),
        properties: {
          properties: { type: 'array', items: { anyOf: [{ $ref: '#/$defs/PersonProperty' }, { $ref: '#/$defs/CohortProperty' }, { $ref: '#/$defs/GroupProperty' }] }, description: note('Conditions that all hold') },
          rollout_percentage: { type: 'number', minimum: 0, maximum: 100, description: note('Share of matching users') },
          variant: { type: 'string', description: note('Variant to serve') },
        },
        additionalProperties: false,
      },
      Multivariate: {
        type: 'object', description: note('Variants'),
        properties: { variants: { type: 'array', items: { type: 'object', properties: { key: { type: 'string', description: note('Variant key') }, rollout_percentage: { type: 'number', description: note('Variant share') } }, required: ['key', 'rollout_percentage'] } } },
      },
      PersonProperty: property('person'),
      CohortProperty: property('cohort'),
      GroupProperty: property('group'),
      ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`Unused${i}`, property(`unused${i}`)])),
    },
  }
}

/** PostHog's `exec`: one command string, its reference (about 30 KB) in the field's description. */
const REFERENCE = 'CLI-style command string. help; tools; search <words>; info <tool>; schema <tool> <field>; call <tool> <json>. ' +
  'One command per call. Run info before call, and never guess a schema. '.repeat(420)

function exec() {
  return {
    name: 'exec', description: 'PostHog analytics, dashboards, insights and feature flags. Pass CLI-style commands in `command`.',
    inputSchema: { type: 'object', properties: { command: { type: 'string', description: REFERENCE } }, required: ['command'], additionalProperties: false } as never,
    call: (args: Record<string, unknown>) => {
      const [verb, rest = ''] = String(args.command).split(/ (.*)/s)
      if (verb === 'help') return 'tools, search, info, schema, call'
      // As PostHog's does, `info` summarizes a large schema with a hint per field to drill into.
      if (verb === 'info' && rest === 'update-feature-flag') return JSON.stringify({ name: 'update-feature-flag', fields: { key: 'string', active: 'boolean', filters: { hint: 'schema update-feature-flag filters' } } })
      if (verb === 'call' && rest.startsWith('update-feature-flag ')) return json({ updated: (JSON.parse(rest.slice('update-feature-flag '.length)) as { key: string }).key })
      throw new Error(`Unknown command: ${verb}`)
    },
  }
}

const ARGS = {
  key: 'actions-cards-feed', active: true,
  filters: { groups: [{ properties: [{ type: 'person', key: 'email', value: 'maya@example.com', operator: 'exact' }], rollout_percentage: 100 }] },
}

async function fixture() {
  const schema = flagSchema()
  const server = await startFakeMcpServer({ name: 'posthog', tools: [
    { name: 'update-feature-flag', description: 'Update a feature flag: its release conditions, rollout and variants.', inputSchema: schema as never, call: (args) => json({ updated: args.key }) },
    exec(),
  ] })
  cleanup.push(() => server.close())
  const dir = await mkdtemp(join(tmpdir(), 'juno-large-schema-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const fake = fakeProvider()
  const reviewer = fakeReviewer()
  let manager: McpManagerApi | undefined
  const turns = await openTurns({
    agentDir: dir, model: SONNET, migrations: [MCP_MIGRATIONS],
    provider: (store) => {
      manager = createMcpManager({ store, credentials, defaults: [] })
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
  await m.add('PostHog', server.url)
  const id = m.configs().find((config) => config.label === 'PostHog')!.id
  await m.authorize(id)
  const writes = () => server.calls.filter((call) => call.name === 'update-feature-flag')
  return { schema, server, turns, fake, reviewer, manager: m, id, writes }
}

/** One owner message whose run loads the schema, calls the tool, then says one bubble. */
function script(fake: ReturnType<typeof fakeProvider>, n: number) {
  fake.script([
    reply({ type: 'toolCall', id: `find-${n}`, name: 'find_tools', arguments: { server: 'posthog', tool: 'update-feature-flag' } }),
    reply({ type: 'toolCall', id: `call-${n}`, name: 'call_tool', arguments: { server: 'posthog', tool: 'update-feature-flag', args: ARGS } }),
    reply('<say>Done.</say>'),
  ])
}

const toolResults = (request: { readonly context: { readonly messages: ReadonlyArray<unknown> } } | undefined) =>
  (request?.context.messages ?? []).flatMap((m) => {
    const message = m as { role: string; content: ReadonlyArray<{ type: string; text?: string }> }
    return message.role === 'toolResult' ? [message.content.map((part) => part.text ?? '').join('')] : []
  })

it('loads a 30 KB schema whole, calls the tool with valid arguments, and asks under Auto when the owner only implied it', async () => {
  const { schema, turns, fake, writes } = await fixture()
  const bytes = Buffer.byteLength(JSON.stringify(schema))
  expect(bytes).toBeGreaterThan(28_000)
  expect(bytes).toBeLessThan(SCHEMA_LIMIT)

  script(fake, 1)
  turns.accept({ opId: 'owner-1', kind: 'send', text: 'Turn on the actions-cards-feed flag for maya@example.com.' })
  await turns.idle()

  // The request after find_tools carries the whole schema, byte for byte, with nothing paged.
  const [loaded] = toolResults(fake.requests[1])
  expect(loaded).toBeDefined()
  expect(JSON.parse(loaded!.slice(loaded!.indexOf('\n') + 1))).toMatchObject({ server: 'posthog', tool: 'update-feature-flag', inputSchema: schema })
  expect(loaded).not.toContain('paged')
  expect(loaded).not.toContain('attachment')

  // The call is not a read. The owner did not say "update", so the fake review finds it implied: a card.
  expect(writes()).toHaveLength(0)
  const view = turns.actions.views()[0]
  expect(view?.card).toMatchObject({ _tag: 'change', review: { rule: 'auto', intent: 'implied', risk: 'reversible' } })
  if (!view?.binding) throw new Error('No card')
  turns.actions.approve('click', view.binding.identity, view.binding.children)
  await turns.actions.idle()
  expect(writes()).toEqual([{ name: 'update-feature-flag', args: ARGS }])
})

it('runs with no card when the owner asked for exactly this, and always asks under Always ask', async () => {
  const { turns, fake, manager, id, writes, reviewer } = await fixture()
  script(fake, 1)
  turns.accept({ opId: 'owner-1', kind: 'send', text: 'Update the actions-cards-feed flag: turn it on for maya@example.com.' })
  await turns.idle()
  expect(writes()).toHaveLength(1)
  expect(turns.actions.views()).toHaveLength(0)
  expect(reviewer.requests).toHaveLength(1)

  manager.setTool(id, 'update-feature-flag', { review: 'always' })
  script(fake, 2)
  turns.accept({ opId: 'owner-2', kind: 'send', text: 'Update the actions-cards-feed flag again.' })
  await turns.idle()
  expect(writes()).toHaveLength(1)
  expect(turns.actions.views().at(-1)?.card).toMatchObject({ review: { rule: 'always' } })
})

it('counts the schema in the spend reservation of the request that carries it', async () => {
  const { schema, turns, fake } = await fixture()
  script(fake, 1)
  turns.accept({ opId: 'owner-1', kind: 'send', text: 'Turn on the actions-cards-feed flag for maya@example.com.' })
  await turns.idle()
  const [before, after] = turns.store.db.prepare("SELECT amount FROM spend_reservations WHERE path = 'chat' ORDER BY rowid").all() as Array<{ amount: number }>
  // Sonnet's lowest input rate is $2 a million tokens, and a token is at most a byte under the bound.
  expect(after!.amount - before!.amount).toBeGreaterThanOrEqual(dollars(Buffer.byteLength(JSON.stringify(schema)) * 2 / 1_000_000))
})

it('says in one line when a schema is too large or not one Juno can check, and never sends a cut one', async () => {
  const { server, turns, fake, manager, id } = await fixture()
  server.setTools([
    { name: 'huge', description: 'A tool with a schema past the limit.', inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'x'.repeat(SCHEMA_LIMIT) } } }, call: () => json({}) },
    { name: 'patterned', description: 'A tool whose schema has a pattern.', inputSchema: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-z]+$' } } }, call: () => json({}) },
  ])
  await expect.poll(() => manager.definitions(id).map((tool) => tool.name).toSorted()).toEqual(['huge', 'patterned'])
  fake.script([
    reply({ type: 'toolCall', id: 'huge', name: 'find_tools', arguments: { server: 'posthog', tool: 'huge' } }),
    reply({ type: 'toolCall', id: 'patterned', name: 'find_tools', arguments: { server: 'posthog', tool: 'patterned' } }),
    reply("<say>I can't use these tools.</say>"),
  ])
  turns.accept({ opId: 'owner-1', kind: 'send', text: 'Use the huge tool.' })
  await turns.idle()
  const results = toolResults(fake.requests.at(-1))
  expect(results[0]).toMatch(/^Juno can't use this tool: its description and argument schema are \d+ KB, more than the 48 KB Juno can read\.$/)
  expect(results[1]).toMatch(/^Juno can't use this tool: its argument schema is not one Juno can check/)
  expect(results.join('')).not.toContain('x'.repeat(1000))
})

/** One owner message whose run loads `exec`'s schema, runs `commands` through it in order, then says one bubble. */
function commands(fake: ReturnType<typeof fakeProvider>, n: number, ...list: ReadonlyArray<string>) {
  fake.script([
    reply({ type: 'toolCall', id: `find-${n}`, name: 'find_tools', arguments: { server: 'posthog', tool: 'exec' } }),
    ...list.map((command, i) => reply({ type: 'toolCall', id: `exec-${n}-${i}`, name: 'call_tool', arguments: { server: 'posthog', tool: 'exec', args: { command } } })),
    reply('<say>Done.</say>'),
  ])
}

it("runs a command tool's lookups with no card under Auto, judged by the command, and asks for a write through it", async () => {
  const { server, turns, fake, reviewer } = await fixture()
  const write = `call update-feature-flag ${JSON.stringify(ARGS)}`
  commands(fake, 1, 'help', 'info update-feature-flag', write)
  turns.accept({ opId: 'owner-1', kind: 'send', text: 'Turn on the actions-cards-feed flag for maya@example.com.' })
  await turns.idle()

  // The 30 KB reference reached the model whole.
  expect(toolResults(fake.requests[1])[0]).toContain(REFERENCE)
  // Each call was reviewed on its arguments; the lookups ran, the write did not.
  expect(reviewer.requests.map((request) => JSON.parse(request.state.call.args) as unknown)).toEqual([{ command: 'help' }, { command: 'info update-feature-flag' }, { command: write }])
  expect(server.calls.filter((call) => call.name === 'exec').map((call) => call.args.command)).toEqual(['help', 'info update-feature-flag'])
  const info = toolResults(fake.requests[3]).at(-1)!
  expect(info).toContain('schema update-feature-flag filters')
  // The write shows its card: the owner did not ask to update in so many words.
  const views = turns.actions.views()
  expect(views).toHaveLength(1)
  expect(views[0]?.card).toMatchObject({ _tag: 'change', review: { rule: 'auto', intent: 'implied', risk: 'reversible' } })
  if (!views[0]?.binding) throw new Error('No card')
  turns.actions.approve('click', views[0].binding.identity, views[0].binding.children)
  await turns.actions.idle()
  expect(server.calls.filter((call) => call.name === 'exec').map((call) => call.args.command)).toEqual(['help', 'info update-feature-flag', write])
})

it('keeps a schema an earlier run loaded out of the next run, as one line naming it', async () => {
  const { turns, fake, schema } = await fixture()
  commands(fake, 1, 'help')
  turns.accept({ opId: 'owner-1', kind: 'send', text: 'What can PostHog do?' })
  await turns.idle()
  const before = fake.requests.length
  fake.script([reply('<say>Hello.</say>')])
  turns.accept({ opId: 'owner-2', kind: 'send', text: 'Thanks.' })
  await turns.idle()
  const next = JSON.stringify(fake.requests[before]?.context.messages)
  expect(next).toContain('find_tools: loaded the schema for exec on posthog. Load it again with find_tools before calling it.')
  expect(next).not.toContain(REFERENCE.slice(0, 2000))
  expect(next).not.toContain(JSON.stringify(schema).slice(0, 200))
})
