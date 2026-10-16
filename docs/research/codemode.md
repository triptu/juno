# Codemode for the Juno Agent

Research on 2026-10-16, against Juno `4bfb02d` on `codemode-research`. No live accounts, messages, credentials or model requests were used. **Observed** means read in source or measured with Juno's fake servers. **Inferred** means a proposed integration, not verified behaviour. **Unknown** means it still needs a spike.

## Recommendation

Adopt codemode for **read-only calls only**, behind a flag and after the checks below. Keep actions as ordinary Juno tools. Codemode's useful addition is filtering and combining reads before their results enter model context. Juno already defers external schemas, so schema savings alone do not justify replacing its tool path. First narrow `find_tools`, which has cheaper, independent improvements.

This is a recommendation, not an implementation. The owner's requirement for the work on `auto-review-1` is that every non-read call receives auto-review, the model can still request a click, untrusted content cannot authorize, and failed or unknown outward calls never retry automatically. That branch's eventual implementation was not verified here. The base code still describes outward calls as Change cards requiring a click.

## Today: what the model sees

**Observed.** [The router](../../packages/agent/src/router/open.ts) registers fixed Juno tools through pi-durable. Depending on the supplied services, those include memory, jobs, Slack reads, action proposals, schedules, views, removal, MCP discovery and T3 adapters. [The request builder](../../packages/agent/src/request/builder.ts) counts their declarations on each request. They are not all external MCP schemas.

[The MCP adapter](../../packages/agent/src/mcp/tools.ts) exposes two fixed tools:

- `find_tools({})` returns the Connections page.
- `find_tools({server})` returns every present, non-denied tool definition for that server. Littlebird has a smaller wrapper containing name, schema hash, definition and access.
- `call_tool({server, tool, args})` validates and calls a reviewed Read tool, or proposes a stored Change card for an Outward tool. It does not turn discovered schemas into separate model tool declarations.

Both wrappers taint the run before execution, including discovery. Server annotations do not grant Read access. Changed schemas lose their read tier. The manager checks secrets, destructive operations, schema hashes and connection identity again at dispatch. See [MCP README](../../packages/agent/src/mcp/README.md), [catalogue](../../packages/agent/src/mcp/catalogue.ts), [manager](../../packages/agent/src/mcp/manager.ts) and [router hook](../../packages/agent/src/router/router.ts).

### Measured context cost

**Observed.** Loopback HTTP discovery used `startFakeNotion`, `startFakeLittlebird` and `startFakeT3`, their real OAuth/client path, and `mcpTools`. Defaults contained all three connections and all were ready. The fake catalogues have 5, 8 and 13 tools respectively. Notion schemas are simplified; Littlebird names are invented. These are fixture measurements, not estimates of hosted catalogues.

| Material | UTF-8 bytes | `o200k_base` tokens |
| --- | ---: | ---: |
| `find_tools` declaration | 461 | 92 |
| `call_tool` declaration | 457 | 99 |
| Both declarations together | 918 | 191 |
| `find_tools({})` result | 4,320 | 1,687 |
| `find_tools({server: "notion"})` result | 1,908 | 572 |
| `find_tools({server: "littlebird"})` result | 2,364 | 722 |
| `find_tools({server: "t3"})` result | 5,870 | 1,811 |
| Minimal turn engine's six declarations, including both wrappers | 3,488 | 784 |
| Six Slack read declarations, additional when host supports channel lookup | 1,729 | 367 |

Declaration bytes use `declaration(registration)`, compact JSON of name, description and parameters. Result bytes include the untrusted-data prefix. Token counts use `tiktoken` 0.14.0 with `o200k_base` on these exact strings. This is a reproducible tokenizer comparison, **not the tokenizer of every Juno model**. Hashes, epochs and ephemeral addresses can change discovery counts between runs. Juno's actual admission rule is more conservative: UTF-8 bytes plus 64 per counted string, with a provider multiplier of 1 or 1.25. Thus the wrappers contribute 1,046 admission tokens at multiplier 1, before system text, other tools, messages and reserve. See [upper](../../packages/agent-memory/src/request.ts) and [provider guard](../../packages/agent/src/providers/guard.ts). Provider framing and cached-token billing differ. No actual billed token count was measured.

