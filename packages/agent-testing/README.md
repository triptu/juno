# @juno/agent-testing

Test doubles for Juno Agent (plan v3 §16). Imported only by tests (declare it in `juno.testDeps`). Each fake is driven through the same library or protocol the agent uses for the real thing: pi-ai's `Models`, the Codex SDK, pi-mcp's client and OAuth flow, the AgentHost message schema, and a real OS process for crashes.

pi packages and the Codex SDK may be imported anywhere in this package (`check-deps`), because the fakes stand in for them.

`bun run test:agent-testing` runs this package's tests behind the machine-wide lock (`bun test` here runs them directly). The fakes are tested through their consumers in `packages/agent` and the e2e specs. This package tests only what those consumers rely on and cannot see: `test/faults.test.ts` checks that each injected fault really happens (a lost stream, the 5xx, 401 and 429 shapes, a lost MCP call applied or not, a lost Notion write), and `test/crash.test.ts` checks the crash harness and that every crash point names labels in the Quint specs.

## Which fake to use

| You are testing | Use |
| --- | --- |
| A chat run, the guard, spend, a provider failure line | `fakeProvider()` with a script |
| Compaction jobs and node text | `fakeProvider()`; requests to Haiku or Flash go to the compactor |
| The app's agent end to end: the model picker, the OpenRouter key | `startFakeOpenRouter()` over HTTP |
| The auto-review of connection calls, in-process | `fakeReviewer(answer?)`: the agent's `ReviewModel`, by default `fakeReview` |
| A custom OpenAI-compatible endpoint (a local model server) | `startFakeOpenAi()` over HTTP |
| The Codex harness (WP20) | `startFakeCodex()` as `codexPathOverride` |
| MCP manager logic without HTTP | any fake's `connectInMemory()` |
| Connect, sign-in, token expiry, `list_changed`, schema hashes | `startFakeNotion()`, `startFakeLittlebird()`, `startFakeT3()` over HTTP |
| Juno's own loopback MCP server's client, or a one-off server | `startFakeMcpServer()` |
| A desktop e2e spec | `await import('@juno/agent-testing/mcp')`: the MCP fakes alone. pi-mcp has only an ESM entry and Playwright loads specs as CommonJS |
| Taint, the secret filter, Slack reconcile | `hostileMessages`, `forgedSendReceipt()` |
| Cards that send or resolve through the host (WP15) | `fakeActionHost()` |
| Recovery after a kill or power loss (WP8, WP15, WP21, WP22) | `crashAt()`, `snapshotFiles()` |

## Model: `fakeProvider(options?)`

A provider registered as `openrouter` with today's resolved slugs, their real context windows and the spike's prices (`fakeCatalogue`, including both compaction models). `models` is a pi-ai `Models`; `model(slug)` resolves a model.

- `script(steps)` sets the chat responses, one per request. Steps:
  - `reply(content, { usage? })`: text, thinking or tool calls (`fauxToolCall`). With `usage`, the final message reports exactly that, priced with the model's rates; without, pi-ai's faux estimate.
  - `lostStream(content, { afterChars })`: HTTP 200, `start`, some deltas, then an `error` event with `errorMessage: 'terminated'` and zero usage.
  - `serverError(500 | 502 | 503)`, `rejectedKey()` (401), `rateLimited()` (429), `httpError(status, message)`: one `error` event before any `start`, with `errorMessage` `"<status>: <body JSON>"` as pi-ai formats OpenAI-compatible errors.
- Requests to a model in `compactionModels` (default Haiku 5.5 and Gemini 3.8 Flash) never use the script. The compactor answers `Summary of messages a–b: <input>` cut to 512 bytes, from the `<input>` block of `@juno/agent-memory`'s compaction task. `compactor: { oversizedAnswers: n }` makes the first `n` answers too long.
- `requests` lists every request (model, context, options). `pending()` counts unused steps. A chat request with no step left fails with "No more faux responses queued".

## OpenRouter over HTTP: `startFakeOpenRouter(options?)`

For the e2e tests, where the agent runs in its own process with the real OpenRouter provider. Import it from `@juno/agent-testing/openrouter`, which loads nothing else. Give the agent `origin` in place of `https://openrouter.ai` (main does so from `JUNO_FAKE_OPENROUTER_URL` under `JUNO_E2E`).

