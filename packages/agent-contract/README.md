# @juno/agent-contract

Juno Agent's wire. Schemas, shared card projections from `@juno/agent-cards/presentation`, and the typed `projectCard` bridge to the pure catalogue. No services or I/O.

| Folder | Owner | Holds |
| --- | --- | --- |
| `src/host/` | WP6 (Astra), seeded by WP1 | The AgentHost port: what the host app serves the agent (`AgentHostRpcs`, protocol 2), and the parentPort messages between main and the agent process (`MainToAgent`: `config`, `openRouterKey`, `hostPort`, `rendererPort`; `AgentToMain`) |
| `src/rpc/` | WP6 (Astra) | The RPC groups the agent serves to the renderer, with approval metadata beside the view models |
| `src/chat/` | WP7 (Fable) | The chat as the renderer draws it: items, delivery and ending states, card view models, the page and its banner, the header-menu pages, the recovery review, and the fixed copy |

The agent is the client of `AgentHostRpcs` and the host serves it, over a port main brokers between the two utility processes (ADR 0012). `AGENT_HOST_PROTOCOL` goes up when a change breaks an older agent or host; the agent checks it on `host.hello`.

## The chat contract (`src/chat/`)

View-shaped types for the Juno chat (SPEC "Juno Agent", plan v3 §12 and §13). The containers (WP14) build them from the agent's state; the dumb views (WP12) take them as props and call back with ids. Nothing here knows about pi, the journal or the ledger.

| File | Holds |
| --- | --- |
| `ids.ts` | Branded ids the views hand back: `ChatMessageId`, `OpId`, `CardId`, `ProposedMessageId`, `QuestionOptionId`, `JobId`, `ScheduleId`, `RunId`, `PinId`, `ConnectionId` |
| `place.ts` | `Place` (a Slack place for a context pill), `TopicLink`, `JobRef`, `OpenTarget` (what "Open" opens; a `url` is `https:` anywhere or `http:` on loopback, or a fixed `t3-thread://v1/<id>` link, checked by `isOpenableUrl` at decode time), `JunoPage` |
| `items.ts` | `ChatItem`: one row of the list. `owner` bubbles keyed by `opId` (the archive `id` arrives later), one `juno` row per bubble (`BubbleId`, `<runId>:<n>`), `card` rows, an `ending` row for a run that did not end `complete`, the one `status` bubble (typing dots), `note` lines, `groupLabel` over a proactive group, `day` and `newDivider` separators. Owner and Juno bubbles carry `reactions` (any single `Emoji`, at most one per side) and an optional `replyTo` `Quote`. `Delivery` (sending, sent, waiting, failed) and `Ending` (complete, interrupted, blocked, failed) are the per-message state machines; `Origin` says what started a run. `RemoveSheet` is the owner's local Remove |
| `cards.ts` | `Card`: the catalogue (`sendMessage`, `resolve`, `topics`, `proposedTask`, `task`, `question`, `proposedSchedule`, `schedule`, `connect`, `change`, `remove`, `budget`, `provider`, plus `unknown` for a kind this build lacks). `CardStatus` is the one status machine every kind but `task` shares: open, working, done, dismissed, expired, failed, with the after-line carried as text. A card runs once: no retry, and an action Juno cannot confirm shows as failed. `task` has `JobPhase` instead. `sendMessageStatus` derives a Send card's status from its rows |
| `page.ts` | `ChatPage` (items, `moreAbove` and `moreBelow`, the `Banner` picked by precedence: otherDevice, updateNeeded, recovery, aiOff, paused, offline) and `ChatSummary` (unread count, busy while a job runs, the job line the sidebar and home show) |
| `pages.ts` | The header-menu pages: `ScheduledPage`, `RemembersPage`, `MemoryPage`, `ActivityPage`, `ConnectionsPage` (with the T3 address settings), `ReviewPage` (recovery), `JunoSettingsPage` (with `Ownership`) |
| `commands.ts` | `CardCommand`: what a card button asks for, one union for every card. The views call back with it; `@juno/state/agent` maps it to the card RPCs |
| `files.ts` | Files the owner gives Juno: which types it reads (`junoFileKind`), the limits, `fitImage` (the size an image is scaled to), `imageTokenBound`, `imageSize`, `cutText`, `junoTakes` (what a send takes and why the rest stays), and the wire shapes (`JunoFileInput` on a send, `OwnerFile` on the bubble) |
| `docs.ts` | Juno's notes about the owner (`MemoryDoc`, `MemorySource`, `MemoryEntryRow`, `MemoryChange`, `MemoryDocsPage`) and proactive asks (`ProactiveAsk`, `AskStatus`, `AskAnswer`); the chat's `AskItem` and the `memoryUpdated` note are in `items.ts` |
| `copy.ts`, `shellCopy.ts` | `chatCopy`: every fixed string the chat prints: plan v3 §13.2 states, ending and failure lines, banner chips and lines, card buttons and after-lines, the Remove sheet, the pages. The model never writes any of them. `shellCopy.ts` exports the small subset Home, topic actions and tab titles need without loading the Juno pages |

