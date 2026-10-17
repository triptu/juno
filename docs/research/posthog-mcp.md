# PostHog's MCP server and its `exec` tool

Research on 2026-10-17, from PostHog's public docs and the source of their MCP server (`PostHog/posthog`, `services/mcp/`, read on GitHub that day). No PostHog account, token or live call was used. **Observed** means read in their docs or source. **Inferred** means worked out from the source without running it. **Unknown** still needs a check against the hosted server.

## Why this matters

The owner asked Juno to turn on a PostHog feature flag for one person. Juno answered that PostHog's one tool, `exec`, had an argument schema over 20 KB that was cut off, so it could not see how to call it. It made one guess, which failed. Two cuts hid the schema: `find_tools` results over 20 KB were swapped for an attachment notice, and every tool result in a run over 2 KB was sent as head and tail. Both are fixed (decision log, 10-17): a tool's schema is now sent whole up to 48 KB.

## Two modes

**Observed** ([FAQ](https://posthog.com/docs/model-context-protocol/faq)):

- **CLI mode** ships one tool, `exec`, plus `render-ui` on clients that show MCP apps. The agent lists, searches, inspects and calls PostHog's tools through `exec`. This is the default for most clients; PostHog picks it by the client's name, and Juno is not on their list of tools-mode clients.
- **Tools mode** registers every PostHog tool on its own, the standard MCP shape. Cursor gets it by default.
- The header `x-posthog-mcp-mode` or the query `mode` (`cli` or `tools`) overrides the choice, for example `https://mcp.posthog.com/mcp?mode=tools`.
- `x-posthog-read-only: true` or `?readonly=true` removes every tool that creates, updates or deletes.
- `?features=flags` and `?tools=a,b` narrow the tool list.

## How `exec` works

**Observed** (`services/mcp/src/tools/exec.ts`):

- The input schema is one field: `{ "command": string }`. The whole command reference lives in that field's `description`. That is why the schema is large and why it is almost all prose, not structure.
- One command per call. Several commands on separate lines are refused before any runs.
- Commands:
  - `help [command]`
  - `tools`: the tool names
  - `search <words or regex>`: tools by name, title or description
  - `info [--json] <tool>`: a tool's description and input schema. A large schema comes back as a summary with `hint` fields.
  - `schema <tool> [field.path]`: one field of a tool's schema, for the fields `info` summarized. PostHog's own prompt calls this a hard rule: never guess a field that has a hint.
  - `call [--json] [--confirm] <tool> [json]`: run a tool with JSON arguments. `--confirm` is needed for a destructive tool only when the server runs with `requireDestructiveConfirmation`.
- The flag tools are `feature-flag-get-all`, `feature-flag-get-definition`, `feature-flag-get-definition-by-key`, `create-feature-flag`, `update-feature-flag` and `delete-feature-flag` ([tools reference](https://posthog.com/docs/model-context-protocol/tools)). So the owner's request is about three calls: `info update-feature-flag` (then `schema` for any summarized field, such as the release conditions), maybe a get to read the flag's current conditions, then `call update-feature-flag {...}`.
- Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`. Reads and writes share the one tool, so PostHog cannot mark it read-only.
- PostHog's tool output budget is 80,000 characters (`MCP_TOOL_OUTPUT_CHAR_BUDGET`).

**Inferred.** The command reference joins about twenty prompt sections (`instructions-formatter.ts`, `buildExecCommandReference`), about 35 KB of text before JSON escaping. With the tool's description, Juno's schema answer for `exec` is probably 35 to 40 KB, under Juno's 48 KB. PostHog sizes a smaller reference for claude.ai only, because claude.ai drops a tool whose schema passes 16,384 characters.

**Unknown.** The exact size the hosted server sends to a client named Juno, and whether it changes as PostHog adds tools. The owner can see it: a schema over 48 KB now gives the one-line "Juno can't use this tool" answer instead of a guess.

## What this means for Juno

- **Tier.** `exec` is not on any read list and is not marked read-only, so every `exec` call, `help` and `info` included, is a connection call that gets the auto-review. The review judges the command, not only the tool's name (decision log, 10-17): a lookup such as `info update-feature-flag` is a read and runs with no card under Auto when the owner's words pointed toward it; `call update-feature-flag {...}` is a change and asks unless the owner asked for exactly it. One rule covers all of PostHog in CLI mode.
- **Tools mode is an option.** Juno already defers schemas: `find_tools` searches a server's tools and returns one schema only when the model needs it. In tools mode each PostHog tool has its own Configure row, its own rule and its own read-only mark, so the owner can, for example, set `update-feature-flag` to Always ask while other writes stay on Auto. To use it, add PostHog in Settings › Connections with the address `https://mcp.posthog.com/mcp?mode=tools`.
- **The prompt hint.** `find_tools` tells the model that a tool taking one command string is a small command line: run its help and info commands before a call, and never guess a schema. Juno's other tools know nothing specific to PostHog.

## Trying it on the owner's other Mac

1. Update Juno to a build with this change. Open Settings › Connections and check that PostHog is connected.
2. In the Juno chat, ask: "Turn on the PostHog flag actions-cards-feed for <a test person>". Use a flag that is safe to change.
3. Juno should look up the tool through `exec` (`help`, `info update-feature-flag`) with no card, then propose the change. Under Auto the change shows a Change card unless the request asked for exactly it; Activity lists each call and why it ran or asked.
4. If the schema is too large, Juno now says "Juno can't use this tool: its description and argument schema are N KB, more than the 48 KB Juno can read." Report N.
5. Optionally, try tools mode: remove PostHog, add it again with `https://mcp.posthog.com/mcp?mode=tools`, and compare.
