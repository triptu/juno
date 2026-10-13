# Juno Agent: research (Opus)

Written 2026-10-14 for the brief in `../BRIEF.md`. Each finding is marked:

- **Observed**: read in a primary source (package source, official doc, the gist) on 2026-10-14.
- **Inferred**: follows from observed facts, but nobody has tested it.
- **Unknown**: not found. Each one needs a spike or an answer from the owner.

Versions were read from the npm registry on 2026-10-14, and package READMEs from the published tarballs.

## 1. The optmem gist

Source: [gist 91837951…](https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449), "OptChat - HOW TO REPLICATE MY SETUP". It was created on 2026-10-04, with its last revision on 2026-10-08. The document inside is titled "UniiChat: one chat that never ends" and calls the memory part OptMem. (Observed)

### 1.1 The idea in plain words

The chat is the memory. There is one chat that never ends. Every message is stored word for word, forever. A cheap model builds a binary tree of one-line summaries in the background. Each model call sees a fixed-size "view" of that tree, then the new message. If a line is too vague, the model calls `zoom` to open it, all the way down to the original message. (Observed)

### 1.2 Memory model (Observed)

- **Log.** Append-only JSONL. Each message has a permanent dense id `i`, a `kind`, its text, a size and a date. The kinds are `user`, `unii` (the agent), `tool` (the call), `echo` (the result), `work` (a subagent report, "[Name] …") and `note` (imported memories). One process owns the log and holds a lock. Every write is flushed. Lines are never edited or deleted. Model thoughts are not logged. Tool output is clipped to its head and tail, 30,000 characters in total. Other long text is split across several messages and is never cut.
- **Tree.** `node(0,i)` is message `i` in at most 512 bytes. `node(l,i)` merges `node(l-1,2i)` and `node(l-1,2i+1)` into at most 512 bytes and covers messages `i·2^l … i·2^l+2^l-1`. It is written as `id+n`, for example `40+8`. A source that already fits in 512 bytes is its own node, with no model call. Each node is built once and never rebuilt.
- **View.** A list of nodes that covers the whole chat, oldest first, with one line per node: `id+n|text`. It holds no dates and no whole messages, not even the latest one.

### 1.3 Compaction (when and which lines merge) (Observed)

- **Which.** For sibling lines `(l,i)` and `(l,i+1)`, `due = (T - last) / 2^l`, where `last` is the pair's last message. To shrink the view, merge the most due pair whose parent is already built, breaking ties by taking the oldest. With a budget equal to the length of Taelin's rollback list, this makes the same merges as his binary-counter `push` (the author checked t = 0…20,000). Measuring from the pair's first message instead is a named bug.
- **When.** Each message appends one line. When the view passes 128 KB, one batch merges the most due pairs until it is at most 64 KB. So the view is a sawtooth that averages about 96 KB. A merge waits until its parent node is built. The view is saved to `view.json` and is never rebuilt from the log, because a rebuilt view differs from the live one and would invalidate every cache entry.
- **Building nodes.** A compaction is a model call with the same tools and system prompt as a turn, followed by its own smaller view (16 to 32 KB, with the same sawtooth) and a fixed task text. A "ruler" of 512 dashes shows the length limit. A reply that is too long gets a retry in the same conversation that shows the cut point, up to 5 tries, and the shortest line is kept. Up to 8 compactions run at once. A message's node starts once fewer than 8 lines before it are still unbuilt. A merge starts once both halves are built. Ready nodes are kept in queues, and the tree is never scanned for work. The compaction model is Claude Haiku at xhigh effort.

### 1.4 Retrieval (Observed)

- Retrieval has two tools: `zoom(id, n)` opens a line into its two children, and `n = 1` returns the whole message. `zoom("Name")` returns a subagent's own log. `date(id)` returns a message's time.
- The prompt orders the model to find the latest mention of a thing in the view and zoom until it has the whole of it before it acts, guesses or asks. It forbids grep or search over memory. Tool output survives poorly in summaries, so the model is told to restate what it learned in its reply.