Rules of the shape:

- Lines the owner reads after an action ("Resolved 3", "Not sent") travel as text in the status. Views print; they never compose outcome copy. Failure and ending lines are fixed copy, so a run that wrote nothing still ends with a line.
- Exclusive states are unions, not booleans: `Banner`, `Delivery`, `Ending`, `CardStatus`, `JobPhase`, `Asker`, `Ownership`.
- A proposal and the thing it becomes are different kinds (`proposedTask` and `task`, `proposedSchedule` and `schedule`), so one card never carries two machines.
- Group position is precomputed per item so a virtualised row renders without its neighbours.
- A `change` card's field preview is rendered from the stored payload by the agent, never by the model.
- `test/chat.test.ts` covers the two rules through the package's public API.

`effect/rpc` may be imported here (`scripts/check-deps.mjs`, the effect skill).

## Must not

- Hold logic. Import Electron or any Slack package.

## Renderer RPCs

`AgentRpcs` merges `ChatRpcs`, `CardRpcs`, `ScheduledRpcs`, `RemembersRpcs`, `MemoryRpcs`, `ActivityRpcs`, `ConnectionsRpcs`, `ReviewRpcs`, `SettingsRpcs`, `DocsRpcs` (`agent.docs.*`: the notes page, the owner's add, edit and delete, and a note's Undo) and `AskRpcs` (`agent.asks.list`, `agent.asks.answer`). Each route is also exported. Live pages use streamed snapshots; chat windows are bounded to 200 rows and can open at latest, unread, around an anchor, above or below it. An anchor (`ChatAnchor`) is any row's own id: an archive message, a bubble, a card, or an owner op before it is stored. `chat.read` takes a bubble or an archive message, so the list can mark read what it has on screen. `ChatPageSnapshot.page` is exactly WP7's `ChatPage`, including `moreAbove` and `moreBelow`.

`chat.send` takes an optional `replyTo` (a Juno bubble or card). `chat.react` sets or removes the owner's reaction on a bubble or card: a thumbs up or a removal is only recorded; any other emoji is queued to Juno like a message. A reaction or a reply is never a click. Every durable mutation carries an `OpId`. `Accepted` means the FULL inbox commit succeeded, not that a run or external action succeeded. Failed delivery retries reuse the same op id. There is no command to stop a run: `chat.send` while Juno is working joins the run at its next step. Stopping a background job is the Task card's command. The local Remove command needs no model run.

Approval identities and source revisions travel beside the view models. A card click binds the card revision/digest and ordered child revision/digests. `prepare` stores choice arguments (for example a question answer) before `approve`; approval never accepts replacement executable arguments. Editing send text creates a new stored proposal. `dismiss` serves every button that only declines (Dismiss, Skip, Keep on Remove, Wait until tomorrow). `askAgain` takes an expired card; the agent writes the owner message that quotes it. The handler must reject stale bindings and already-consumed approvals.