- `GET /api/v1/models` answers `openRouterCatalogue()`: `fakeCatalogue` in OpenRouter's shape, with names such as "Anthropic: Claude Opus 5.5".
- `POST /api/v1/systemone` is the decision model the auto-review asks (TypeSafe's System One protocol, as OpenRouter serves Jev). It answers with `options.review`, by default `fakeReview`: intent `explicit` when an owner message names the tool's action word (`update` for `notion-update-page`), `implied` for other owner words, `notAsked` with none; risk `delete` or `send` for tools named so, else `reversible`. `reviews` lists what it was asked.
- `POST /api/v1/messages` (Claude, Anthropic Messages) and `POST /api/v1/chat/completions` (the rest) stream `answer`, by default one `<say>` bubble. `answer` may be a function of the request, to answer what was sent. It may return `{ toolCall: { name, arguments } }` instead of text; the request after the call carries the tool's result in `toolResult`. A request to a compaction model gets the compactor's answer instead, as with `fakeProvider()`.
- `key`: a request carrying another key gets 401, as a rejected key does.
- `requests` records each chat request's path, model, key, whether it was a compaction, `input`, the last user message, `memory`, the first (Juno's memory message, with the outline of its notes), and `images`, the image parts its user messages carried (type and size). `inputs()` lists the inputs of the chat requests that were not compactions. `catalogueReads()` counts list reads.
- The catalogue lists every model as reading text and images (`architecture.input_modalities`); a test that needs a text-only model rewrites the list.

## OpenAI-compatible endpoint over HTTP: `startFakeOpenAi(options?)`

An endpoint as Ollama, LM Studio or vLLM serve one, at `baseUrl` (`<origin>/v1`). Import it from `@juno/agent-testing/openai`, which loads nothing else.

- `GET /v1/models` lists `models` by id only, with no prices or window (default `qwen3:8b` and `llama3.3:70b`); `models: null` answers 404, as an endpoint that lists nothing.
- `POST /v1/chat/completions` streams `answer`, by default one `<say>` bubble.
- `key`: a request with another bearer token gets 401. `requests` records each chat request's model and key.

## Codex: `startFakeCodex(options?)`

A `codex` executable that speaks `exec --experimental-json`, `app-server` (`initialize`, `model/list`), `login`, `login status` and `logout`.

- `script(turns)`: each `exec` takes the next turn. A turn has `toolCalls` (made for real over Streamable HTTP to `mcp_servers.<server>.url`, with the token from `bearer_token_env_var`), `reply` (`{{result}}` is the last tool result), `fail`, `delayMs` and `usage` (default 20,000 in and 110 out, as S3 measured).
- Approval mode: with `approval_policy = "never"`, a tool call fails with "MCP tool call requires approval" unless the server sets `default_tools_approval_mode = "approve"` (S3).
- Signed out: sign-in is `$CODEX_HOME/auth.json`, as with the real CLI. `signIn(home?)` and `signOut(home?)` change it. A turn in a signed-out home exits 1 with "Not logged in", which the SDK reports as a thrown error.
- `invocations()` records each run: command, config, model, sandbox, cwd, prompt, home and tool outcomes. `close()` deletes its directory.

## MCP servers

All are a JSON-RPC handler (`initialize`, `ping`, paginated `tools/list`, `tools/call`, `notifications/tools/list_changed`) served over loopback Streamable HTTP and over pi-mcp's in-memory transport (`connectInMemory()`, no auth). HTTP has a GET event stream for `list_changed`. Every fake has `calls`, `rejected()` (401 count) and `close()`.

OAuth servers do discovery, dynamic registration, the authorization code grant with PKCE S256, and refresh with rotation where the real server offers it. GET on the authorization endpoint approves at once and redirects, standing in for the owner, so a built app's OAuth window completes on its own. In-process tests call `oauth.approve(url)` for the callback URL. `oauth.expireAccessTokens()` makes the next request get a 401 with a `WWW-Authenticate: Bearer` challenge. `oauth.revokeRefreshTokens()` makes a refresh fail with `invalid_grant`. Codes are single use.

- `startFakeMcpServer({ tools, bearer?, oauth?, pageSize? })`: the generic server. `setTools()` sends `list_changed`. `loseNextCall(tool, { applied })` closes the connection without an answer, after running the tool or before.
- `startFakeNotion({ pages? })`: OAuth with refresh. `notion-search` and `notion-fetch` read; `notion-create-pages` and `notion-update-page` write. `editElsewhere(id, content)` moves `last_edited_time`, for precondition conflicts. `loseNextWrite({ applied })` loses a write's answer. `pages()` shows the store.
- `startFakeLittlebird({ extraTools?, pageSize? })`: OAuth with the scopes S8 found and refresh. Three tools per page. `addTool`, `removeTool` and `changeSchema` send `list_changed`; Its reads mark themselves read-only and its writes include `delete_material`. `unknownTool()` is a tool on no read list that claims to be read-only. The tool names are invented (S8 did not see the list).
- `startFakeT3({ loopback?, lan?, lanHost?, omitTools? })`: the real T3 tool names and argument names. OAuth as S8 found it: `/oauth/mcp/*`, scopes `orchestration:read orchestration:operate`, no refresh, and a 401 `invalid_mcp_credential` that needs a new sign-in. It serves `loopbackUrl` and `lanUrl` on one port. When `lanHost` is not this machine's address (the default 192.168.1.22), pass `fetch` to pi-mcp; it routes the LAN origin to the fake, and pi-mcp still refuses the code exchange over plain http as it does for real. Threads are scripted with `advance(threadId, { status, reply })` and `ask(threadId, prompt)`, answered through `t3_pending_request_respond` and listed by `answers()`. `t3_thread_wait` really waits until a terminal status or its timeout.