### 1.5 Turns, caching and cost (Observed)

- Each user message starts a fresh call: `[tools][system][view][message]`. Nothing carries over between turns except the view. Per-turn state (the date, open devices) goes after the view, never in the system prompt.
- A turn waits until every earlier message is summarized. The gist says this takes seconds.
- Between batches the view only grows at its end, so each turn reads the previous view from the prompt cache. The view goes in blocks of 4 lines, with one cache mark on the last whole block and one at the end of the request. In a 3,000-message replay, turns read 98.6% of their prefix from cache and compactions read 96.2%. Batching costs about 4 times less than merging at every message (21 against 80 line-inputs per message).
- Messages the user sends during a turn are given to the model between tool calls. Subagents run in the background, and their reports come back as `work` messages. The agent never waits or polls for them.
- **Inferred inconsistency:** the gist says compactions reuse the turns' cache for the tools and system prompt. Prompt caches are per model, so with Haiku compacting and a larger model answering, compactions share a cache only with each other. The cost numbers likely assume one model, or compaction-to-compaction reuse only.

### 1.6 Invariants the gist implies (Inferred, written as testable rules)

1. The log is append-only, ids are dense (0…T-1), and there is one writer.
2. Nodes are write-once: a built `(l,i)` never changes.
3. A parent is built only after both of its children.
4. The view is an exact partition of `[0, T)`. Its lines are aligned tree nodes, in order, with no gaps or overlaps.
5. The view only references built nodes. The turn gate ensures every level-0 node before the new message is built.
6. A compaction's view stops at the first unbuilt line and never contains a placeholder or half a message.
7. Between batches, each view is a prefix of the next one. This is the cache property.
8. A batch merges only pairs whose parent is built, in due order, until the view is at most 64 KB or no merge is possible.
9. At most 8 compactions run at once.
10. Zoom is total: every built node with `n > 1` has two built children.
11. Liveness: if compactions eventually succeed, every message is eventually summarized, and the view returns under 128 KB.

### 1.7 One infinite chat in Juno (Inferred)

- SPEC 13 already asks for "one long, single-threaded chat with no new chat". optmem is the model for that chat.
- Juno's chat events map onto the kinds: owner text is `user`, Juno's replies are `juno`, tool calls and results are `tool`/`echo`, subagent and T3 reports are `work`, and scheduled wakes are a new `wake` kind. For You cards and Slack data are fetched through tools. They are not memory.
- A 64 to 128 KB view is roughly 16k to 32k tokens on every turn. Cached, that is cheap on API models. On subscription harnesses (section 3), caching is controlled by the harness.

### 1.8 What formal verification means here (Inferred)

- Quint can model the protocol: append, enqueue, start and finish or fail a compaction, the batch merge, crash and restart (in-flight work lost, built nodes and the saved view kept), and the turn gate. Invariants 1 to 10 become state invariants, and 11 becomes a temporal property under fairness. Small bounds suffice: T up to about 16, a budget in lines rather than bytes, and concurrency 2 to 8.
- The due-order claim (it matches `push` at every step) involves arithmetic over many steps. It belongs in a TypeScript property test run to t = 20,000, as the author did, not in the model checker.
- As with `specs/README.md`, the spec checks the protocol and not the code. An ITF trace replayed against the TypeScript memory module (model-based testing) closes part of that gap.

## 2. pi, current versions

Read from the registry and tarballs on 2026-10-14. All packages are MIT except where noted. The repo pins `@earendil-works/pi-ai@1.1.0` (`packages/ai/package.json`). (Observed)

