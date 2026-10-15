# MCP connections (WP17)

`createMcpManager` owns HTTP connections, OAuth, discovered tools and owner tier decisions. `McpManager.layer` scopes the same API as an Effect service. The manager never opens the owner's existing browser credentials or reads a keychain itself. `Credentials` is main's bridge: one keychain-backed OAuth state store per connection, bearer lookup by reference, the held secret values for filtering, clearing credentials, and opening an authorization URL. Serialize keychain writes per connection. Do not log these values or send them to the renderer.

## Wiring

Apply `MCP_MIGRATIONS` in `openTurns.migrations`. Create the manager from the store passed to `openTurns.provider`, before returning the provider guard. Then supply:

- `actions.executors: () => mcpExecutors(manager)`. Discovery changes the registry; the callback is intentional. Each write has a namespaced executor and `deduped: false`.
- `tools: ({ current, actions }) => mcpTools(manager, { current, propose: actions.propose })`. The model gets only `find_tools` and `call_tool`. Both taint the run, including discovery descriptions. `find_tools({})` lists connection states; naming a disconnected server proposes a Connect card.
- Subscribe manager changes to `turns.actions.kick()` so waiting approvals resume after sign-in or reconnect. Call `manager.start()` after opening the engine, and close the manager before closing the engine.
- Pass `connections: manager` to `rendererServer`'s `ChatHost`. The existing Connections page, action and tier routes then serve real data. The desktop bootstrap must forward this optional dependency; WP17 does not edit Electron or the renderer.

WP14 uses each discovered row's `schemaHash` in `agent.connections.tier`. It is optional in the shared row schema for older fixtures; manager rows always carry it. Render server annotations only as hints. Connect runs the owner OAuth flow; Disconnect clears credentials and changes the connection identity; Disable retains credentials. Enable reconnects without opening a browser. Refresh discovers the tools again. The T3 address command remains WP18's responsibility.

`configure` is an owner-only API for connection config. There is no model tool for configuration or tier edits. Changing configuration revokes old credentials and cards. HTTP is permitted only on loopback; HTTPS is required elsewhere. A `noSecrets` connection refuses bearer configuration. Its OAuth token is sent only to the configured endpoint; MCP HTTP redirects are refused.

## Discovery and execution

Tool lists are paginated by pi-mcp and refreshed on `list_changed`. Only a default read name in the first discovery becomes Read. New tools are Outward regardless of annotations. A schema change demotes a tool until the owner reviews its current hash. A removed tool is unavailable. Schema translation rejects unsupported features, including untrusted regular expressions; arguments are validated before proposal and dispatch.

Every argument is filtered against held secrets and token patterns. Destructive tool names and destructive operations inside generic arguments are refused. The read path enforces Tier 0 again after asynchronous checks. Outward calls only propose a stored Change card; the dispatcher owns approval, consumption, attempt and receipt. Writes use a separate client without OAuth replay or SSE retries. An MCP error or lost response is unknown, never automatically repeated.

All discovery and tool content is untrusted, including on a `trusted` connection. Results over 20 KB stay in the ordinary tool-result archive attachment. The request builder substitutes an attachment notice before the next model call. This uses the existing attachment/redaction machinery; there is no second content store.

`serveMcp` is the WP20 boundary: a loopback-only, per-turn bearer-authenticated JSON-RPC endpoint. Give it only already-gated Juno tools; it grants no authority of its own. It limits request bodies and returns fixed errors, and `close` ends the listener and sockets. It does not expose the manager's raw transport.

## Notion and the live check

The default is `https://mcp.notion.com/mcp`, OAuth, initially off. Only the exact discovered search/fetch names are default reads. OAuth uses pi-mcp's PKCE, dynamic registration and refresh, with an actual loopback callback and issuer checking. Background failures never open sign-in windows. Reconnect backs off at 1 s, 5 s, 30 s and 5 min.

An update captures the fetched page id, `last_edited_time`, original content and exact resulting content. The click checks the version and original content again. Read-back reconciles only an exact changed result with a new version; create operations and unsupported shapes remain unknown without positive evidence. Notion does not provide an atomic compare-and-swap here: an external edit can still race between the final read and the write. No action-spec transition changes; WP15's existing schema/account/connection/precondition guards and unknown/no-repeat rules apply.

Tests use `agent-testing`'s Notion and Littlebird HTTP servers, the real pi-mcp OAuth/client path and the real turn engine. Their page update arguments are simplified, as the fake documents. The hosted server's current schema is always discovered, never assumed. The versioned update adapter deliberately refuses a response without a page id, content and `last_edited_time`, or an update outside its supported replace/append shape. Do not claim hosted writes are verified from these tests.

For a live check, the owner must supply the keychain/OAuth-window bridge, start Juno, click Connect for Notion, sign in and choose the intended workspace. First check discovery and a search/fetch of an owner-selected test page. Compare the actual fetch/update schemas with the adapter before allowing a write; if they differ, extend the fake and adapter together. Then approve one Change card on that test page and read back the result. No live workspace was accessed in WP17.
