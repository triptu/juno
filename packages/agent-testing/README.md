# @juno/agent-testing

Test doubles for Juno Agent. Imported only by tests (declare it in `juno.testDeps`).

- `fakeProvider(catalogue?)`: a scripted model on pi-ai's faux provider, registered as provider `openrouter` with today's resolved slugs and their real context windows (`fakeCatalogue`). `script(steps)` sets the responses; `calls()` and `pending()` count them.
- `startFakeMcpServer({ tools, bearer? })`: an MCP server over Streamable HTTP on loopback (initialize, `tools/list`, `tools/call`), with an optional bearer token. `calls` records every tool call. The test runs it against pi-mcp's real client.

WP10 adds the rest of plan v3 §16: lost streams and usage reports, the deterministic compactor model, the fake Codex binary, the Notion, Littlebird and T3 servers (OAuth, `list_changed`, schema changes, lost writes, a missing tool, loopback against LAN), hostile Slack fixtures, the crash harness and the memory simulator.

pi packages may be imported anywhere in this package (`check-deps`), because the fakes stand in for them.

## Must not

- Be imported by any `src`.
- Import Electron or any Slack package.
