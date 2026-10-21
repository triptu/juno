# 0007. The engine uses Electron `net` on a `persist:slack` session; the cookie never leaves Chromium except for the socket handshake

Status: accepted, 2026-10-12. Changes ADR 0001's network paragraph.

## Context

ADR 0001 v1 said the utility process must use Node `fetch` and attach the `d` cookie by hand. The review verified that Electron 44 exposes `net` in utility processes and that `utilityProcess.fork` accepts `session` or `partition` (confirmed in `electron.d.ts`). With Node `fetch`, Juno would ignore `Set-Cookie` responses that rotate the session, skip the system proxy, PAC files and keychain CAs, and present Node's TLS fingerprint instead of Chromium's. Each of those breaks real users: corporate networks, Enterprise Grid, and a session that expires while the official client's stays valid.

## Decision

- Main stores the `d` cookie in `session.fromPartition('persist:slack')`. The Slack-app import writes the decrypted cookie into it with `cookies.set`.
- The engine is forked with `partition: 'persist:slack'` and `SlackApi` calls `net.fetch` on it through an `HttpTransport` service. `ElectronNet` is the production layer; `NodeFetch` is the test layer pointed at `fake-slack`.
- The websocket still uses `ws` because `net` has no WebSocket. Before each connect the engine asks main for the serialised cookie header for `slack.com` and for `session.resolveProxy(url)`, connects with `Cookie`, `Origin: https://app.slack.com` and the Slack desktop `User-Agent`, forwards any `Set-Cookie` from the upgrade response back to main, and discards the header string.
- `juno://files/...` thumbnails and downloads are served by main on the same session, because custom protocols are not supported in utility processes.
- Only the `xoxc` token and the OpenRouter key are stored by Juno itself (`safeStorage`, `secrets.bin`).

## Consequences

- Cookie rotation, proxies, CAs and the TLS fingerprint are Chromium's problem, not ours.
- The socket handshake is the one hand-held cookie path; it is small, isolated and covered by a fake test that rejects an upgrade without the cookie.
- Engine tests under Node use the `NodeFetch` layer and a plain `ws` connection to the fake.
- Chromium sends a request again by itself when a reused connection closes before any answer, POSTs included. A post can then reach Slack twice; ADR 0014 records how Juno deletes the copy.
- `webRequest` listeners on `persist:slack` also see the engine's requests, so the sign-in body sniff (fallback capture) is unregistered right after capture.
