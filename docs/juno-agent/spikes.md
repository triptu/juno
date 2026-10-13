# Juno Agent: WP0 spike results

Opus, 2026-10-14. Each spike is a script in `spikes/`, run against the exact versions plan v3 pins: `@earendil-works/pi-durable`, `pi-mcp`, `pi-ai` and `chord` 1.2.0, `@openai/codex-sdk` 0.162.1 (Codex CLI 0.162.1), on macOS 26.6 with Node 26.11 and with Electron 44.7's Node 24.21 (`ELECTRON_RUN_AS_NODE=1`), which is the Node the utility process runs. `spikes/` is a pnpm workspace package only so the scripts can resolve these packages. It is not part of the app.

Run them from the repo root:

```sh
node docs/juno-agent/spikes/s1-durable.ts            # S1, S5 commit cost. No network.
node docs/juno-agent/spikes/s8-mcp.ts                # pi-mcp, S8. Read-only.
node docs/juno-agent/spikes/s-catalog.ts             # model catalogue. Public endpoint, no key.
node docs/juno-agent/spikes/s7-tokens.ts .env        # S7, S2. Paid, about $0.06.
node docs/juno-agent/spikes/s3-codex.ts              # S3. One Codex turn on the owner's ChatGPT plan.
ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/.bin/electron docs/juno-agent/spikes/s5-s6-sqlite.ts   # S5, S6
```

Total OpenRouter spend for all runs: $0.06 of the $1 cap.

## What changes plan v3

1. **T3 Code's MCP needs OAuth.** The brief and §1, §10.2 say it "connects without extra auth". It does not. Both `127.0.0.1:3773` and `192.168.1.22:3773` answer `401` with `invalid_mcp_credential` and advertise OAuth: dynamic client registration, PKCE (S256), scopes `orchestration:read` and `orchestration:operate`, and the `authorization_code` grant only (no `refresh_token`). So:
   - The T3 connection is `auth: oauth`, like Notion and Littlebird, and the owner signs in once in a browser window. The `noSecrets` rule changes to "send T3 only its own token, and only to the origin that issued it". Everything else in the secret filter stays.
   - Without a refresh grant, an expired token sends the connection to `needs-sign-in`. The token lifetime is unknown until the first real sign-in. A running T3 job whose token expires keeps running in T3, but Juno loses sight of it until the owner signs in again. The job's Task card needs that state ("Sign in to T3 Code to keep watching").
   - **The LAN address cannot work.** pi-mcp's token request refuses any `http:` endpoint that is not loopback (`OAuthInsecureEndpointError` in `oauth/flow.js`, `secureEndpoint`). The flow starts on the LAN address (registration and the authorization URL work), then fails at the token exchange. So v1 is loopback only. The owner's "Allow T3 over the local network" switch becomes useful only if T3 serves HTTPS. Recommendation: drop the switch from v1, keep the URL setting, and accept `http:` only for loopback.
   - The T3 tool list was not read, because listing tools needs the sign-in. The plan's allowlist names (`t3_thread_read`, `t3_thread_list`, `t3_thread_search`, `t3_thread_wait`, `t3_pending_request_list`, `t3_project_list`, `t3_worktree_list`, `t3_worktree_status`) and the launch, send and interrupt tools match the T3 Code tools exposed to this agent session (inferred: same product and version, not read from the owner's server). WP10's fake uses these names. S8 is done for discovery and auth, and stays open for the live tool list until the owner signs in once.
