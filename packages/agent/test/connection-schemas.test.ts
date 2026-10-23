// Connection tools with large schemas, as PostHog's MCP server has (docs/research/posthog-mcp.md), on
// the real engine: a 30 KB nested schema reaches the model whole and counts against the cap, a schema
// Juno cannot read or check gets one line, and PostHog's own shape, one `exec` tool that takes a
// command line, runs its lookups with no card while a write through it still asks.
import { afterEach, expect, test } from 'bun:test'
import { json, reply, startFakeMcpServer } from '@juno/agent-testing'
import { SCHEMA_LIMIT } from '../src/mcp/discovery'
import { dollars } from '../src/spend'
import { callTool, callsOf, closeAfter, closeConnections, connections, findTools } from './connections-harness'

afterEach(closeConnections)

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

const exec = {
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

const ARGS = {
  key: 'actions-cards-feed', active: true,
  filters: { groups: [{ properties: [{ type: 'person', key: 'email', value: 'maya@example.com', operator: 'exact' }], rollout_percentage: 100 }] },
}
const FLAG = 'update-feature-flag'
const loadAndCall = [findTools({ server: 'posthog', tool: FLAG }), callTool('posthog', FLAG, ARGS)]

async function posthog() {
  const schema = flagSchema()
  const server = await startFakeMcpServer({ name: 'posthog', tools: [
    { name: FLAG, description: 'Update a feature flag: its release conditions, rollout and variants.', inputSchema: schema as never, call: (args) => json({ updated: args.key }) },
    exec,
  ] })
  closeAfter(server.close)
  const c = await connections({ defaults: [] })
  await c.manager.add('PostHog', server.url)
  const id = c.manager.configs().find((config) => config.label === 'PostHog')!.id
  await c.manager.authorize(id)
  return { c, server, schema, id, writes: () => callsOf(server, FLAG) }
}

test('loads a 30 KB schema whole, then asks under Auto when the owner only implied the call, and runs it when asked exactly', async () => {
  const { c, schema, id, writes } = await posthog()
  const bytes = Buffer.byteLength(JSON.stringify(schema))
  expect(bytes).toBeGreaterThan(28_000)
  expect(bytes).toBeLessThan(SCHEMA_LIMIT)
  await c.ask('Turn on the actions-cards-feed flag for maya@example.com.', ...loadAndCall)
  // The request after find_tools carries the whole schema, byte for byte, with nothing paged.
  const [loaded] = c.results(1)
  expect(JSON.parse(loaded!.slice(loaded!.indexOf('\n') + 1))).toMatchObject({ server: 'posthog', tool: FLAG, inputSchema: schema })
  expect(loaded).not.toMatch(/paged|attachment/)
  // The owner did not say "update": a card, and its click sends the arguments as they were.
  expect(writes()).toHaveLength(0)
  expect(c.turns.actions.views()[0]?.card).toMatchObject({ _tag: 'change', review: { rule: 'auto', intent: 'implied', risk: 'reversible' } })
  await c.click()
  expect(writes().map((call) => call.args)).toEqual([ARGS])

  await c.ask('Update the actions-cards-feed flag: turn it on for maya@example.com.', ...loadAndCall)
  expect(writes()).toHaveLength(2)
  expect(c.turns.actions.views()).toHaveLength(1)
  c.manager.setTool(id, FLAG, { review: 'always' })
  await c.ask('Update the actions-cards-feed flag again.', ...loadAndCall)
  expect(writes()).toHaveLength(2)
  expect(c.turns.actions.views().at(-1)?.card).toMatchObject({ review: { rule: 'always' } })
})

test('counts the schema against the cap in the request that carries it', async () => {
  const { c, schema } = await posthog()
  const reserved: number[] = []
  /** Answers with `content`, noting what the cap holds for the request being answered. */
  const step = (content: Parameters<typeof reply>[0]) => {
    const answer = reply(content)
    if (answer.kind !== 'reply' || typeof answer.answer === 'function') throw new Error('Expected a plain reply')
    const message = answer.answer
    return reply(() => { reserved.push(c.turns.guard.spend.snapshot().reserved); return message })
  }
  c.fake.script([
    step({ type: 'toolCall', id: 'find', name: 'find_tools', arguments: { server: 'posthog', tool: FLAG } }),
    step({ type: 'toolCall', id: 'call', name: 'call_tool', arguments: { server: 'posthog', tool: FLAG, args: ARGS } }),
    step('<say>Done.</say>'),
  ])
  c.turns.accept({ opId: 'owner', kind: 'send', text: 'Turn on the actions-cards-feed flag for maya@example.com.' })
  await c.turns.idle()
  // Sonnet's lowest input rate is $2 a million tokens, and a token is at most a byte under the bound.
  expect(reserved[1]! - reserved[0]!).toBeGreaterThanOrEqual(dollars(Buffer.byteLength(JSON.stringify(schema)) * 2 / 1_000_000))
})

test('says in one line when a schema is too large or not one Juno can check, and never sends a cut one', async () => {
  const { c, server } = await posthog()
  server.setTools([
    { name: 'huge', description: 'A tool with a schema past the limit.', inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'x'.repeat(SCHEMA_LIMIT) } } }, call: () => json({}) },
    { name: 'patterned', description: 'A tool whose schema has a pattern.', inputSchema: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-z]+$' } } }, call: () => json({}) },
  ])
  const id = c.manager.configs().find((config) => config.label === 'PostHog')!.id
  await c.manager.refresh(id)
  await c.ask('Use the huge tool.', findTools({ server: 'posthog', tool: 'huge' }), findTools({ server: 'posthog', tool: 'patterned' }))
  const results = c.results()
  expect(results).toHaveLength(2)
  // A short reason each, with no part of the schema.
  for (const line of results) {
    expect(line).not.toMatch(/inputSchema|\^\[a-z\]|x{10}/)
    expect(Buffer.byteLength(line)).toBeLessThan(300)
  }
})