## Hostile Slack fixtures

`hostileMessages` is a list of `{ name, why, message }`, each message a `HostMessage` decoded through the AgentHost contract. They cover injections, fake system tags, fake approvals, impersonation of Juno, a schedule request, a secret in a brief (`FAKE_SECRET`, shaped like an OpenRouter key), a misleading link, hidden control characters, a lone surrogate, content shaped like a tool call, a message over 30,000 characters and a hostile thread reply. `hostile(name)` gets one, `hostilePage()` returns all as one history page, `forgedSendReceipt(actionId)` is someone else's message with Juno's `client_msg_id`, and `hostilePerson` copies Juno's name. All content is invented.

## Host actions: `fakeActionHost(options?)`

The host's action RPCs as the agent's `ActionHost` takes them (`openTurns({ actions: { host } })`), with Slack behind them scripted. It keeps the host's single-attempt rules: a send is recorded by its authorization before Slack sees it, a repeat is answered from the record, and a refusal before recording (writes off) is an `AgentHostError`. `next(...outcomes)` scripts the next sends: `done`, `failed` (Slack refuses), `unknown` (Slack took it, the answer was lost), `lostBefore` (lost, and Slack never got it), `refused` and `dropped` (the RPC fails after Slack took it). `topic(id)` answers any `m:<channel>` or `t:<channel>:<ts>` with an invented place. `calls`, `messages()` and `resolved()` show what happened; `plant(message)` adds someone else's message; `onSend(listener)` runs after each send Slack saw; `signOut()` and `signIn()`. With `file`, the record and Slack persist across agent processes, for the crash tests.

## Crash harness

`CRASH_POINTS` names each point after the two spec transitions it sits between (the `label` the Quint state carries), with the spec scenarios to replay and what recovery must do:

| Point | Spec | After | Before | Scenarios |
| --- | --- | --- | --- | --- |
| `inbox.committed` | recovery | `inbox` | `ack` | `inboxPowerLoss` |
| `bridge.reset` | recovery | `reset` | `submit` | `bridgeReplay` |
| `bridge.submitted` | recovery | `submit` | `submitted` | `bridgeReplay`, `journalAheadStep` |
| `approval.committed` | actions | `click` | `authorize` | `approvedDrain` |
| `authorization.consumed` | actions | `authorize` | `send` | `startupAttempt`, recovery `authorityCrash` |
| `attempt.beforeReceipt` | actions | `accept` | `receipt` | `negativeLookup`, `unknownRetry` |
| `rotation.drained` | recovery | `project` | `rotate` | `rotationIdentity` |
| `rotation.committed` | recovery | `rotate` | `resume` | `rotationIdentity` |
| `backup.segmentWritten` | recovery | `encrypt` | `manifest` | `nonceAfterCrash`, `manifestBeforeSegment` |
| `backup.manifestRenamed` | recovery | `manifest` | `export` | `exportCrash` |

The contract with the agent: at each point, the agent checks `JUNO_AGENT_CRASH_AT` (`point` or `point:n` for the nth hit) and, if it names this point, kills itself with SIGKILL. The points and `crashPoint(point)` belong to the agent (`@juno/agent/crash`, in `packages/agent/src/runtime/crash.ts`); this package re-exports them for test programs.

- `runAgent({ args, env?, crashAt? })` runs a program and returns its exit, signal and output. `crashAt(point, options)` also requires the SIGKILL, and otherwise fails with the spec transition the point stands for. Under Bun, a `.ts` program is bundled once per test process (into `juno-cache/agent-programs` in the system temp folder) and each run starts the bundle, which cuts a start from about 0.5–0.9 s to about a third.
- `snapshotFiles(dir)` copies the agent directory. Taken right after a crash at a point, it is the state at that commit boundary. `restore(only?)` puts it back over a later state and deletes matching files written since: power loss, or with `journalFiles` a journal restored behind the archive (spec `rollback`). `agentDatabaseFiles` selects `agent.sqlite` and its siblings.

## Must not

- Be imported by any `src`.
- Import Electron or any Slack package.