| Package | Version (published) | What it is |
| --- | --- | --- |
| `@earendil-works/pi-ai` | 1.2.0 (2026-10-12) | Unified LLM API, provider registry, OAuth, cache and session affinity |
| `@earendil-works/pi-durable` | 1.2.0 (2026-10-12) | Durable conversation, task and document runtime. **Marked experimental: "The API changes without notice between releases."** |
| `@earendil-works/pi-mcp` | 1.2.0 | Standalone MCP client: stdio and Streamable HTTP, OAuth |
| `@earendil-works/pi-agent-core` | 1.2.0 | Older in-memory agent loop with a transport abstraction |
| `@earendil-works/chord` | 1.2.0 | Replicated JSON state, objects and hosts over links. pi-durable stores documents with it |
| `@earendil-works/pi-codemode` | 1.2.0 | QuickJS sandbox that calls injected tools |
| `@earendil-works/pi-server`, `pi-client`, `pi-protocol` | 1.1.0 | Experimental server, client and protocol for attaching to remote durable Sessions |
| `@earendil-works/pi-session-backend-sqlite-node` | 0.99.2 | SQLite session backend for `pi-agent-core` |
| `@earendil-works/pi-coding-agent` | 1.2.0 | The pi CLI |

### 2.1 Durability (pi-durable) (Observed)

- A `Harness` opens one storage: memory, Node SQLite (WAL, `synchronous = NORMAL`), JSONL, or a Cloudflare Durable Object's SQLite. All changes go through one line of atomic commits, and nothing is shown before its commit is stored. "One process owns a storage at a time; there is no cross-process locking."
- A conversation is a transcript of immutable entries (`pi.user`, `pi.assistant`, `pi.tool-result`, `pi.system`, `pi.reset`, `pi.compaction`, plus custom kinds). Typed JSON documents are stored with it.
- Work is made of tasks: durable state machines that checkpoint at every step. `pi.generation` owns the `pi.tool` tasks for its calls. After a crash, `harness.resume()` continues pending work. A submission with the same `requestId` is admitted once.
- A tool's intent is committed before `execute()` runs. After a crash, a tool reruns only if it is declared `replay: "safe"`. Otherwise the model gets an `interrupted` result. Partial output is committed every 100 ms by default.
- When a conversation is busy, a new input queues as a follow-up (the default), as a `steer` (placed after the current tool round), as `reject`, or as a `write` (appended at once, with no model call).
- Subagents are task-owned conversations. Foreground ones are aborted with their parent. Background ones (`{ background: true }`) survive the parent's abort. Example 23 shows persistent subagents that report back as follow-up inputs, with request ids that make restarts safe. `taskGraph()` exposes the live task tree.
- Hooks: `beforeRequest` replaces the messages of one request, plus `afterResponse`, `onYield`, `afterTools`, `beforeTool` (block or rewrite a call), `afterTool` and `beforeCompact`.
- Built-in compaction is a summary prefix plus recent entries. It can be turned off with `compaction.enabled: false`. If a provider says the context is too long, the generation compacts and retries once.
- Tools are typed with TypeBox. A tool has three result channels: `output` (for the model), `structuredOutput` (for programs) and `details` (for the UI). `callers` says whether the model, other tools, or both may call it. `deferred` tools are loaded through `tool_search`.
- Each conversation has a persisted UUIDv7 that is sent to pi-ai as `sessionId`, for prompt-cache and session affinity.
- `viewState()`, `watch()` and `watchEvents()` give a UI committed state or agent-style events.

### 2.2 MCP (Observed)

- `pi-mcp` implements MCP protocol 2025-11-25 and accepts servers that negotiate 2025-06-18, 2025-03-26 or 2024-11-05. It supports stdio, Streamable HTTP (sessions, the GET stream, resume with `Last-Event-ID`), progress, cancellation, `roots/list`, and tool-list-change notifications. For OAuth it supports discovery, PKCE, dynamic client registration, a shared token refresh and step-up auth. It does not open a browser or store credentials. You inject an `McpOAuthStateStore`. Not supported: sampling, MCP tasks, legacy HTTP+SSE.
- **pi-durable has no built-in MCP manager.** You wrap MCP tools as durable tools, for example `mcp__github__search` with `callers: ["tools"]`, and optionally put them behind codemode or `tool_search`. So "MCP built in" means a first-party client library plus patterns, not automatic wiring. (Observed)

### 2.3 Providers and auth (Observed)

