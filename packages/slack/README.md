# @juno/slack

The Slack client as Effect services. It speaks the web client's own API (`docs/research/slack-data-access.md`). It knows nothing about topics, the store or the UI. See `docs/architecture.md` sections 2.2 and 5.

## Public API

Compose `SlackClient.layer` and provide the three seams the host owns:

- `SlackSession`: workspace ids and the token.
- `HttpTransport`: how bytes leave the process (`ElectronNet` in the app, `NodeFetch` in tests).
- `SocketHandshake`: cookie, origin, user agent and proxy for the socket upgrade.

Then use the services:

- `SlackApi`: Web API calls, decoded with `@juno/slack-schema`, including `presence.set({ presence: 'auto' | 'away' })`.
- `SlackEdge`: the edge API (`users/info` and similar).
- `RequestQueue`: request lanes, per-method rate limits and `Retry-After`.
- `SlackSocket`: the event socket with reconnect, as a stream of `SocketEvent`.
- `SlackConfig` / `slackConfigLayer`: timers and limits, with defaults.

`@juno/slack/import` is a separate entry: `readSlackAppSession({ dir, keychainPassword })` reads a team record and the `d` cookie out of a copy of the installed Slack app's data (a leveldb scan for `localConfig_v2`, Chromium cookie decryption). Plain file reading, no network; main and the live smoke use it.

Errors are tagged and typed: `SlackAuthRequired`, `SlackRateLimited` (`retryAfterMillis`), `SlackRejected`, `SlackTransportError`, `SlackDecodeError`. The engine maps them to `@juno/contract` errors; this package does not import the contract.

## Must not

- Import `@juno/domain`, `@juno/store`, `@juno/contract` or any UI package. It depends on `@juno/slack-schema` only.
- Import `@juno/fake-slack` in `src`. The fake is a test-only dependency (`testDeps`).
- Retry a fatal auth error or a decode error.

## Testing

`pnpm --filter @juno/slack test`. Tests start a real `@juno/fake-slack` per test and point the client layer at it (`test/helpers.ts`): the request lanes, the 429 handling, the auth failures and the socket lifecycle are all checked against the fake's HTTP and websocket server. Under `it.effect` the `TestClock` stops the 1.5 s background lane spacing; set `backgroundMinIntervalMillis: 0` or use `it.live` for tests that make several background calls.