2. **On macOS, `synchronous=FULL` is not power-loss safe without `fullfsync`.** macOS `fsync` does not flush the drive's cache. SQLite needs `PRAGMA fullfsync = ON` and `PRAGMA checkpoint_fullfsync = ON` for FULL to mean what §2.2 and §3 rely on. Measured cost in the utility process's Node: a commit takes about 3 ms with `fullfsync` against 0.05 ms without. Both `agent.sqlite` and the pi facade set it. `node:sqlite` is synchronous, so each commit blocks the agent process's event loop for those 3 ms. pi commits a streaming partial every 100 ms by default. Set `settings.progress.partialIntervalMs` to 250 ms, so streaming costs about 1% of the agent process instead of 3%.
3. **The single-writer lock is an SQLite file, not `flock`.** Node has no `flock` and no `O_EXLOCK` constant. `owner.lock` is an SQLite database held with `PRAGMA locking_mode = EXCLUSIVE` after one write transaction. Another process gets "database is locked" at once (busy timeout 0), and the kernel drops the lock when the holder dies, including on `kill -9`. The lock connection must stay referenced for the life of the process: a collected `DatabaseSync` closes and silently drops the lock (seen under Node 26 when the handle was not kept).
4. **Codex needs per-server tool approval, and is slow and large per turn.** Details under S3. The plan's "first text under 1.5 s" budget cannot hold for Codex turns (5.2 s measured). Each fresh Codex thread sends about 20,000 input tokens of Codex's own prompt with no cache, which spends the owner's ChatGPT quota.
5. **Model family patterns need three more exclusions.** `-lite`, `-preview` and `-image` join `-pro` and `-contributor`, and versions must be numeric (this drops `x-ai/grok-build-0.1`). Muse names releases with words (`meta/muse-wonder`, `meta/muse-spark-1.3`), so its pattern is `meta/muse-<word>[-<ver>]`. With these, the resolver picks exactly the slugs §7.1 predicts.
6. **The token upper bound is safe by a factor of about 2,** so the 1.25 multiplier in §5.1 is not needed for any of the six models. Keep the multiplier rule for future models.

Nothing else in plan v3 changes. pi-durable behaves as §3 assumes on every point S1 checks.

## S1: pi-durable through Juno's FULL facade

`s1-durable.ts`, 16 of 16 pass on Node 26 and on Electron's Node 24. It uses pi-ai's faux provider, so no network.

| Check | Result |
| --- | --- |
| Facade | `openNodeSqliteDatabase()` returns pi's own `NodeSqliteDatabase`. Juno runs `PRAGMA synchronous = FULL` (and `fullfsync`, see above) on it, then `SqliteStorage.open(db)`. Read back: `synchronous = 2`. No fork of pi is needed |
| `beforeRequest` replaces the request | The model saw only the hook's messages |
| A throwing `beforeRequest` | Reported to `onReport` and skipped. pi then sent its **raw context** (all entries since the last reset). This confirms §5.3: the provider-boundary guard is required |
| Reset per run keeps `sessionId` | The same `pi.provider` UUIDv7 before and after `reset()` |
| `requestId` dedupe | A second `submit` with the same `requestId` returns the same submission id and makes no model call |
| Compaction off | `compaction: { enabled: false, backgroundTokens: 0 }`. Five 8 KB inputs into a 2,000-token window were all sent, and no `pi.compaction` entry appeared. pi does not bound the request itself, so the guard is the only bound |
| Steering | A `whenBusy: "steer"` input sent during a tool round was placed after that round's tool result, inside the same run |
| `kill -9` mid-tool | After reopen and `resume()`, the run finished. The non-replay-safe tool's result is `Tool hang was interrupted and may have partially run`. The model saw that, and the input was not duplicated |
| Power loss (archive ahead) | An older copy of the journal opens with no error. pi does not detect rollback. Juno detects it by comparing the journal's `durable_metadata.next_seq` with the archive cursor (7 against 12 in the test). This reads a pi-internal table, so WP8 keeps a test that fails if pi renames it |
| Newer journal schema | `SqliteStorage.open` throws "Durable SQLite schema version 2 is newer than supported version 1" and leaves the file untouched. That is the §3 step 6 "safe stop" |
| Rotation | A new journal file gets a new `sessionId`. Each rotation costs one provider cache miss. Monthly rotation makes that negligible |
| Commit cost | 300 `write` submissions: 0.12 ms each at NORMAL, 0.16 ms at FULL, 3.4 ms at FULL with `fullfsync` |