- pi-ai lists more than 30 providers, including OpenRouter, Anthropic, OpenAI, and any OpenAI-compatible endpoint. Providers that support OAuth: Anthropic (Claude Pro/Max), OpenAI ("Sign in with ChatGPT"), OpenAI Codex (legacy), GitHub Copilot, and OpenRouter (PKCE that mints a key). Credentials go through an injected `CredentialStore`, with refresh done under a lock.
- Cache control: `cacheRetention`. OpenRouter gets `x-session-id`. Anthropic-style marks go "on system prompt, last tool, and last user/assistant text content". `onPayload` is documented for inspecting the request, not for changing it.
- **Unknown:** whether pi-ai can place a cache mark in the middle of a message, which optmem's 4-line view blocks need. This needs a spike, possibly a small provider wrapper.

## 3. Using the owner's Claude Code or Codex subscription

### 3.1 Claude (Observed)

- Anthropic's [Legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) says OAuth is "intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications". Developers building products, including on the Agent SDK, "should use API key authentication". Developers may not "offer Claude.ai login into their own applications", may not "route requests through Free, Pro, or Max plan credentials on behalf of their users", and may not "collect, store, or intermediate Claude.ai credentials or session tokens". The page also says this does not prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription".
- Press coverage dates the enforcement to January and February 2026 ([WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/), [yage.ai](https://yage.ai/share/claude-code-subscription-not-a-developer-credential-en-20260321.html)).
- `@anthropic-ai/claude-agent-sdk` is at 0.3.296 (2026-10-09). Its license is proprietary ("SEE LICENSE IN README.md", under Anthropic's Commercial Terms). It ships the native Claude Code binary as per-platform optional dependencies and exposes `query()`, `tool()` and `createSdkMcpServer()` (in-process MCP tools).
- **Inferred:** pi-ai's Anthropic OAuth provider would collect and store Claude.ai tokens inside Juno, which is the prohibited pattern. Do not use it. The only defensible route to the owner's Claude plan is to run the unmodified `claude` binary, signed in through Anthropic's own flow, for the owner's personal use. Even that is a gray area for an app ("developers … including those using the Agent SDK, should use API key authentication"). The owner has to accept this risk. Anthropic may enforce "without prior notice".

### 3.2 OpenAI / Codex (Observed)

- `@openai/codex-sdk` 0.162.1 (Apache-2.0, 2026-10-13) "wraps the `codex` CLI … spawns the CLI and exchanges JSONL events over stdin/stdout". It has threads, `runStreamed()`, `resumeThread()` (sessions are kept in `~/.codex/sessions`), output schemas, and `env` and `config` overrides. OpenAI's docs now point custom clients to the Codex app-server, which speaks JSON-RPC and handles auth, history, approvals and streamed events. The `codex mcp-server` command was removed ([docs](https://learn.chatgpt.com/docs/codex-sdk)).
- OpenAI announced "Sign in with ChatGPT" for third-party apps at DevDay (2026-09-29). It lets Plus and Pro subscribers spend their plan allowance in partner tools, with per-app caps. T3 is a launch partner. Reports disagree on whether it is a limited preview or open ([The New Stack](https://thenewstack.io/sign-in-with-chatgpt/), [SecurityBrief](https://securitybrief.asia/story/openai-launches-chatgpt-sign-in-for-16-partner-tools)). pi-ai 1.2.0 supports it on its `openai` provider.
- **Unknown:** whether a non-partner app such as Juno can register for Sign in with ChatGPT today, and on what terms.

### 3.3 How a provider would wrap them (Inferred)

- **API-style providers** (OpenRouter, Sign in with ChatGPT through pi-ai) return raw model responses. pi-durable then drives the tool loop, so durability, hooks and permissions all apply.
- **Harness providers** (Claude Code through the Agent SDK, Codex through the SDK or app-server) run their own tool loop and their own system prompt. Juno would give each one a fresh session per turn (optmem's "fresh call"), pass the view and the message as the prompt, turn off the harness's built-in tools, and offer Juno's tools over MCP: in process with `createSdkMcpServer` for Claude, and as a local MCP server configured for Codex. The tool calls still run through Juno's permission hooks. The turn itself is not replay-safe. A crash marks it interrupted. Juno has no control over the harness's cache marks or prompt.

## 4. MCP servers

- **T3 Code.** Observed in this environment: tools for projects, threads (`t3_thread_launch` with a worktree strategy, `t3_thread_read`, `t3_thread_wait` with a timeout, `t3_thread_send`, `t3_thread_interrupt`, fork, search), the queue (`t3_queue_promote_to_steer`), pending approvals (`t3_pending_request_list` and `t3_pending_request_respond`), PR linking and watching, scheduling (`schedule_task` with interval, fixed time or webhook triggers), secrets (`request_secret`) and HTML previews. `delegate_task` and `task_status` say they need "an agent running inside a T3 thread", so they are not for Juno. `t3_thread_launch` documents callers outside a thread: they must pass `projectId`, and the new thread may not get broader modes than "the permission mode an outside agent was approved with". **Unknown:** the transport and auth an outside client like Juno would use. T3 injects the server into agent sessions. Community bridges ([t3code-mcp](https://glama.ai/mcp/servers/ThomasCrund/t3code-mcp), [t3-mcp](https://glama.ai/mcp/servers/wynn-dev/t3-mcp)) go through T3's WebSocket RPC, so no official external endpoint was found.
- **Notion.** Observed: hosted at `https://mcp.notion.com/mcp`, over Streamable HTTP with OAuth 2.0 (authorization code with PKCE and refresh), with an SSE fallback at `/sse` ([Notion docs](https://developers.notion.com/docs/get-started-with-mcp)). Its tools cover search, fetch, creating and updating pages and databases, comments and users. The local `@notionhq/notion-mcp-server` uses a bearer token instead.
- **Littlebird.** Observed: [littlebird.ai/features/mcp](https://littlebird.ai/features/mcp) offers "Littlebird MCP" for memory, meetings and decisions, on a paid plan (the page says Plus in one place and Power in another). **Unknown:** the endpoint, transport, auth and tool list. The owner works at Littlebird and can answer this.
- **Inferred:** with pi-mcp, all three fit one connection manager: stdio or HTTP transport, and none, bearer (secret reference) or OAuth auth.

## 5. Agent-produced UI from JSON

- **json-render** (Vercel Labs, Apache-2.0): `@json-render/core` and `@json-render/react` 0.21.0 (2026-09-18). You define a catalogue of components and actions with **Zod** schemas. The model emits a JSON spec, which is validated (`validateSpec`, `autoFixSpec`) and rendered by your own components. Specs stream as JSONL patches. Actions are named, and the renderer never executes them. It also has an experimental composer that uses a decision model (Jev) to choose among candidate elements. (Observed, from the README and [InfoQ](https://infoq.com/news/2026/03/vercel-json-render))
- **A2UI** (Google): `@a2ui/react` 0.13.0, Apache-2.0. It is a protocol for interoperability between agents, not one app's catalogue. (Observed version. Design summary from secondary sources.)
- **MCP Apps** (`io.modelcontextprotocol/ui`, SEP-1865, `@modelcontextprotocol/ext-apps` 2.0.3): servers ship HTML UIs at `ui://` URIs that run in sandboxed iframes. (Observed version. Details from [the SEP](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp).)
- **Inferred:** Juno's confirm cards are a small, closed set (a message draft, a resolve, a T3 launch, a Notion write, a schedule, a choice). The json-render pattern fits them: a closed catalogue, schema-validated props, named actions the client never runs by itself. The json-render dependency does not fit: it uses Zod, while Juno uses Effect Schema and TypeBox, and Juno does not need open-ended layout trees. MCP Apps would bring in iframes and third-party HTML, which conflicts with the native feel and the CSP. Leave it out of v1.

## 6. Sync for a local-first SQLite agent store

| Option | Fit (Inferred unless marked) |
| --- | --- |
| CRDT database (cr-sqlite) | It merges rows. It cannot give optmem the single total order of messages with dense ids. `@vlcn.io/crsqlite` 0.16.3 has had no npm release since 2024-01 (Observed), so the project looks dormant. |
| ElectricSQL | `@electric-sql/client` 1.5.28 (Observed). It syncs from Postgres, so it needs a hosted Postgres. That is a lot of machinery for one user's single chat. |
| Turso / libSQL embedded replicas | A primary with replicas. It matches a single-writer design but ties Juno to one vendor. |
| Event log plus a relay | This matches optmem's append-only, single-writer log. Other devices read the log, or attach to the owner. |
| Encrypted log through a cloud folder | The simplest option and works offline. It needs an owner lease so two devices never write at once. |
| pi-durable on a Cloudflare Durable Object | Observed: a supported storage. The always-on single owner moves to the cloud, and devices attach as clients (pi-server and pi-client exist but are experimental). Local tools (Slack, notifications) would then have to be served back from the desktop. |

**Recommendation (Inferred):** in v1 there is one owner process on the Mac, and it is the only writer. Back up an encrypted, append-only export of the log and the memory tree, with a lease file that lets ownership move between devices. After v1, move the owner to an always-on host (a Durable Object or a small server). Phones and other apps attach as presentations, and the desktop serves local tools to the agent over a link. Do not use a CRDT: the memory design depends on one writer and one order.

## 7. Proactive work, notifications and acting for the owner

- Juno already has a digest fiber that sleeps until the next local slot and delivers missed slots at the next launch (architecture section 11), and a `Notifier` interface. A self-scheduled wake fits the same shape. (Observed in the repo)
- pi-durable tasks can wait on other tasks. **Unknown:** whether pi-durable has a timer wait. If it does not, a host scheduler submits an input with `requestId = scheduleId:dueAt`, which makes each wake idempotent. (Inferred)
- SPEC 15 says AI must not "send anything without a click" or "create noise to look helpful". SPEC 12 puts proactive suggestions on For you and keeps the chat "a chat only". A proactive wake has to be allowed to end in silence. (Observed, then Inferred)
- Safety (Inferred): MCP results and Slack text are untrusted input, so they cannot grant permission. Any outward effect is a two-step proposal followed by the owner's approval, with the exact payload shown. pi-durable's `beforeTool` hook and its `replay` policy are where this is enforced. MCP tool annotations (`readOnlyHint`, `destructiveHint`) are hints and cannot be trusted. If a tool has no hint, treat it as a write.

## Sources

- optmem gist: https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449 (gist API, read in full)
- pi packages: npm registry and tarball READMEs for `@earendil-works/pi-ai`, `pi-durable`, `pi-mcp`, `pi-agent-core`, `chord`, `pi-server`, `pi-client`, `pi-session-backend-sqlite-node` (all read 2026-10-14). pi-durable spec: https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md
- Anthropic legal and compliance: https://code.claude.com/docs/en/legal-and-compliance
- https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/ ; https://yage.ai/share/claude-code-subscription-not-a-developer-credential-en-20260321.html
- Claude Agent SDK tarball README, 0.3.296
- Codex SDK: tarball README 0.162.1; https://learn.chatgpt.com/docs/codex-sdk
- Sign in with ChatGPT: https://thenewstack.io/sign-in-with-chatgpt/ ; https://securitybrief.asia/story/openai-launches-chatgpt-sign-in-for-16-partner-tools
- Notion MCP: https://developers.notion.com/docs/get-started-with-mcp ; https://docs.openwebui.com/tutorials/integrations/mcp-notion
- Littlebird MCP: https://littlebird.ai/features/mcp
- T3 bridges: https://glama.ai/mcp/servers/ThomasCrund/t3code-mcp ; https://glama.ai/mcp/servers/wynn-dev/t3-mcp
- json-render: `@json-render/core` 0.21.0 README; https://infoq.com/news/2026/03/vercel-json-render
- MCP Apps: https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- cr-sqlite: https://vlcn.io/docs/getting-started ; Electric alternatives: https://electric-sql.com/docs/reference/alternatives
