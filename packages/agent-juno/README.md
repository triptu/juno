# @juno/agent-juno

Juno as the agent's host. It runs inside the engine and serves the whole AgentHost group from `@juno/agent-contract` (`AgentHostRpcs`, protocol 2) to the agent process (ADR 0012).

- `agentHostHandlers({ writes })` is the handler layer. The engine serves it on the ports main brokers (`packages/engine/src/protocol/agentHost.ts`).
- `JunoHost` is what the handlers need from Juno: the signed-in account, the reads, presence, the attempt ledger, one `chat.postMessage` and a Slack lookup. The engine implements it in `packages/engine/src/agent-host/`. This package holds the protocol rules; the engine holds the SQL and the Slack calls.

## What each RPC does

| RPC | Behaviour |
| --- | --- |
| `host.hello` | Answers `{ host: 'juno', protocol: 2 }`. The agent refuses a host on another protocol |
| `host.slack.search`, `history`, `replies`, `person` | Read Juno's local store. Search takes free text plus Slack's `from:` and `in:` (names or ids). Text is as Slack holds it, never cleaned. A request for another account than the signed-in one fails with `stale`; none signed in, `signedOut` |
| `host.topics.list`, `host.topics.get` | Open topics, newest activity first, as `TopicLink`s; one topic with its place, resolved flag and first page of messages |
| `host.presence` | A stream: `online` (the engine is live, catching up or rate-limited), `aiEnabled` (the AI assist pref), `quietHours` and `ownerActive` (outside notification hours, inside active hours, from the notifications settings in prefs that the notifications engine reads; the SPEC defaults when none are stored), `accountId`, and `thisTopic`, the topic last viewed in the app |
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
- Reconcile settles an unknown send as `done` only when Slack holds a message with the send's `client_msg_id`, from the owner, with the recorded text, channel and thread. Slack stores text with `&`, `<` and `>` escaped, so both texts are escaped the same way before they are compared (`slackEscaped`). An `&` that already starts `&amp;`, `&lt;` or `&gt;` is left alone, so a send whose own text holds such an entity may not match and stays unknown. That is safe, since unknown is never retried.
- `user.db` runs at SQLite's default `synchronous = FULL` without `fullfsync`. After a power loss the row may be gone, but the agent's own ledger is at `fullfsync` and classifies the attempt unknown, so it never sends the same authorization again (plan v3 §6.5).

## Must not

- Call a model. The agent decides; the host only reads and writes Juno's data.
- Import Electron or any Slack package. Slack access goes through the engine's `JunoHost`.

Reply watches use `host.schedule.check` (cached metadata or a complete Slack
refresh), `host.schedule.hours` (saved notification hours and local timezone),
and `host.schedule.changes` (message-store invalidations). The check includes
the owner's identity and verifies the source author for the menu command.
No message text crosses these routes. Account checks surround refreshes, and
incomplete or limited Slack history fails rather than reporting no reply.

The sidebar view routes (`host.views.*`) enforce the same account check and
forward to the engine's shared sheet commands. They are local settings, so
`writes: disabled` does not disable them. `host.slack.channels` reads only the
cached channel directory, with a paginated name glob.
