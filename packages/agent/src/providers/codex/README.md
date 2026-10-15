# Local Codex

The picker discovers the installed `codex` executable and checks sign-in in
`<agentDir>/codex`, Juno's isolated `CODEX_HOME`. It lists Sol only when signed
in, resolving the model through the shared daily catalogue. It never reads
credentials, configuration, skills or MCP servers from the owner's Codex home.
To set up that home, the owner presses Sign in to Codex in "Set up Juno" after
the first sign-in, which has main run `codex login` with that home
(`apps/desktop/src/main/codex.ts`) and start the agent when it succeeds. Running
`CODEX_HOME="<agentDir>/codex" codex login` in Terminal and restarting Juno does
the same. That auth file lets main start local discovery
even without an API key; the agent still verifies sign-in and CLI availability. There is no separate ChatGPT OAuth provider.

The price line says “Uses your ChatGPT plan” and shows today's number of
attempted Codex turns. Remaining ChatGPT quota is not reported by this SDK.
Codex does not reserve or charge dollars against Juno's spend cap. Compaction
still uses the separately chosen API provider and its cap.

The guard's Codex response creates a one-use call to `juno_harnessTurn`.
This is an unsafe pi tool task, rather than a second custom scheduler task:
its execution intent commits before starting Codex, and pi never replays it
after a crash. The in-memory capability holds the admitted request. A restart
before execution loses that capability and ends the request without sending it.
The follow-up generation only converts the tool's result to a chat answer.
It never starts a second Codex turn for that result.

`harness.ts` serves the current Juno tools on one loopback MCP endpoint per
turn, with a fresh bearer token. Each call uses pi's `executeTool`, so validation,
status hooks, durable intents, replay policies and Juno's dispatcher still apply.
The harness itself is excluded from MCP. Shell and web are disabled, file writes
are denied by the read-only sandbox, and unexpected built-in execution events
end the turn. There is no automatic retry of a failed or crashed process.

One thread is reused per Juno conversation during the process lifetime. Reuse
stops on a changed model, removal generation, pin revision, missing ledger id,
a failed turn, or insufficient room for the next prompt and reply. The bound
reserves 32,000 tokens for Codex's own prompt in addition to Juno's reply reserve.
The request builder still supplies the current bounded memory each turn; old
thread context is never a substitute for it. Because a reused thread can contain
untrusted earlier material, the harness taints the run before any nested call:
outward actions require Juno's cards and approval.

Removal first aborts and drains local writers, then deletes all session and
archived-session files in the recorded Juno homes. This includes a file written
before a crashed process reported its thread id. Clearing the ledger's ids
invalidates reuse. Turn counts remain.

The status bubble says “Waiting for Codex” until a real nested tool supplies
progress. S3's first-text measurement was 5.2 seconds; see `docs/performance.md`.
The fake-process tests cover discovery, bearer auth, built-in refusal, bounded
reuse, removal, fixed errors, no-dollar accounting, picker selection, chat output
and a crash after a nested action with no second execution on reopen.