Not covered here: reopen after a real pi upgrade (there is only one released schema version, so the "newer schema" case stands in for it), and hook failure inside `beforeTool` (documented by pi as "a throw blocks").

## pi-mcp and S8: HTTP, OAuth, discovery

`s8-mcp.ts`. Read-only: it calls no tool and completes no login. Dynamic client registration does run on each server, because it is the first step of the flow. The script prints no client ids, tokens or parameter values.

| Server | Plain connect | Discovery | Flow start with `McpOAuthProvider` |
| --- | --- | --- | --- |
| T3 Code, `http://127.0.0.1:3773/mcp` | `401` | Auth server on the same origin. Grants `authorization_code`. Registration yes. PKCE S256. Scopes `orchestration:read`, `orchestration:operate` | Registration ok. Authorization URL `/oauth/mcp/authorize`. Stopped there |
| T3 Code, `http://192.168.1.22:3773/mcp` | `401` | Same | Registration ok, authorization URL produced. The token exchange would be refused (see above) |
| Littlebird, `https://mcp.littlebird.ai/mcp` | `401` | Auth server `https://mcp.littlebird.ai/`. Grants `authorization_code`, `refresh_token`. Registration yes. PKCE S256. Scopes `littlebird:mcp`, `openid`, `email` | Registration ok. Authorization URL `https://mcp.littlebird.ai/authorize`. Stopped there |

pi-mcp's Streamable HTTP transport, discovery (`discoverOAuthServerInfo`), `McpOAuthProvider` with an injectable `McpOAuthStateStore` (Juno's keychain-backed store goes there), and the loopback `OAuthCallbackServer` all work as documented. pi-mcp does not open a browser. Main opens the authorization URL in an OAuth window (ADR 0012). pi-mcp has no MCP server side, so `agent/src/mcp/serve.ts` (WP17) and the fake MCP server are Juno's own (a small JSON-RPC handler, as in `s3-codex.ts` and `packages/agent-testing`).

## Model catalogue

`s-catalog.ts`. OpenRouter's public `GET /api/v1/models` lists 461 models. Of these, 239 remain after the filters (tools supported, no `:variant`, no `~` alias, no `-pro`, `-contributor`, `-preview`, `-lite` or `-image`, and text output only). The newest `created` per family:

| Family | Resolved | Window | Price in/out per M | pi-ai API |
| --- | --- | --- | --- | --- |
| Claude Sonnet (default) | `anthropic/claude-sonnet-5.5` | 1,000,000 | $2 / $10 | anthropic-messages |
| Claude Opus | `anthropic/claude-opus-5.5` | 1,000,000 | $4 / $20 | anthropic-messages |
| Muse | `meta/muse-wonder` | 1,048,576 | $4 / $20 | openai-completions |
| GPT Sol | `openai/gpt-6.1-sol` | 1,050,000 | $2 / $10 | openai-completions |
| Grok | `x-ai/grok-4.7` | 500,000 | $2 / $6 | openai-completions |
| Compaction: Claude Haiku (default) | `anthropic/claude-haiku-5.5` | 1,000,000 | $0.10 / $0.50 | anthropic-messages |
| Compaction: Gemini Flash | `google/gemini-3.8-flash` | 1,048,576 | $0.75 / $3.75 | openai-completions |

All seven are in pi-ai 1.2.0's OpenRouter catalogue, so none falls back to the generic OpenAI-compatible path. pi-ai's `openai-codex` catalogue lists `gpt-6.1-sol`, `gpt-6-sol` and `gpt-5.6-sol`, each with a 272,000-token window.

## S7: the token upper bound

`s7-tokens.ts`. One 6.9 KB prompt (prose, code, a URL, CJK, emoji and base64) to each model. The bound is UTF-8 bytes plus 64 per message: 6,979.

| Model | Reported input | Share of the bound | Bytes per token |
| --- | --- | --- | --- |
| Claude Sonnet 5.5, Opus 5.5, Haiku 5.5 | 3,561 | 0.51 | 1.91 |
| Grok 4.7 | 3,558 | 0.51 | 1.92 |
| Muse Wonder | 2,375 | 0.34 | 2.87 |
| GPT-6.1 Sol | 2,299 | 0.33 | 2.96 |

