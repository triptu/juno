# @juno/fake-slack

A fake Slack for tests and development: an HTTP and websocket server that speaks the web client's protocol (`docs/research/slack-data-access.md`), with a control API to make things happen from "another client". See `docs/architecture.md` sections 2.2 and 13.

## Public API

```ts
const fake = await startFakeSlack({ port?, now?, seed? })
const { url, token, cookie, teamId, userId } = fake.credentials()
await fake.close()
```

- Server: multipart `POST /api/<method>` with the `token` field and the `d` cookie, `ok: false` errors, the edge API with JSON bodies, uploads, and the event socket with `hello` and ping.
- Controls, each also reachable as `POST /control/<name>` for tests that drive a built app: `injectMessage`, `editMessage`, `deleteMessage`, `markRead`, `markThreadRead`, `addReaction`, `removeReaction`, `joinChannel`, `leaveChannel`, `typing`, `emitFrame`, `dropSocket`, `force429`, `clear429`, `expireSession`, `advanceClock`, `setNow`, `resetCalls`.
- Inspection: `calls`, `callCount(method)`, `frames`, `messages(channel)`, `socketCount()`.
- A sign-in page that sets the `d` cookie and `localStorage.localConfig_v2`, as the real one does from Juno's point of view. The `enterpriseId` option makes the team an Enterprise Grid one.
- `writeSlackAppFixture(dir, { team, cookie, keychainPassword })`: a stand-in for the installed Slack app's data directory (leveldb with `localConfig_v2`, a Chromium `Cookies` file with the encrypted `d` cookie), for testing the import path.
- A default seeded workspace (`PEOPLE`, `CONVERSATIONS`); replace it with the `seed` option. It includes public channels the self user is not a member of (`members` without `SELF_ID`), because the real `client.userBoot` lists every channel of the workspace.
- Boot shapes follow what the live smoke recorded (`packages/slack-schema/test/fixtures/recorded/`): `client.userBoot.channels` is metadata only for every channel, member or not (no `is_member`, `last_read`, `latest`, `unread_count`); `client.counts` lists the user's own conversations with their read state. `conversations.*` and the `channel_joined` family return the fuller channel object with `is_member`. The socket sends `hello` with `start: true`, then a complete `reconnect_url` after 200 ms and every 30 s.
- `pnpm --filter @juno/fake-slack start` runs it on its own.

## Must not

- Import the engine, the client (`@juno/slack`) or any UI package. It depends on `@juno/slack-schema` only, and encodes its responses with those schemas so it cannot drift from the client.
- Be imported from `src` of another package. It is a `devDependency` for tests (`testDeps`).
- Contain real Slack tokens, cookies or message content. Fixtures are invented.

## Testing

`pnpm --filter @juno/fake-slack test`. The tests call the fake over real HTTP and websockets: auth failures, pagination, posting and echoes, and each control. Any behaviour the client tests rely on is checked here first.