A scripted fake-provider run asked for Notion discovery, then answered. Both requests contained the same six declarations: `remember`, `schedule_create`, `schedule_change`, `remove_messages`, `find_tools`, `call_tool`. The second request contained the 1,908-byte discovery result. This confirms that discovery adds schemas to history rather than loading native tool declarations. It costs another model round when discovery and execution are separate responses. Declarations remain in effective context even when pi records them as a system delta only once.

### Is this progressive disclosure?

**Observed.** Yes, at server granularity: external schemas are absent until requested. It leaks context in these places:

1. No-argument discovery is not just connection ids. `manager.page()` includes all tool names, tiers, hashes, hints and allowlist flags, plus connection addresses. Its 4,320 bytes in this fixture exceed Notion's full catalogue.
2. Server discovery returns every schema, including outward tools unrelated to the task. There is no query, single-tool lookup or model-facing pagination. Transport pagination does not solve that.
3. Definitions carry bookkeeping alongside schemas. Repeated discoveries repeat that text in active history. Results survive subsequent requests until paging or compaction removes them.
4. Results above 20,000 bytes become attachment notices before the next request, through [pageMcpResult](../../packages/agent/src/mcp/results.ts). That bounds context but can hide the entire catalogue the model needs. Ordinary active-result paging also applies under the request budget. Neither is selective schema retrieval.

**Inferred.** Return a short connection index first, search names and short descriptions next, and fetch one exact schema last. Keep all discovery untrusted. This improves progressive disclosure without adding execution of model-written code.

## What pi codemode actually does

There are three layers: pi-ai transports model requests; pi-codemode runs scripts; pi-durable and pi-coding-agent each integrate the sandbox with their own tool runtime. Juno uses pi-durable, not the CLI's session manager. The [SDK guide](https://pi.dev/docs/latest/sdk) explains the separate coding-agent extensions. Juno's pinned pi-durable **1.2.0 already exports `./codemode`**. Its installed declarations and implementation were inspected, rather than assuming the latest CLI settings apply to Juno.