test("runs a command tool's lookups with no card under Auto, judged by the command, and asks for a write through it", async () => {
  const { c, server } = await posthog()
  const write = `call ${FLAG} ${JSON.stringify(ARGS)}`
  const commands = ['help', `info ${FLAG}`, write]
  await c.ask('Turn on the actions-cards-feed flag for maya@example.com.', findTools({ server: 'posthog', tool: 'exec' }), ...commands.map((command) => callTool('posthog', 'exec', { command })))
  // The 30 KB reference reached the model whole.
  expect(c.results(1)[0]).toContain(REFERENCE)
  // Each call was reviewed on its arguments; the lookups ran, the write did not.
  expect(c.reviewer.requests.map((request) => (JSON.parse(request.state.call.args) as { command: string }).command)).toEqual(commands)
  expect(callsOf(server, 'exec').map((call) => call.args.command)).toEqual(commands.slice(0, 2))
  expect(c.results(3).at(-1)).toContain(`schema ${FLAG} filters`)
  // The write shows its card, named by what it does rather than by `exec`.
  const views = c.turns.actions.views()
  expect(views).toHaveLength(1)
  const card = views[0]?.card
  if (card?._tag !== 'change') throw new Error('No card')
  expect(card).toMatchObject({ review: { rule: 'auto', intent: 'implied', risk: 'reversible' } })
  expect(`${card.title} ${card.verb}`).not.toMatch(/\bexec\b/)
  await c.click()
  expect(callsOf(server, 'exec').map((call) => call.args.command)).toEqual(commands)
})

test('keeps a schema an earlier run loaded out of the next run, as one line naming it', async () => {
  const { c, schema } = await posthog()
  await c.ask('What can PostHog do?', findTools({ server: 'posthog', tool: 'exec' }), callTool('posthog', 'exec', { command: 'help' }))
  const before = c.fake.requests.length
  await c.ask('Thanks.')
  const next = JSON.stringify(c.fake.requests[before]?.context.messages)
  expect(next).toContain('exec on posthog')
  expect(next).not.toContain(REFERENCE.slice(0, 2000))
  expect(next).not.toContain(JSON.stringify(schema).slice(0, 200))
  expect(Buffer.byteLength(next)).toBeLessThan(20_000)
})