Scheduled and Remembers snapshots also carry revisions, because their WP7 rows do not. Credentials use main's setup flow and never put secret values into the inbox. Model, spend, rule and connection settings, and ownership operations, are renderer-only commands. Sidebar views have the local settings tool described below.

## Host contracts

`AgentHostRpcs` is the whole AgentHost group, protocol 2 (`AGENT_HOST_PROTOCOL`): the hello (`HostHelloRpcs`), `HostReadRpcs`, `HostActionRpcs`, `HostPresenceRpcs`, `HostNotificationRpcs`, `HostScheduleRpcs`, `HostViewRpcs` and `HostSpendRpcs`. Protocol 1, the hello alone, is gone.

Reads cover Slack search/history/replies/people and Juno topics. Presence streams the current account, online and AI state, quiet hours and the current “this” topic. Dispatch carries the exact executable identity, digest and already-consumed authorization/attempt ids, with `mode: single-attempt`. Duplicate submissions of the same authorization must return its stored attempt. A transport loss remains unknown. A negative send lookup cannot prove failure. Notification delivery has an id and respects the notification gate independently of action admission.

## Plan and spec differences found in WP6

All five are settled in plan v3 (§0 rows W9 to W13):

- Proposal names: §6.4 names `proposedTask` and `proposedSchedule`. Steering from a tainted run is a `change` card (W10).
- W9 (warned retries) is replaced by plan v3 O2: a card runs once and has no retry button, an action rejected or unconfirmed shows "Failed", and Quint's `noRepeatAuthorization` replaces `retryRequiresAuthority`.
- The chat shows one result per row and one status per card. The record keeps every attempt and both cancellation states; Activity shows them (W12).
- W11 (Stop's line) no longer applies: the chat has no Stop (decision log, 10-14 11:50).
- Approval identities and edit revisions travel in RPC metadata, not in `src/chat/**` (W13).

Run `pnpm test:agent-contracts` from the root for the property tests and request/response JSON codec round trips for every RPC group. `pnpm typecheck` checks the test sources too.

WP19 adds `agent.schedule.watchReply { opId, channelId, ts, threadTs? }` to
`ScheduledRpcs`. It returns `{ opId, id, at }` after the menu watch is persisted.
The owner click is the authority; the server verifies the message's author and
uses saved notification hours. Undo deletes the returned schedule through
`agent.scheduled.action`, using its current revision from the page.

Reply watches use `host.schedule.check` (cached metadata or a complete Slack
refresh), `host.schedule.hours` (saved notification hours and local timezone),
and `host.schedule.changes` (message-store invalidations). The check includes
the owner's identity and verifies the source author for the menu command.
No message text crosses these routes. Account checks surround refreshes, and
incomplete or limited Slack history fails rather than reporting no reply.


## Sidebar view host routes

`HostViewRpcs` adds `host.views.list`, `create`, `update`, `delete` and `undo`.
Every request carries `accountId`. Create takes `view` (name, optional icon,
conversation ids in `channels`, and `keepOutOfAll`); update also takes `id` and
replaces the whole view. Mutations return `{ id, undo }`. Undo carries the exact
expected state and the previous snapshot, including position. It refuses newer
edits. These are local Juno settings and work with outward Slack writes disabled.
The host validates icons against the app's set. Listing retains every stored
conversation id, even if it has left the Slack cache.

`host.slack.channels` adds a paginated directory read: account, name `pattern`
(case-insensitive glob, `*` and `?`), cursor and limit; channel ids/names and the
next cursor. It returns no messages, topics, descriptions or user profiles.

`host.slack.people` gives the people the owner exchanged messages with in
one-to-one DMs and threads since `since`, most first: id, name, the two counts,
the newest message's time and the DM's id, for person files (SPEC 13.8).
`host.slack.members` looks up workspace members by name. Neither returns message
text.
