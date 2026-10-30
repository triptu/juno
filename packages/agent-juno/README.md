# @juno/agent-juno

Juno as the agent's host. It runs inside the engine and serves the whole AgentHost group from `@juno/agent-contract` (`AgentHostRpcs`, protocol 2) to the agent process (ADR 0012).

- `agentHostHandlers({ writes })` is the handler layer. The engine serves it on the ports main brokers (`packages/engine/src/protocol/agentHost.ts`).
- `JunoHost` is what the handlers need from Juno: the signed-in account, the reads, presence, the attempt ledger with the owner's clicks and the queued post, and a Slack lookup. The engine implements it in `packages/engine/src/agent-host/`. This package holds the protocol rules; the engine holds the SQL and the Slack calls.

## What each RPC does

| RPC | Behaviour |
| --- | --- |
| `host.hello` | Answers `{ host: 'juno', protocol: 2 }`. The agent refuses a host on another protocol |
| `host.slack.search` | Searches local messages and topic titles plus one Slack page, with the Search tab's operators, name resolution, time zone and hiding defaults. Includes snippets, topic links, notes on unsupported operators or Slack failure, and a cursor. Options include apps, automated conversations and newest/oldest order. Account checks reject stale or signed-out reads |
| `host.slack.history`, `replies`, `person` | Read Juno's local store. Message text is as Slack holds it. Account checks reject stale or signed-out reads |
| `host.topics.list`, `host.topics.get` | Open topics, newest activity first, as `TopicLink`s; one topic with its place, resolved flag and first page of messages |
| `host.presence` | A stream: `online` (the engine is live, catching up or rate-limited; also before Slack sign-in, which is not a network outage), `aiEnabled` (the AI assist pref), `quietHours` and `ownerActive` (outside notification hours, inside active hours while Set me away outside active hours is on, from the notifications settings in prefs that the notifications engine reads; the SPEC defaults when none are stored), `accountId`, and `thisTopic`, the topic last viewed in the app |
| `host.outbox.send` | A Slack send through the composer's outbox, only on the owner's click (below). Fails with `unsupported` while writes are disabled, the default for embedders such as the live scripts. The desktop app enables them |
| `host.outbox.cancel` | Before any send: records the authorization as cancelled, and a later send fails with reason `cancelled`. Queued: `cancel-requested`. Settled: the recorded result |
| `host.outbox.reconcileSend` | Asks Slack for the send. `found` only on positive evidence; otherwise `unknown` |
| `host.outbox.states` | A stream: each send of the last 30 days (200 at most) as its outbox row has it now (`sending`, `done` with the receipt, `failed` with Slack's code or `discarded`, `unknown`), again whenever a row or a message in those channels changes. A send the outbox posts after the host settled it (the owner's Retry in the topic) is recorded `done` too |
| `host.topics.resolve` | Tier 3 approved local resolve, only on the owner's click as a send is, through the user's topic command. One transaction stores the batch and its Undo; repeated dispatch returns the original result, even after Undo |
| `host.topics.undoResolve` | Restores the recorded topic overlays and unread state once, for the signed-in account |
| `host.notification.deliver` | `unsupported`: Juno has no OS notifier for the agent yet |
| `host.spend.asks` | A stream: the engine's open spend asks (reserve an amount, or settle a reservation with its reported cost or unknown), then every change. Amounts are nanodollars on the agent ledger's `engine` path. No key and no model input |
| `host.spend.answer` | The agent's answer to one ask: `reserved` or `blocked`, or `settled`; the host stops offering it |
| `host.spend.room` | The agent's ledger may have room again: the cap went up, the owner allowed another dollar, or a release followed a refusal. The host wakes the engine's background AI jobs |

## Sends through the outbox

A send's payload is an `ExecutableIdentity` with `tool: 'slack_send'`, `args: { channelId, text, threadTs? }`, `destination_ids: [channelId]` and the signed-in `account_id`. Anything else fails with `rejected`. The action id is the message's `client_msg_id`.

- **Only on the owner's click** (decision of 10-18). The payload must hash to the dispatch's `digest` (`actionDigest`), and the engine must hold an unused click on that action and digest, which the renderer records (`agentWrites.approve`) before it tells the agent. The first authorization takes the click; a replay under new ids, a second authorization or another revision of the action fails with `rejected`. Nothing is recorded or queued then. Resolve takes the click the same way.
- **The composer's outbox.** In one transaction the host takes the click, writes the attempt to `agent_attempts` in `user.db` and queues the post as the composer does (`engine/src/postQueue.ts`: the text as one `rich_text` block and its mrkdwn fallback). `PostWorker` then sends it with the composer's rules: it shows in the topic at once, waits out a lost connection, is posted at most once (a lost answer is settled by a lookup for its `client_msg_id`, specs/outbox.qnt), and a refusal stays in the topic as "Not sent." with Retry and Delete draft.
- The host follows the queued post to its end (`JunoHost.posted`): Slack has it from the owner is `done` with `{ channelId, ts }`; Slack refused it is `failed` with Slack's code; the owner deleted the draft is `failed` with `discarded`; a message with its id from someone else, or a workspace that closed meanwhile, is `unknown`.
- A repeat of the same authorization is answered from the record and never queued again: while the post waits, the repeat waits with it; after it, it gets the recorded result. The wait runs in the handler layer's scope, so an agent that dies mid-send does not interrupt it, and a row an engine left `submitted` when it stopped is followed again on the next request.
- Cancel before the send records the authorization as cancelled, and a later send fails with `cancelled`. Once queued, a post cannot be taken back: cancel answers `cancel-requested`.
- Reconcile follows a post still waiting, then settles an unknown send as `done` only when Slack holds a message with the send's `client_msg_id`, from the owner, with the recorded text, channel and thread. Slack stores text with `&`, `<` and `>` escaped, so both texts are escaped the same way before they are compared (`slackEscaped`). An `&` that already starts `&amp;`, `&lt;` or `&gt;` is left alone, so a send whose own text holds such an entity may not match and stays unknown. That is safe, since unknown is never retried.
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
cached channel directory, with a paginated name glob. `host.slack.people` and
`host.slack.members` are optional on `JunoHost` (`unsupported` without them):
counts and names from the store, never message text.

Resolve is local to Juno, available with Slack writes disabled. Its mark-read step uses the same read-mirroring preference as the user command. It never unfollows or posts a Slack message.
