# @juno/agent-cards

The pure card catalogue for plan v3 §12. No UI, I/O, clock, id generation or transport.

## Public API

- `payloadSchemas`, `CardPayload` and the thirteen named `*Payload` schemas define stored proposals. `modelPayloadSchema(kind)` emits TypeBox from the Effect schema. Effect decoding remains authoritative; the application supplies trusted bindings and ids.
- `canonicalPayload`, `decodePayload` and `payloadDigest` encode and identify the complete stored proposal, including its labels. `canonicalJson`, `canonicalIdentity` and `actionDigest` implement the executable identity in §6.2: SHA-256 of UTF-8 RFC 8785 JSON. Keys sort by UTF-16; array order matters; strings are not normalized. Non-finite numbers and lone surrogates are rejected. There are no time, locale or version inputs. These encodings must not change for existing payloads.
- `ExecutableIdentity` binds connection, account, destination ids, tool, schema hash, arguments, preconditions and ordered operations. `ChildAction` adds its global id, revision, tier, destination dedupe capability and source generation, matching Quint’s intent. Tier 4 has no representation. The caller mints ids once (UUIDv7) and persists them before showing a card. A display digest is not an executable approval.
- `expandChildActions` preserves order and ids. Every send row becomes one `slack.send` action; its `client_msg_id` is its action id. Expansion never mints ids. Other executable cards carry one stored child; links and running jobs carry none. `batchIdentity` returns the ordered child ids, revisions and executable digests to bind to a click.
- `ChildEvidence` keeps every attempt, including an unknown attempt after an older attempt succeeded. `transitionAttempt` preserves receipts and negative-lookup uncertainty. `retryChildren` excludes children with receipts; it proposes work but never authorizes it. Every repeated attempt requires a new warned click, matching Quint's `retryRequiresAuthority`.
- `CardRecord`, `transitionCard`, `transitionJob`, `toCard` and `unknownCard` provide the state machines and projection. Task records have a job phase and no card status. Send records validate evidence against the exact child revision and digest. Unconsumed proposals expire after seven days or source invalidation. A Change preview renders the stored arguments; no model-written field preview is accepted.

The package has no workspace dependencies (`allowedDeps: []`). `presentation.ts` defines structural projection schemas with the same brands and shapes as WP7. `agent-contract` checks the return type against its `Card` through `projectCard`, without a reverse dependency. The runtime round-trip property checks the real WP7 send schema and derived status. Changes to either shape must keep this boundary compatible.

The dispatcher (WP15) still owns current revision/schema/account/precondition checks, approval consumption, expiry checks before dispatch, grants, idempotent inbox admission and transport. A pure status transition is not permission to perform an action.

## Tests

From the repository root: `pnpm test:agent-contracts`. It uses the shared heavy-job queue.

The public-API properties cover canonical round trips and key order, every payload leaf's digest contribution, frozen JCS vectors, independent SHA-256 and fresh-process stability, immutable child expansion, retry selection, evidence preservation and derived status. The contract package checks RPC codecs and WP7 projection compatibility. `pnpm typecheck` includes these tests.
