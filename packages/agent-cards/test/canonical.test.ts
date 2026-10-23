import { createHash } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { Schema } from 'effect'
import { actionDigest, canonicalIdentity, canonicalJson, canonicalPayload, decodePayload, digestJson, ExecutableIdentity, payloadDigest, payloadSchemas, modelPayloadSchema } from '@juno/agent-cards'
import { identity, payloads } from './fixtures'

function reverseKeys(value: Schema.Json): Schema.Json {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(reverseKeys)
  return Object.fromEntries(Object.entries(value).toReversed().map(([key, member]) => [key, reverseKeys(member)]))
}

/** Every leaf, including nested args, preconditions and ordered operations. */
function mutations(value: Schema.Json): Schema.Json[] {
  if (value === null) return [true]
  if (typeof value === 'string') return [`${value}!`]
  if (typeof value === 'boolean') return [!value]
  if (typeof value === 'number') return [value === 0 ? 1 : -value]
  if (Array.isArray(value)) return value.flatMap((member, index) => mutations(member).map((changed) => value.map((v, i) => i === index ? changed : v)))
  return Object.entries(value).flatMap(([key, member]) => mutations(member).map((changed) => ({ ...value, [key]: changed })))
}

describe('canonical payloads and digests', () => {
  it('round-trips every catalogue kind and ignores input key order', () => {
    expect(payloads.map((p) => p._tag).toSorted()).toEqual(Object.keys(payloadSchemas).toSorted())
    fc.assert(fc.property(fc.constantFrom(...payloads), fc.string(), (sample, because) => {
      const payload = { ...sample, because }
      const encoded = canonicalPayload(payload)
      expect(decodePayload(encoded)).toEqual(payload)
      expect(canonicalPayload(decodePayload(canonicalJson(reverseKeys(JSON.parse(encoded)))))).toBe(encoded)
      expect(payloadDigest(payload)).toBe(createHash('sha256').update(encoded).digest('hex'))
      expect(modelPayloadSchema(sample._tag)).toHaveProperty('type', 'object')
      for (const changed of mutations(JSON.parse(encoded))) expect(digestJson(changed)).not.toBe(payloadDigest(payload))
    }), { numRuns: 130 })
  })

  it('binds every executable identity field and preserves operation order', () => {
    fc.assert(fc.property(fc.jsonValue(), (args) => {
      const payload = Schema.decodeUnknownSync(ExecutableIdentity)({ ...identity, args })
      const encoded = canonicalIdentity(payload)
      expect(actionDigest(Schema.decodeUnknownSync(ExecutableIdentity)(reverseKeys(JSON.parse(encoded))))).toBe(actionDigest(payload))
      expect(actionDigest(payload)).toBe(createHash('sha256').update(encoded).digest('hex'))
      for (const changed of mutations(JSON.parse(encoded))) expect(digestJson(changed)).not.toBe(actionDigest(payload))
    }))
    // Frozen JCS encoding: integer-looking keys must not be reordered by object serialization.
    const value = { '2': 2, '10': 10, z: -0, a: '€\n', numbers: [1e30, 0.002, 1e-27] }
    expect(canonicalJson(value)).toBe('{"10":10,"2":2,"a":"€\\n","numbers":[1e+30,0.002,1e-27],"z":0}')
    expect(digestJson({})).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a')
    // Frozen digest of one card payload. Stored cards carry it, so a change makes their clicks stale.
    expect(payloadDigest(payloads.find((p) => p._tag === 'resolve')!)).toBe('5115f585deebf3664cfc12e4ed158cf1a9c86dfeb168edeeff4fd164d4a8d7bf')
    expect(() => canonicalJson('\ud800')).toThrow()
    expect(() => canonicalJson(Infinity)).toThrow()
  })
})
