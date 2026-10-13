# @juno/agent-contract

Juno Agent's wire. Schemas only, no logic.

| Folder | Owner | Holds |
| --- | --- | --- |
| `src/host/` | WP6 (Astra), seeded by WP1 | The AgentHost port: what the host app serves the agent (`AgentHostRpcs`, today only `host.hello`), and the parentPort messages between main and the agent process (`MainToAgent`, `AgentToMain`) |
| `src/rpc/` | WP6 (Astra) | The RPC groups the agent serves to the renderer |
| `src/chat/` | WP7 (Fable) | The chat as the renderer draws it: items, delivery and ending states, card view models, the page and its banner, the header-menu pages, and the fixed copy |

The agent is the client of `AgentHostRpcs` and the host serves it, over a port main brokers between the two utility processes (ADR 0012). `AGENT_HOST_PROTOCOL` goes up when a change breaks an older agent or host; the agent checks it on `host.hello`.

## The chat contract (`src/chat/`)

View-shaped types for the Juno chat (SPEC "Juno Agent", plan v3 §12 and §13). The containers (WP14) build them from the agent's state; the dumb views (WP12) take them as props and call back with ids. Nothing here knows about pi, the journal or the ledger.

| File | Holds |
| --- | --- |
| `ids.ts` | Branded ids the views hand back: `ChatMessageId`, `OpId`, `CardId`, `JobId`, `ScheduleId`, `RunId`, `PinId`, `ConnectionId` |
| `place.ts` | `Place` (a Slack place for a context pill), `TopicLink`, `OpenTarget` (what "Open" opens) |
| `items.ts` | `ChatItem`: one row of the list. `owner` and `juno` bubbles with `GroupPosition`, the one `status` bubble, `note` lines, `groupLabel` over a proactive group, `day` and `newDivider` separators. `Delivery` (sending, sent, queued, failed) and `Ending` (complete, stopped, interrupted, blocked) are the per-message state machines; `Origin` says what started a run |
| `cards.ts` | `Card`: the catalogue (`sendMessage`, `resolve`, `topics`, `task`, `question`, `schedule`, `connect`, `change`, `remove`, `budget`, `provider`, plus `unknown` for a kind this build lacks). `CardStatus` is the one status machine every kind shares: open, working, done, dismissed, expired, failed, unknown, with the after-line carried as text |
| `page.ts` | `ChatPage` (items, the exclusive `Banner`: none, paused, aiOff, offline, recovery, otherDevice) and `ChatSummary` (unread count, busy, the job line the sidebar and home show) |
| `pages.ts` | The header-menu pages: `ScheduledPage`, `RemembersPage`, `MemoryPage`, `ActivityPage`, `ConnectionsPage`, `JunoSettingsPage` |
| `copy.ts` | `chatCopy`: the fixed strings of plan v3 §13.2 and the card buttons, so views, fixtures and the e2e driver print the same words |

Rules of the shape:

- Lines the owner reads after an action ("Resolved 3", "Not sent") travel as text in the status. Views print; they never compose outcome copy.
- Exclusive states are unions, not booleans: `Banner`, `Delivery`, `Ending`, `CardStatus`, `JobPhase`.
- Group position is precomputed per item so a virtualised row renders without its neighbours.
- A `change` card's field preview is rendered from the stored payload by the agent, never by the model.

`effect/rpc` may be imported here (`scripts/check-deps.mjs`, the effect skill).

## Must not

- Hold logic. Import Electron or any Slack package.