The bound holds for every family with a wide margin. It also means admission is conservative: a request the bound calls 250k is about 125k real tokens. All five chat models have windows of at least 500k, so the compatibility rule in §5.1 passes for all of them.

## S2: cache marks inside a user message

Same script. A 1,900-token memory view inside the first user message, then a second turn, on Claude Sonnet 5.5 with a `sessionId`. pi-ai's `anthropic-messages` path marks the last user message. First request: `cacheWrite 1930`. Second request: `cacheRead 1930`, `cacheWrite 19`. The view is read from cache on the next turn with no extra work from Juno.

## S3: driving the local Codex

`s3-codex.ts`, Codex CLI 0.162.1, signed in with ChatGPT.

- **Model list:** `codex app-server` over stdio, `initialize` then `model/list`. It returns `gpt-6.1-sol` (default), `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra` and `gpt-5.6-luna`. It gives no context windows, so the window comes from pi-ai's `openai-codex` catalogue (§7.1 fallback).
- **A turn through the SDK** works: an empty temporary directory, `sandboxMode: 'read-only'`, `approvalPolicy: 'never'`, `networkAccessEnabled: false` and `webSearchMode: 'disabled'`. Juno's tools come from a loopback MCP server registered with `config.mcp_servers.juno = { url, bearer_token_env_var }`. Codex sent the per-turn bearer token on every request (4 authorized, 0 rejected), called `juno_echo` once, wrote no files, and returned `JUNO:ping`.
- **Required setting:** with `approvalPolicy: 'never'`, Codex refuses MCP tool calls ("MCP tool call requires approval") unless the server sets `default_tools_approval_mode = "approve"`. This is safe for Juno's own server, because Juno's dispatcher does its own authority checks (§3).
- **Built-ins off:** the `features` table turns off `shell_tool`, `apps`, `plugins`, `image_generation`, `browser_use`, `computer_use`, `in_app_browser` and `memories`. With those off, the turn ran no command. `include_permissions_instructions`, `include_apps_instructions` and `include_environment_context` set to false shorten Codex's prompt. `tools.update_plan` cannot be set to false (it is a struct).
- **Cost and latency:** 20,000 input tokens and 110 output tokens for this turn, with no cache, because each turn is a fresh thread. The first event arrives after 0.4 s, the first text after 5.2 s, and the turn finishes after 9.4 s.
- **Isolation gap:** the SDK runs Codex with the owner's `~/.codex` (its config, MCP servers, skills, global `AGENTS.md`), and Codex writes the thread to `~/.codex/sessions`. WP20 should run Codex with its own `CODEX_HOME` under the agent directory. That needs one `codex login` for Juno's home (an owner action in Settings) instead of borrowing the owner's credentials. It also puts the session files that redaction must delete in a directory Juno owns.

## S5: lock and write rates in the utility process's Node

`s5-s6-sqlite.ts` under Electron 44.7 (Node 24.21).

| Check | Result |
| --- | --- |
| Lock held by another process | Refused at once ("database is locked") |
| Lock after `kill -9` of the holder | Granted |
| 2,000 single-row transactions, `synchronous=NORMAL` | 0.011 ms each |
| Same, `synchronous=FULL` | 0.043 ms each |
| 200 transactions, FULL with `fullfsync` | 2.8 ms each (358 per second) |

358 durable commits per second is far above what the inbox, ledger and projection need. The budget concern is pi's streaming partials (finding 2).

## S6: backup capture

`node:sqlite` in Electron's Node has `DatabaseSync.createSession()` and `applyChangeset()`. A changeset captured over an insert, an update and a delete applied cleanly to a fresh database (37 bytes, the expected final row). So §14.4 can use the session extension, not an application change log. WP21 still has to check two things: sessions attach per connection and per table, and a changeset holds no schema changes, so migrations need their own segment kind.
