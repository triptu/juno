# MCP connections (WP17)

`createMcpManager` owns HTTP connections, OAuth, discovered tools and owner tier decisions. `McpManager.layer` scopes the same API as an Effect service. The manager never opens the owner's existing browser credentials or reads a keychain itself. `Credentials` is main's bridge: one keychain-backed OAuth state store per connection, bearer lookup by reference, the held secret values for filtering, clearing credentials, and opening an authorization URL. Serialize keychain writes per connection. Do not log these values or send them to the renderer.

## Wiring

`startAgent(config, connection, { turns, mcp: { credentials } })` wires it (`app.ts`, `withMcp`): `MCP_MIGRATIONS` in the engine's migrations, the manager made on the store passed to `turns.provider`, `actions.executors: () => [...own, ...mcpExecutors(manager)]` (discovery changes the registry, so it is a callback; each write has a namespaced executor and `deduped: false`), and `tools: mcpTools(manager, { current, propose })`. The manager offers `find_tools` and `call_tool`, and `connection_read` for codemode scripts only (a reviewed read, nothing else; see the agent README, "Codemode for reads"); WP18 also registers `t3_start`, `t3_send` and `t3_stop` through `../t3/`. Generic `call_tool` cannot launch a T3 session. Both taint the run, including discovery descriptions. Discovery is progressive (`discovery.ts`, below); naming a disconnected server proposes a Connect card. After the engine opens, `startAgent` subscribes manager changes to `turns.actions.kick()` so waiting approvals resume after sign-in or reconnect, calls `manager.start()`, passes `connections: manager` to `rendererServer`'s `ChatHost`, and closes the manager before the engine.

The desktop agent (`apps/desktop/src/agent/index.ts`) supplies `credentialBridge` (`bridge.ts`): each `Credentials` call is a `credential` request to main over `parentPort` (`CredentialRequest`: `load`, `save`, `clear`, `open`), answered by `credentialReply`. Main (`apps/desktop/src/main/mcpCredentials.ts`) keeps each connection's OAuth state in the login keychain, in base64 chunks under the service `juno-mcp`, writes one connection at a time, refuses ids that are not Juno's, and opens only https or loopback sign-in pages with `shell.openExternal`. Under `JUNO_E2E` it keeps them in memory and fetches the sign-in page instead, which the fake authorization server approves. The held secrets for the argument filter are the states this agent process loaded or saved. No connection uses a bearer secret yet.

The presets are Notion, Littlebird (`https://mcp.littlebird.ai/mcp`, OAuth) and T3 Code (`http://localhost:3773/mcp`, OAuth with no refresh, `noSecrets`), all off at first and never removable. Littlebird's read list starts empty until the owner reviews discovered names and schema hashes; WP18 removed the unconfirmed names. See `../littlebird/README.md`. `address(url, allowNetwork)` changes T3 Code's address: without the network switch only loopback is accepted, with it private IPv4 hosts may use HTTP and other hosts require HTTPS. `add(label, url)` adds another server with no auth and no read list; `remove(id)` deletes one the owner added, with its credentials.

Connect (`authorize`) first connects with stored credentials, which opens no browser. Only when the server then asks for a sign-in does it run the OAuth flow; a server added without auth that answers 401 is switched to OAuth first. A new sign-in changes the connection identity.

Settings › Connections › Configure uses `agent.connections.tool` (a tool's Enabled switch or its auto-review rule) and `agent.connections.rule` (the connection's rule). A row's hint is the server's one-line description, shown and never trusted. Connect signs in only when needed; Disconnect clears credentials and changes the connection identity; Disable retains credentials. Enable reconnects without opening a browser. Refresh discovers the tools again. Remove deletes an added server.

`configure` is an owner-only API for connection config. There is no model tool for configuration or tier edits. Changing configuration revokes old credentials and cards. HTTP is permitted on loopback, and for T3 on private IPv4 hosts with the network switch; HTTPS is required elsewhere. A `noSecrets` connection refuses bearer configuration. Its OAuth token is sent only to the selected endpoint; MCP HTTP redirects are refused.

## Discovery and execution

**What the model is told, step by step** (`discovery.ts`). `find_tools` takes `server`, `query` and `tool`, all optional:

