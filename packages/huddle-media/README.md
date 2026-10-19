# @juno/huddle-media

A huddle's audio in the renderer (`docs/plans/huddles.md`, phase 3, track C). The engine joins the huddle with `rooms.join` and hands the renderer `call.free_willy.{meeting, attendee}`; this package takes those to Chime and reports what happens as a plain store. It is plain TypeScript: no React, Effect, Electron or `window.juno` (`check-deps` holds it to that).

## Why it lives in the renderer

WebRTC needs a Chromium page, and the stream has to be in the same page as the elements that play and show it. So the media session runs in the main renderer, as an exception to "the renderer is UI only" (decision 2026-10-18, `huddles-media-in-renderer`). All Slack I/O and the call's state stay in the engine; this package never talks to Slack.

## Entries

- `@juno/huddle-media`: the types (`src/types.ts`). It exports only what something imports today (`MediaSnapshot`, for the spike), since knip fails on an unused export; the integration adds `MediaSession` and the rest as its containers use them.
- `@juno/huddle-media/chime`: `createChimeMediaSession()`, on `amazon-chime-sdk-js` 3.32.0 (the version Slack ships). The SDK is about 2.2 MB minified (550 KB gzip), so load this entry only with `import()` on join; it must never reach the initial bundle. Only `src/chime/` and the tests may import the SDK.
- `@juno/huddle-media/fake`: `createFakeMediaSession(options)` for e2e tests and the gallery. No network and no WebRTC. Production code never imports it.

## The interface

```ts
interface MediaSession {
  join(info: { meeting; attendee; microphone?; speaker?; noiseSuppression? }): Promise<void>
  leave(): Promise<void>            // resolves once stopped, within 5 s
  setMuted(muted: boolean): void
  setNoiseSuppression(on: boolean): Promise<void>
  listDevices(): Promise<Devices>   // also retries a blocked microphone; call it on window focus
  chooseMicrophone(id: string | null): Promise<void>  // null: same as system
  chooseSpeaker(id: string | null): Promise<void>
  subscribe(listener: () => void): () => void
  getSnapshot(): MediaSnapshot
}
```

The snapshot (`src/types.ts` has the comments):

- `connection`: `idle`, `connecting`, `connected`, `reconnecting`, or `ended` with `reason` (`left`, `another-device`, `meeting-ended`, `removed`, `full`, `connection-lost`, `failed`), the call's `attendeeId` and Chime's `code`.
- `local`: the call's `attendeeId`, `muted`, `speaking`, and `sending`: the call is connected, the track Chime sends is live and giving data, and Chime's server reports a signal from us (local signal strength above 0). It is re-checked on every microphone change, Voice Focus's swap included. It says packets arrive, not that they are loud.
- `remotes`: everyone else in join order, each with `attendeeId`, `externalUserId`, `userId` (the Slack user id parsed from `T…-R…-U…`, research section 6), `muted` and `speaking`.
- `activeSpeaker`: the attendee id of the loudest person speaking, local or remote.
- `devices`: microphones and speakers, the system devices' names, the user's picks and the devices in use. A pick that is unplugged stays the pick; the system's device plays until it is back.
- `microphoneAccess`: `unknown`, `prompt`, `granted`, `denied` or `unavailable` (no microphone).
- `noiseSuppression`: `on`, `off` or `unsupported`.
- Phase 4, screen share: `shares` (someone else's share: its `#content` attendee and the owner's user id) and `localShare` (always `undefined` for now). The Chime session fills `shares` from presence, so the bar can say who is sharing, but it receives no video yet.

## Rules

- **One call at a time.** `join` while a call is connecting, connected or reconnecting throws. After `ended`, `join` starts a new call on the same session, so the app root can keep one session for the app's life.
- **The snapshot is immutable** and a new object only when something changed. Unchanged parts (an attendee, the device list) keep their identity, so rows can be memoised on them.
- **Throttled.** Discrete changes (connection, presence, local mute, devices) publish at once. Speaking, the active speaker and remote mute come from Chime's active speaker detector and volume indicator and publish at most every 100 ms, about 10 snapshots a second.
- **Single thread.** Everything runs on the renderer's main thread; listeners are called synchronously after each publish and must be cheap. Voice Focus runs in an audio worklet.
- **Lifetime.** The session owns one `<audio>` element, created with the session and never put in the page, and binds the call to it. `leave()` or Chime's own stop unbinds it, stops the microphone and frees Voice Focus. `leave()` is safe in any state, also while `join` is still starting.
- **The engine learns of an end from the snapshot.** When Chime ends the call by itself (`another-device`, `connection-lost`, `meeting-ended`, `removed`, `full`, `failed`), only the renderer knows. The owner of the session watches for `connection.state === 'ended'` with a reason other than `left` and tells the engine, passing `attendeeId`, so the engine can send `rooms.leave` and clear its call. The attendee id makes a late end of an older call easy to ignore.

## Chime set-up

- Audio only: `NoVideoDownlinkBandwidthPolicy`, so a camera someone turns on in Slack is never received.
- `reconnectTimeoutMs` is 30 s, so a dropped connection ends as `connection-lost` after SPEC 20's 30 seconds. A first connection that never succeeds ends as `failed`.
- Chime's logger is off: its lines carry urls and join tokens.
- **Microphone.** When it cannot start (access off, no device), the call goes on with a silent input and muted, so the user can listen. Unmuting is refused until access is back, and the user stays muted then (SPEC 20). A permission change or `listDevices()` tries again.
- **Voice Focus.** On by default. `join` checks support first; when supported, the device controller runs Web Audio and the model loads after the call starts, then the microphone is restarted through it. When it is unsupported or fails to load (for example a CSP that blocks `*.sdkassets.chime.aws`), the call goes on without it and `noiseSuppression` reads `unsupported`.
- Slack also rewrites TURN UDP port 3478 to 22466 (research section 1). Juno does not; the spike connected without it.

The integration has to allow, in the renderer's CSP: `connect-src` for Chime's `wss:` and `https:` hosts, and for Voice Focus `script-src`/`worker-src` `https://*.sdkassets.chime.aws` with `'wasm-unsafe-eval'`. Main has to grant the microphone permission to Juno's page.

## The fake

`createFakeMediaSession({ autoConnect, microphones, speakers, microphoneAccess, noiseSuppression })` implements `MediaSession`; `join` connects at once unless `autoConnect` is false. The test drives the rest: `addRemote({ userId, attendeeId?, muted? })`, `removeRemote(id)`, `setSpeaking(id, on)` (the local attendee too; the latest to start is the active speaker), `setRemoteMuted(id, muted)`, `setConnection('connecting' | 'connected' | 'reconnecting')` (only `connected` sends), `setSending(on)`, `end(reason)`, `setMicrophoneAccess(access)`, `setDevices({ microphones, speakers })`, and for phase 4 `startShare(userId)` and `stopShare(userId)`.

## Tests

`test/rules.test.ts` covers the pure rules (the `ExternalUserId` parse and the stop code mapping), `test/snapshot.test.ts` snapshot identity, and `test/fake.test.ts` drives the fake's timeline. The Chime session itself runs against real Chime only in `scripts/huddle-live.ts`, which now uses it.
