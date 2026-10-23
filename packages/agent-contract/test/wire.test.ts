// Every value the agent sends over a port survives JSON: generated from its schema, encoded,
// stringified, parsed and decoded back to the same value. The schemas are read from the package's
// exports (each exported schema, each card kind, and the payload, success and error of every
// route), so a new schema or route is covered without editing this file.
import { Arbitrary, Effect, Schema } from 'effect'
import { expect, it } from 'bun:test'
import * as Contract from '@juno/agent-contract'

type Route = { _tag: string; payloadSchema: Schema.Top; successSchema: Schema.Top & { success?: Schema.Top; error?: Schema.Top }; errorSchema: Schema.Top }

const schemas = new Map<Schema.Top, string>()
const add = (name: string, schema: Schema.Top) => { if (!schemas.has(schema) && schema.ast._tag !== 'Never') schemas.set(schema, name) }
Contract.Card.members.forEach((kind, i) => add(`Card member ${i}`, kind))
for (const [name, value] of Object.entries(Contract)) {
  if (Schema.isSchema(value)) add(name, value)
  else if (typeof value === 'function' && 'requests' in value && value.requests instanceof Map) {
    for (const route of (value.requests as Map<string, Route>).values()) {
      // A streaming route carries its chunk and error schemas inside the success schema.
      add(`${route._tag} payload`, route.payloadSchema)
      add(`${route._tag} success`, route.successSchema.success ?? route.successSchema)
      add(`${route._tag} error`, route.successSchema.error ?? route.errorSchema)
    }
  }
}

// Both sides as plain data, since JSON has no -0.
const plain = (value: unknown): unknown => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

it('finds the schemas and routes', () => {
  expect(schemas.size).toBeGreaterThan(200)
  expect([...schemas.values()]).toContain('agent.chat.page success')
})

it.each([...schemas].map(([schema, name]) => [name, schema] as const))('%s survives JSON', (_, schema) => {
  const codec = Schema.toCodecJson(schema as Schema.Codec<unknown, unknown>)
  const result = Effect.runSync(Arbitrary.checkEffect(Arbitrary.schema(schema), (value) => {
    expect(plain(Schema.decodeUnknownSync(codec)(plain(Schema.encodeSync(codec)(value))))).toEqual(plain(value))
    return true
  }, { runs: 30 }))
  // Random strings almost never pass the checks on an emoji or an allowed URL, so those schemas
  // cannot be generated here; chat.test.ts covers what they accept.
  if (result._tag === 'Exhausted') return
  expect(Arbitrary.formatCheckFailure(result)).toBeUndefined()
})
