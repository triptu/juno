# @juno/agent-cards

The pure card catalogue for plan v3 §12. No UI, I/O, clock, id generation or transport.

## Public API

- `payloadSchemas`, `CardPayload` and the thirteen named `*Payload` schemas define stored proposals. `modelPayloadSchema(kind)` emits TypeBox from the Effect schema. Effect decoding remains authoritative; the application supplies trusted bindings and ids.
- `canonicalPayload`, `decodePayload` and `payloadDigest` encode and identify the complete stored proposal, including its labels. `canonicalJson`, `canonicalIdentity` and `actionDigest` implement the executable identity in §6.2: SHA-256 of UTF-8 RFC 8785 JSON. Keys sort by UTF-16; array order matters; strings are not normalized. Non-finite numbers and lone surrogates are rejected. There are no time, locale or version inputs. These encodings must not change for existing payloads.
- `ExecutableIdentity` binds connection, account, destination ids, tool, schema hash, arguments, preconditions and ordered operations. `ChildAction` adds its global id, revision, tier, destination dedupe capability and source generation, matching Quint’s intent. Tier 4 has no representation. The caller mints ids once (UUIDv7) and persists them before showing a card. A display digest is not an executable approval.
- `expandChildActions` preserves order and ids. Every send row becomes one `slack_send` action (`SLACK_SEND_TOOL`) with `args: { channelId, text, threadTs? }`, exactly the payload `host.outbox.send` accepts; the action id travels beside it and becomes the message's `client_msg_id`. Expansion never mints ids. Other executable cards carry one stored child; links and running jobs carry none. `batchIdentity` returns the ordered child ids, revisions and executable digests to bind to a click.
- `ChildEvidence` keeps every attempt, including an unknown attempt after an older attempt succeeded. `transitionAttempt` preserves receipts and negative-lookup uncertainty. `childOutcome` gives the row a card shows: `sent` once any attempt has a receipt, `sending` while one is unsettled, and `failed` otherwise, including an attempt Juno cannot confirm (plan v3 O2). A card runs once: `transitionCard` takes a click only on an `open` card, matching Quint's `noRepeatAuthorization`. A `failed` card turns `done` on later positive evidence.
- `CardRecord`, `transitionCard`, `transitionJob`, `toCard` provide the state machines and projection. Task records have a job phase and no card status; a recorded `unknown` phase (`JobRecordPhase`) shows as `failed`. Send records validate evidence against the exact child revision and digest. Unconsumed proposals expire after seven days or source invalidation. A Change preview renders the stored arguments; no model-written field preview is accepted.

The package has no workspace dependencies (`allowedDeps: []`). `presentation.ts` owns the shared card and place schemas, exported at `@juno/agent-cards/presentation`. `agent-contract` re-exports them through its chat API using the existing dependency direction. Contract tests round-trip generated cards of every kind.

The dispatcher (WP15) still owns current revision/schema/account/precondition checks, approval consumption, expiry checks before dispatch, grants, idempotent inbox admission and transport. A pure status transition is not permission to perform an action.

## Tests

From the repository root: `bun run test:agent-contracts`. It uses the shared heavy-job queue.

The public-API properties cover canonical round trips and key order, every payload leaf's digest contribution, frozen JCS vectors and a frozen payload digest, independent SHA-256, immutable child expansion, retry selection, evidence preservation and derived status. The contract package checks that every schema and RPC route survives JSON. `bun run typecheck` includes these tests.
