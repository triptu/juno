# @juno/agent-juno

Juno as the agent's host. It runs inside the engine and serves the whole AgentHost group from `@juno/agent-contract` (`AgentHostFullRpcs`, protocol 2) to the agent process (ADR 0012).

- `agentHostHandlers({ writes })` is the handler layer. The engine serves it on the ports main brokers (`packages/engine/src/protocol/agentHost.ts`).
- `JunoHost` is what the handlers need from Juno: the signed-in account, the reads, presence, the attempt ledger, one `chat.postMessage` and a Slack lookup. The engine implements it in `packages/engine/src/agent-host/`. This package holds the protocol rules; the engine holds the SQL and the Slack calls.

## What each RPC does

| RPC | Behaviour |
| --- | --- |
| `host.hello` | Answers `{ host: 'juno', protocol }` with the protocol the agent asked for when it is 1 or 2, so an agent on protocol 1 keeps working |
| `host.slack.search`, `history`, `replies`, `person` | Read Juno's local store. Search takes free text plus Slack's `from:` and `in:` (names or ids). Text is as Slack holds it, never cleaned. A request for another account than the signed-in one fails with `stale`; none signed in, `signedOut` |
| `host.topics.list`, `host.topics.get` | Open topics, newest activity first, as `TopicLink`s; one topic with its place, resolved flag and first page of messages |
| `host.presence` | A stream: `online` (the engine is live, catching up or rate-limited), `aiEnabled` (the AI assist pref), `quietHours` and `ownerActive` (outside notification hours, inside active hours; the SPEC defaults until Juno stores the hours), `accountId`, and `thisTopic`, the topic last viewed in the app |
| `host.outbox.send` | A single-attempt Slack send (below). Fails with `unsupported` while writes are disabled, which they are in the app until M3 |
| `host.outbox.cancel` | Before any send: records the authorization as cancelled, and a later send fails with reason `cancelled`. In flight: `cancel-requested`. Settled: the recorded result |
| `host.outbox.reconcileSend` | Asks Slack for the send. `found` only on positive evidence; otherwise `unknown` |
| `host.topics.resolve` | `unsupported`: Juno has no resolve command yet (M3) |
| `host.notification.deliver` | `unsupported`: Juno has no OS notifier yet (M10) |

## Single-attempt sends

A send's payload is an `ExecutableIdentity` with `tool: 'slack_send'`, `args: { channelId, text, threadTs? }`, `destination_ids: [channelId]` and the signed-in `account_id`. Anything else fails with `rejected`. The action id is the message's `client_msg_id`.

- The attempt is written to `agent_attempts` in `user.db` before the Slack call. A repeat of the same authorization is answered from that row and never calls Slack again: while the first call runs, the repeat waits for it; after it, it gets the recorded result.
- The call runs in the handler layer's scope, so an agent that dies mid-send does not interrupt it. The restarted agent sends the same authorization and gets the result.
- The Slack call is `Outbox.sendOnce`: one exchange, no retry. A posted answer is `done` with `{ channelId, ts }`. A refusal (signed out, rate limited, or a Slack error such as `not_in_channel`) is `failed`. No answer is `unknown`.
- A row an engine left `submitted` when it stopped is `unknown`.
- Reconcile settles an unknown send as `done` only when Slack holds a message with the send's `client_msg_id`, from the owner, with the recorded text, channel and thread. Slack escapes `<`, `>` and `&`, so a send with those characters never matches and stays unknown. That is safe, since unknown is never retried.
- `user.db` runs at SQLite's default `synchronous = FULL` without `fullfsync`. After a power loss the row may be gone, but the agent's own ledger is at `fullfsync` and classifies the attempt unknown, so it never sends the same authorization again (plan v3 §6.5).

## Must not

- Call a model. The agent decides; the host only reads and writes Juno's data.
- Import Electron or any Slack package. Slack access goes through the engine's `JunoHost`.

## For WP13b

The host serves protocol 2 now. The agent's client (`packages/agent/src/host/client.ts`) is still a client of `AgentHostRpcs` and asks for protocol 1. WP13b switches it to `AgentHostFullRpcs` and `AGENT_HOST_FULL_PROTOCOL`, and binds `HostReads` (`packages/agent/src/router/host-tools.ts`) to the reads with the `accountId` from `host.presence`.
