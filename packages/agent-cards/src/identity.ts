import { Schema } from 'effect'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export const ActionId = Schema.String.pipe(Schema.brand('ActionId'))
export type ActionId = typeof ActionId.Type
export const AuthorizationId = Schema.String.pipe(Schema.brand('AuthorizationId'))
export const AttemptId = Schema.String.pipe(Schema.brand('AttemptId'))
export const Revision = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand('ActionRevision'))
export const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).pipe(Schema.brand('ActionDigest'))
export type Digest = typeof Digest.Type
export const AccountId = Schema.String.pipe(Schema.brand('AgentAccountId'))
export const DestinationId = Schema.String.pipe(Schema.brand('AgentDestinationId'))
export const ConnectionId = Schema.String.pipe(Schema.brand('ConnectionId'))

/** The executable identity in plan v3 §6.2. Operations are ordered, never a set. */
export const ExecutableIdentity = Schema.Struct({
  connection_id: ConnectionId,
  account_id: AccountId,
  destination_ids: Schema.Array(DestinationId),
  tool: Schema.String,
  schema_hash: Digest,
  args: Schema.Json,
  preconditions: Schema.Json,
  ops: Schema.Array(Schema.Json),
})
export type ExecutableIdentity = typeof ExecutableIdentity.Type
export const SourceGeneration = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('ActionSourceGeneration'))
export const ChildAction = Schema.Struct({
  id: ActionId,
  rev: Revision,
  payload: ExecutableIdentity,
  tier: Schema.Literals([1, 2, 3]),
  deduped: Schema.Boolean,
  source: SourceGeneration,
})
export type ChildAction = typeof ChildAction.Type

/** RFC 8785: UTF-16 key ordering, ECMAScript number/string encoding, no normalization.
 * Reject lone surrogates and non-finite numbers instead of hashing lossy replacements. */
export function canonicalJson(value: Schema.Json): string {
  if (typeof value === 'string') {
    if (/[\uD800-\uDFFF]/u.test(value)) throw new Error('Canonical JSON requires Unicode scalar values')
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON requires finite numbers')
    return JSON.stringify(value)
  }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value).toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, member]) => {
    if (member === undefined) throw new Error('Canonical JSON has no undefined values')
    return `${canonicalJson(key)}:${canonicalJson(member)}`
  }).join(',')}}`
}

export const digestJson = (value: Schema.Json): Digest => Digest.make(bytesToHex(sha256(utf8ToBytes(canonicalJson(value)))))
export const canonicalIdentity = (value: ExecutableIdentity): string =>
  canonicalJson(Schema.encodeSync(ExecutableIdentity, { onExcessProperty: 'error' })(value))
export const actionDigest = (value: ExecutableIdentity): Digest =>
  digestJson(Schema.encodeSync(ExecutableIdentity, { onExcessProperty: 'error' })(value))
