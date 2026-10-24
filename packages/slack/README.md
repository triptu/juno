# @juno/slack

The Slack client as Effect services. It speaks the web client's own API (`docs/research/slack-data-access.md`). It knows nothing about topics, the store or the UI. See `docs/architecture.md` sections 2.2 and 5.

## Public API

Compose `SlackClient.layer` and provide the three seams the host owns:

- `SlackSession`: workspace ids and the token.
- `HttpTransport`: how bytes leave the process (`ElectronNet` in the app, `NodeFetch` in tests).
- `SocketHandshake`: cookie, origin, user agent and proxy for the socket upgrade.

Then use the services:

- `SlackApi`: Web API calls, decoded with `@juno/slack-schema`. A call's `beforeSend` runs holding its lane's permit just before each exchange and can stop the call with its own error. Includes `presence.set({ presence: 'auto' | 'away' })`.
- `SlackEdge`: the edge API (`users/info` and similar).
- `RequestQueue`: request lanes, per-method rate limits and `Retry-After`.
- `SlackSocket`: the event socket with reconnect, as a stream of `SocketEvent`. Each frame carries `receivedAt`, stamped before it enters the consumer queue; sync uses it to distinguish a newer pong from an older queued one. `tickle(reason)` tells Slack the user is here, at most once per `socket.tickleSpacingMillis` (19 s) across reconnects.
- `SlackConfig` / `slackConfigLayer`: timers and limits, with defaults.
- `SlackTrace`: hears each Web API and edge call start and end (params without the token, timing, attempts, outcome, response size and body) for the engine's developer log. A `Context.Reference` that is off by default, so a client built without it does no extra work.

`@juno/slack/import` is a separate entry: `locateSlackAppData(slackAppCandidates(home))` finds the installed Slack app's data (direct download or Mac App Store, `Network/Cookies` or `Cookies`) and `copySlackAppData` copies it; `readSlackAppSession({ dir, keychainPassword })` reads a team record and the `d` cookie out of a copy of the installed Slack app's data (a leveldb scan for `localConfig_v2`, Chromium cookie decryption). Plain file reading, no network; main and the live smoke use it.

Errors are tagged and typed: `SlackAuthRequired`, `SlackRateLimited` (`retryAfterMillis`), `SlackRejected`, `SlackTransportError`, `SlackDecodeError`. `SlackDecodeError` carries a schema field path and fixed issue kind without response values. Paths allow only field names declared by the schemas and array indexes; dynamic record keys become `unknown`. The engine maps them to `@juno/contract` errors; this package does not import the contract.

## Must not

- Import `@juno/domain`, `@juno/store`, `@juno/contract` or any UI package. It depends on `@juno/slack-schema` only.
- Import `@juno/fake-slack` in `src`. The fake is a test-only dependency (`testDeps`).
- Retry a fatal auth error or a decode error.

## Request pacing

Juno spaces all background starts 1,500 ms apart in total (40/minute), and retains a separate 1,500 ms minimum for each method. The 298-call live run measured about 40/minute across all methods, not per method. This is evidence for a conservative background budget, not a guarantee for the internal session token shared with the official client.

Interactive reads use a separate token bucket: capacity 20, refill one token every 500 ms (2/second). Reconnect refetches beyond that allowance queue; waits release lane permits and recheck the method pause before dispatch. The send lane remains one in flight. The interactive budget is a local policy for normal use and bounded bursts, not a measured Slack allowance. The fake can inject method or global 429s but does not enforce a measured throughput limit.

A 429 retains Retry-After and doubles that method's background interval once per active pause window, capped at 60 s. Every 429 resets its quiet timer. After five minutes without another 429 the interval halves, then halves every further five quiet minutes down to 1,500 ms. Existing start deadlines are retained. Interactive calls fail fast only for a method pause longer than five seconds, not because their token bucket is empty. Test overrides can disable background spacing and interactive refill waits independently.

## Testing

`bun run --cwd packages/slack test`. Tests start a real `@juno/fake-slack` per test and point the client layer at it (`test/helpers.ts`): the request lanes, the 429 handling, the auth failures and the socket lifecycle are all checked against the fake's HTTP and websocket server. Under `it.effect` the `TestClock` stops the per-method background lane spacing; set `backgroundMinIntervalMillis: 0` or use `it.live` for tests that make several background calls.

`searchMessagePage` returns decoded matches, pagination, totals and From/In facets for Search sessions. Its arguments expose bot exclusion and query-rewriting control. `decodeSearchHighlights` produces UTF-16 ranges from supported wrappers. The recorded 10-24 extract fixture redacts every string, so the precise live marker pair remains unverified.