**Observed in documentation.** [The codemode guide](https://pi.dev/docs/latest/codemode) describes async JavaScript, parallel calls and filtered output. Only emitted or returned output reaches the model. Scripts can discover deferred tools and inspect individual declarations. Default inline declarations have a 3,000 estimated-token budget. In the CLI's default `on` mode, other declared tools remain declared; enabling codemode alone does not remove their context cost. The CLI also has `only` mode.

**Observed in the pinned package.** [pi-codemode](https://github.com/earendil-works/pi/blob/d05a73fb31ea1c55c861115306df8f358a120de1/packages/codemode/README.md) uses QuickJS compiled to WASM. On Node, a fresh worker thread hosts each execution and relays JSON tool calls to the host thread. For Juno this would run locally inside the agent utility process, not on OpenRouter or inside the Codex process. The VM has no Node APIs, filesystem, network or timers. Its authority is the host functions it receives. A tool with network or filesystem access still provides that access. A worker and WASM heap are not an OS process sandbox against a runtime vulnerability.

The public guide's CLI limits include a 256 MB VM heap and two live workers per process. The reusable sandbox accepts explicit memory, deadline and worker configuration; do not assume all CLI policies are inherited. Electron bundling must ship the worker entry and QuickJS WASM and pass their paths. Signed-app execution remains **unknown**.

### Tokens, latency, errors and streaming

**Inferred.** A script can replace several model round trips with local sequencing or parallel reads, and return a small selection rather than all raw results. It still spends output tokens on code and input tokens on discovery and selected output. Printing `ALL_TOOLS` or a full namespace forfeits disclosure savings. For one small call, code and sandbox setup can cost more than ordinary tool calling. There is no measured Juno token reduction or latency improvement here. As a static cost check, the pinned `createCodemodeTool({sandbox, models: false})` declaration is 1,636 JSON bytes using the same name, description and parameters serialization. That excludes its dynamic declaration section and framing. Adding it alongside the existing wrappers increases fixed context.

**Observed upstream, not measured here.** The pinned pi-codemode README reports about 20 ms for worker and VM creation. That excludes model generation, remote calls and Juno's disk commits. QuickJS interprets code and is slower than V8 for computation. The pinned durable implementation documents extra journal and acknowledgement commits around sequential results. Juno's FULL SQLite settings make that cost relevant. Do not adopt the upstream setup figure as a Juno latency budget.

**Observed in source.** [Durable codemode](https://github.com/earendil-works/pi/blob/d05a73fb31ea1c55c861115306df8f358a120de1/packages/durable/src/codemode/codemode.ts) maps invalid, blocked or failed schema-less tool calls to rejected promises. Scripts can catch those errors; `Promise.allSettled` retains successful siblings. Structured error values can resolve instead, so callers must check their status. The CLI's MCP wrapper returns `CallToolResult`, including `isError`; that is different from Juno's current text-only wrappers. Earlier effects survive later script failure, and unfinished calls are cancelled at settlement. Cancellation cannot prove an outward operation did not happen.

**Observed.** Durable nested tools emit progress and parent call ids to the host. The codemode result aggregates script output at completion; `text()` is not an extra live conversation turn. Model streaming and tool progress are distinct. [Durable's tool contract](https://github.com/earendil-works/pi/blob/d05a73fb31ea1c55c861115306df8f358a120de1/packages/durable/README.md#calling-tools-from-tools) provides host progress, but Juno needs Activity and Stop wiring for these nested calls. Its next model request sees the completed aggregate.

## Safety and provider fit

**Observed.** Durable codemode calls `api.executeTool` with a stable child key `c<id>`. Each child has validation, ToolTask hooks, intent, its own replay policy and receipt. The outer script is replay-safe and reconstructs execution from a deterministic journal. Interrupted unsafe children are not simply rerun. This is materially different from evaluating JavaScript that directly calls an MCP client.

**Inferred.** Per-call auto-review is possible. Attach it at the trusted child action boundary and dispatcher, before any non-read effect, including local changes. Never approve a script wholesale. A loop or `Promise.all` must produce separately reviewed immutable actions. A click must approve exact stored arguments, identity, schema and preconditions; a model-produced summary is insufficient. A proposal receipt must not resolve as if the action succeeded.

The existing write transport deliberately disables OAuth replay and SSE reconnect retries. Keep it. Pi's [general MCP integration](https://pi.dev/docs/latest/mcp) documents transient HTTP retries, so replacing Juno's manager with the CLI MCP extension would change the safety model.

For the proposed read-only integration:

- Enforce a script-callable read allowlist in the host, with current schema hashes and connection epochs checked at every child call. Hiding writes from declarations is insufficient. Existing `call_tool` handles both reads and outward proposals, so exposing it unchanged would not create a read-only boundary.
- Taint before any script can inspect server descriptions, schemas or content. Discovery globals can return data without a nested tool hook. Filtering away hostile text must not restore clean-run authority.
- Keep all non-read tools outside script reach, including schedules, memory changes, action proposals, T3 starts and the Codex harness. Do not expose raw transports, shell, arbitrary fetch, approval APIs or credentials.
- Record child arguments and outcomes in Juno's durable audit records. Pi's transcript has the aggregate and abbreviated call details, not a permanent full record of every result. Its temporary nested results and display previews are insufficient as the action audit trail.
- Preserve Slack handles through [host reads](../../packages/agent/src/router/host-tools.ts) and [source resolution](../../packages/agent/src/router/sources.ts). Filtered claims must still resolve to a message in the current run. Budget the aggregate and declarations through the existing builder and guard. Add host call, concurrency, time and output limits so a short script cannot cause unbounded work.
- Set `models: false`. Otherwise codemode adds classifier and image model paths that need separate spend admission. Treat script `store()`, journal values and output temp files as retained untrusted data subject to redaction, backup and purge. Prefer no retained script state initially.

**Observed in source, inferred compatibility.** Durable codemode has a normal object schema `{code: string}` and an optional grammar input variant. Models do not need a provider-native code interpreter. Tool-capable OpenRouter models can therefore use the JSON form; raw source depends on the model and transport's grammar support. Quality and reliability across Juno's model families are **unknown**, not guaranteed by tool support.

Juno's [Codex harness](../../packages/agent/src/providers/codex/harness.ts) already serves Juno tools over bearer-authenticated loopback MCP and executes them as nested durable tools. A JSON-schema codemode tool can fit that path and execute locally in Juno. This does not mean Codex natively runs pi codemode. The current bridge exposes the tool registry, so caller restrictions must exclude `juno_harnessTurn` from scripts and prevent recursion. MCP aggregate calls do not stream script output through this server. End-to-end Codex execution, cancellation and recovery with codemode remain **unknown**. No live provider was exercised.

## Small migration plan

1. Narrow `find_tools` independently. Measure real fixture request payloads before and after; retain honest paging notices.
2. Add the pinned durable codemode integration under `runtime/`, respecting Juno's pi-durable import boundary. Use an explicit read-only callable registry, deferred schemas, `models: false`, bounded workers and no persistent script values. Count its prompt section in admission; the present builder counts Juno's own section and declarations only.
3. Prove fake flows: discover one schema, parallel reads, preserve citations, throw after partial success, block every non-read child, demote a changed schema, stop during a call, restart during a read, and redact a consumed result. Check that raw or filtered untrusted data never authorizes anything. Verify OpenRouter's JSON tool path and the fake Codex loopback path.
4. Package and test the worker and WASM in Electron. Measure latency, billed-token behaviour and task completion on the same synthetic workloads with direct tools and codemode. Ship the read-only flag only after those results support it. Coordinate future write support with `auto-review-1`; it is outside this adoption.

## Implementation (codemode-1)

**Observed.** Steps 2 to 4 of the plan above are built behind the `agent.codemode` flag, off by default (`AgentConfig.codemode`, set by main from `JUNO_AGENT_CODEMODE=1`). Step 1, narrowing `find_tools`, was already on main. The agent README's "Codemode for reads" lists the details. In short:

- pi-durable's `./codemode` tool, unchanged, scoped in `runtime/codemode.ts`. A script's `api.agent()` lists only the explicit read list in `scripts/index.ts` (the six Slack reads and `connection_read`), its `api.executeTool()` refuses any other name, and the `pi.tool` hook refuses a script's child call that is not on the list. `connection_read` runs only tools on the reviewed read tier; a server's read-only mark is not enough. `models: false`, store writes dropped, no `env`.
- Each child call's arguments and outcome are in `script_calls` and on the Activity page.
- Message handles survive: a script's Slack read is the same host tool, so its lines carry `m1`, `m2` and citations resolve (`test/codemode.test.ts`, `e2e/juno-agent/codemode.spec.ts`).
- Caps: 40 calls, 4 in flight, 60 s, 16 KB of result, 64 MB heap, 2 workers. The builder counts the codemode section and declaration.
- Pause and AI off cancel a running script. pi waits for a child call to settle before the script ends, so reads now stop waiting when aborted (`abortable`); the result was not used, and the call is recorded as cancelled.
- The worker file and `quickjs.wasm` ship next to `agent.js`. The built-app e2e test runs a real script; the packaged smoke test checks a probe script from the asar build.
- `specs/agent-actions.qnt` gains `scriptNeverAuthorizes` and the `scriptWrite` pair.

**Not done.** Codemode is not offered through the Codex harness. Restart during a script was not tested beyond pi's own replay. No live model was used, so how real models write scripts is **unknown**.

## Measurement

**Observed**, with the scripted model and fake servers only (`bench/codemode.ts`, one round, on 2026-10-16). Each eval case runs as written (direct) and with its Slack reads moved into one script that returns the same text. Three extra multi-step tasks read the fake Notion, Littlebird and T3 servers: discover, search twice, then fetch each hit. The direct version makes independent calls in parallel within a response. Littlebird's two meeting reads are configured as owner-reviewed, because its preset has no reviewed reads.

Tokens are UTF-8 bytes / 4 (pi-ai's faux estimate), not a real tokenizer. Prompt tokens sum every chat request in the task. The scripted model gives the same answer whatever it is sent, so turns, sizes and success measure the tool path, not model behaviour. Success means every eval check passed (scripted judge), or for the connection tasks, the facts in the answer were in what the model read.

| Set | Mode | Model turns | Prompt tokens | Completion tokens | Wall ms | Success |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 20 eval cases | direct | 47 | 155,120 | 1,535 | 5,915 | 20/20 |
| 20 eval cases | codemode | 46 | 198,290 | 1,954 | 8,609 | 20/20 |
| Notion: two pages | direct | 4 | 10,068 | 196 | 424 | yes |
| Notion: two pages | codemode | 3 | 8,915 | 247 | 727 | yes |
| Littlebird: two meetings | direct | 4 | 10,051 | 198 | 506 | yes |
| Littlebird: two meetings | codemode | 3 | 8,965 | 225 | 514 | yes |
| T3: three running threads | direct | 4 | 10,714 | 206 | 972 | yes |
| T3: three running threads | codemode | 3 | 9,091 | 228 | 1,813 | yes |
| All 23 tasks | direct | 59 | 185,953 | 2,135 | 7,817 | 23/23 |
| All 23 tasks | codemode | 55 | 225,261 | 2,654 | 11,663 | 23/23 |

What the numbers say:

- The codemode section and declaration add about 1,000 prompt tokens to every request, whether or not a script runs (`simple-arithmetic`: 3,130 to 4,112).
- Most eval cases make one read per response, so a script saves no turn and costs that overhead plus about 30 completion tokens of code. Only `card-task-after-read`, with two read responses in a row, saves a turn, and it about breaks even on prompt tokens.
- On the multi-step connection tasks, a script saves one of four turns and 11 to 15% of prompt tokens. It spends 10 to 25% more completion tokens on code.
- Wall time is higher with codemode: about 100 to 300 ms per script for the worker and VM, more when it runs many calls (T3: 1,813 against 972 ms). Model latency, which dominates live runs, is not in these numbers; one fewer turn would save one model round trip.
- Wall times are from a single round on a shared Mac and are noisy (`remember` direct took 679 ms with no script involved).

**Inferred.** Codemode should stay off by default. Most of Juno's tasks need one read, and there it costs about a quarter more prompt tokens and is slower. It only pays off on multi-step reads, and there the saving is one turn and about an eighth of prompt tokens, measured on scripted answers. Before turning it on, measure live models: whether they write correct scripts, and whether the saved round trip outweighs the section's cost. Offering the codemode section only when a request is likely to need several reads would also remove most of the fixed cost.

## Reproduce the fixture measurement

Use a fresh disposable agent directory **inside this worktree**, Node 26.11.1 and the frozen lockfile. The measurement used this procedure, with no live endpoints:

1. Start the three fake servers from `packages/agent-testing/src/index.ts`. For T3 use `loopbackUrl`, not `lanUrl`.
2. Open `openTurns` with `MCP_MIGRATIONS`, `fakeProvider`, `createProviderGuard`, and model `{provider: "openrouter", modelId: "anthropic/claude-sonnet-5.5"}`. In its provider callback create the MCP manager on the provided store, overriding the three presets' URLs with the fake URLs. Use in-memory OAuth stores and `openAuthorization(url)` that fetches the matching fake's `oauth.approve(new URL(url))`.
3. Register `mcpTools` through `options.tools`, then `await manager.authorize(id)` for each preset. Assert all three are ready. Never reuse a previous measurement database: it retains the old ephemeral endpoints.
4. For each wrapper compute `Buffer.byteLength(declaration(tool.registration))`. Execute `find_tools` with `{}`, then each exact server id. Compute bytes from `output[0].text`. This is the actual wrapper result, not the fake's unprocessed schema.
5. Script the fake provider with a `find_tools` tool call for Notion followed by a final reply. Accept one synthetic owner input and await `turns.idle()`. Read `fake.requests`: sum compact declaration bytes from the initial system message's `toolsAdded`, and verify the second request contains the discovery result. No Slack host, action host, subagent model, views or T3 adapter was configured for this minimal turn fixture. Count six optional Slack read declarations separately with `hostTools` and `declaration`.
6. Close manager, engine and all servers, and delete the disposable directory. Run probes with `node --import ./scripts/ts-resolve-hooks.mjs <probe.mjs>`. For the table, encode each captured string with Python `tiktoken.get_encoding("o200k_base").encode(text)` and count its length. Concatenate declarations without separators for combined rows. Use `upper` for Juno's actual admission bound.