| Call | Returns |
| --- | --- |
| `find_tools({})` | `{ servers: [{ server, name, state, tools }], off: [server] }`: the servers that are on, their state and, when ready, how many tools they offer; the handles of those that are off |
| `find_tools({ query })`, or with `server` | `{ tools: [{ server, tool, about, read? }], more? }`: tools whose name or one-line description holds every word, at most 20 |
| `find_tools({ server })` | the same lines for every tool of that server |
| `find_tools({ server, tool })` | `{ server, tool, about, read?, inputSchema }`: that one tool's full description (up to 1,000 characters) and argument schema |

A server is named by its handle (`manager.handles()`): a preset's id (`notion`, `littlebird`, `t3`), or a slug of the label the owner gave an added server (`team-docs`). `call_tool` and `find_tools` take the handle and, for older turns and tests, the internal id. Internal ids, schema hashes, addresses, tiers and allowlists never reach the model, and a tool the owner turned off never appears. In `test/discovery.test.ts`'s fixture (Notion and a three-tool added server) the bare call costs 215 bytes where the old page cost 2,171; a query 499, a server's list 229 and one schema 283. Every response is still untrusted data.

Tool lists are paginated by pi-mcp and refreshed on `list_changed`. A tool is a read (`isRead` in `catalogue.ts`) while its schema is unchanged since Juno first saw it and either the code's read list names it or the server marked it read-only then; T3 Code counts only its read list. A preset's read names come from the code at every start. A schema change makes the tool a non-read for good and puts a Never ask rule back to Auto. A removed tool is unavailable, and so is one the owner turned off: it is left out of `definitions`, so the model is never offered it and it has no executor. Schema translation rejects unsupported features, including untrusted regular expressions; arguments are validated before proposal and dispatch.

Every argument is filtered against held secrets and token patterns. The read path enforces Tier 0 again after asynchronous checks. Any other call goes through the auto-review (`../../README.md`, "Auto-review"): it either proposes a stored Change card, whose click the dispatcher owns, or runs once under a review authority with the same consumption, attempt and receipt records. A destructive tool name or argument no longer refuses the call: it makes the review's risk a delete, so under Auto it always asks. Writes use a separate client without OAuth replay or SSE retries. An MCP error or lost response is unknown, never automatically repeated.

All discovery and tool content is untrusted, including on a `trusted` connection. Results over 20 KB stay in the ordinary tool-result archive attachment. The request builder substitutes an attachment notice before the next model call. This uses the existing attachment/redaction machinery; there is no second content store.

`serveMcp` is the WP20 boundary: a loopback-only, per-turn bearer-authenticated JSON-RPC endpoint. Give it only already-gated Juno tools; it grants no authority of its own. It limits request bodies and returns fixed errors, and `close` ends the listener and sockets. It does not expose the manager's raw transport.

## Notion and the live check

The default is `https://mcp.notion.com/mcp`, OAuth, initially off. Only the exact discovered search/fetch names are default reads. OAuth uses pi-mcp's PKCE, dynamic registration and refresh, with an actual loopback callback and issuer checking. Background failures never open sign-in windows. Reconnect backs off at 1 s, 5 s, 30 s and 5 min.

An update captures the fetched page id, `last_edited_time`, original content and exact resulting content. The click checks the version and original content again. Startup reconciliation reconnects enabled servers without opening a browser. Read-back reconciles only an exact changed result with a new version; create operations and unsupported shapes remain unknown without positive evidence. Notion does not provide an atomic compare-and-swap here: an external edit can still race between the final read and the write. No action-spec transition changes; WP15's existing schema/account/connection/precondition guards and unknown/no-repeat rules apply.

Tests use `agent-testing`'s Notion and Littlebird HTTP servers, the real pi-mcp OAuth/client path and the real turn engine. Their page update arguments are simplified, as the fake documents. The hosted server's current schema is always discovered, never assumed. The versioned update adapter deliberately refuses a response without a page id, content and `last_edited_time`, or an update outside its supported replace/append shape. Do not claim hosted writes are verified from these tests.

For a live check, the owner starts Juno, opens Connections, clicks Connect for Notion, sign in and choose the intended workspace. First check discovery and a search/fetch of an owner-selected test page. Compare the actual fetch/update schemas with the adapter before allowing a write; if they differ, extend the fake and adapter together. Then approve one Change card on that test page and read back the result. No live workspace was accessed in WP17.

T3 tries the configured port on loopback first and shows the selected address.
The selected endpoint is saved; switching endpoints clears credentials and
changes the connection epoch before any tool call. Network fallback requires
the owner switch. Public hosts require HTTPS; private and link-local IPv4
hosts may use HTTP, though OAuth may require HTTPS there.
