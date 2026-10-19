# Huddles plan

October 2026. Started 2026-10-18. Inputs: `docs/research/slack-huddles.md`, architecture sections 2, 3, 6, 7 and 15, `performance.md`, `docs/research/screen-share-detection.md`, and the code on `main` at `3d7b9c9d`. Not started; the owner says when.

## How we work

- One step at a time, with no wide fan-out. Each step is a small set of small commits on the branch `t3/scope-slack-huddles`.
- Design is finished and signed off first, so the build can go on while the owner is away.
- Codex (GPT-6-Astra) reviews anything we are not confident in: the Quint spec, the engine's call lifecycle, the socket-events seam and the request-shape change. Claude reviews UI and design.
- The spike (phase 2) needs the owner: a private test channel and their phone as the second participant.

## 1. Scope

Juno joins and starts Slack huddles with audio, then screen share. A huddle in progress shows as a two-row bar at the top of the sidebar with quick toggles. The full huddle is a tab like any other.

Order of importance: audio, then screen share. Video is out of scope for now.

In scope:

- **Audio.** Start a huddle in a channel or DM, join a running one, leave. Mute and unmute. Choose the microphone and speaker. Who is in the huddle, who is speaking, who is muted. Chime's Voice Focus noise suppression. The "in a huddle" profile status. A dot on channels with a huddle running.
- **The sidebar bar.** Row 1: where the huddle is, who is in it, how long it has run. Row 2: mute, screen share (once phase 4 lands), leave, and open the tab. It shows only while the user is in a huddle.
- **The huddle tab.** A new tab kind. Participants with speaking and muted state, the controls, and the shared screen when someone shares.
- **Screen share.** First, watch what others share (up to two at once, as Slack allows). Then share your own screen or window. Juno's own capture may switch on privacy mode through `screenWatch`; the owner accepts that.
- **The huddle's chat.** It is already a Slack thread (`huddle_thread`), so it shows as a topic. Opening it from the tab is a link to that topic.

Out of scope:

- **Video.** Camera, tiles and background effects.
- **Everything carried in Slack's protobuf peer messages:** reactions, raised hands, drawing on a shared screen, mute requests, music, the awareness channel, transcript catch-up. Juno does not send or read them.
- Recording and AI notes, captions, knocks, external guests, scheduled huddles, multi-device join, ringing for incoming invites, a separate huddle window, the post-call survey.
- **A performance budget for a live call.** The idle budgets in `performance.md` do not apply while a huddle runs. We first make it work, then measure. The budgets that still apply: cold start, tab switch and sidebar frames must not regress when no huddle runs, and the Chime SDK loads only on join (the initial bundle is at 1,068 KB of 1,100 KB).

## 2. How it works

From the research:

1. **Region.** Before joining, the renderer asks Chime for the nearest media region (`GET https://nearest-media-region.l.chime.aws`).
2. **Join.** The engine calls `rooms.join` with `channel_id`, an optional `thread_ts` and `regions`. The answer holds `call.call_id` and `call.free_willy.{meeting, attendee}`.
3. **Media.** The engine sends the meeting and attendee to the renderer. The renderer passes them to `new MeetingSessionConfiguration(meeting, attendee)` in the open-source Chime SDK and talks to Chime directly. Slack's session never leaves the engine.
4. **Live state.** Other people joining, leaving and starting huddles arrive as `sh_room_join`, `sh_room_leave`, `sh_room_update` and `huddle_start` frames. Running huddles per channel come from `huddles/info` and `huddles.activeChannels` after each connect.
5. **Leave.** Leave stops the page's media and sends `rooms.leave` at once; the stored record is cleared only once the media is known stopped (and its request has gone out). `rooms.leave` carries `channel_id`, `call_id`, `attendee_id` and `reason=user_initiated`, and its answer is not awaited. On a workspace with `huddles_arch_v2` Slack answers `feature_not_enabled` and learns of the leave from Chime, so the Chime stop is the leave that counts there (research section 6).

**Requests look like the official client's.** For the huddle methods Juno sends the same query parameters, form fields and `_x_reason` values as Slack's desktop client (for example `calls-api/joinRoom`). Today `packages/slack/src/client/api.ts` omits some parameters (`_x_desktop_ia`, `_x_gantry`, `_x_frontend_build_type` and others). The spike records a real `rooms.join` from Slack desktop in the test channel and copies its shape. The change goes in `api.ts`, the one place the file says it may go.

**Where the code runs:**

- The engine owns the huddle's state: the call id, the attendee id, participants, running huddles, and the leave that must be sent. It does all Slack I/O.
- The renderer owns the media session. WebRTC needs a Chromium page, and the stream must sit in the same renderer as the elements that play and show it. The session is a service outside React, started at the app root, so switching or closing tabs never touches it. This is a recorded exception to "the renderer is UI only".
- Main adds a permission handler (microphone for Juno's own page only, then display capture), a display-media handler for screen share, and the entitlements and usage strings.

## 3. Packages

All new logic lives in three new packages. Existing code changes only at the registration points listed in section 4.

| Package | Job | Depends on |
| --- | --- | --- |
| `@juno/huddle` | Engine side. The `Huddle` service: a state machine for the call (idle, joining, joined, leaving), `rooms.join` and `rooms.leave`, the leave that must happen, participants from room frames, running huddles per channel, status renewal every 4 minutes or so. Decodes its own frames from the socket. Its route handlers and its attachment to `SocketEvents` are in `engine/src/huddle/`, since they use the engine's serve helpers and store. | `slack`, `slack-schema`, `contract` |
| `@juno/huddle-media` | Renderer side. A `MediaSession` interface with two versions: Chime and a fake for e2e tests. Join with meeting and attendee, mute, devices, active speaker, volume, remote content share, local content share. A plain store (`subscribe`, `getSnapshot`), no Atom and no React. Loaded as a lazy chunk on join. | `amazon-chime-sdk-js` only (it needed nothing from `contract`) |
| `@juno/huddle-views` | Dumb views with fixtures: `HuddleBar`, `HuddlePage`, the participant row, the shared-screen stage, the channel header button, the channel dot. | `ui`, `tokens` |

Also new, but in existing places:

- Schemas for `rooms.join`, `rooms.leave`, `huddles.activeChannels`, `users.profile.set` (huddle fields) and the `sh_room_*` and `huddle_start` frames. These go in a new `slack-schema/src/huddles.ts`, plus one line in `Methods`.
- `contract/src/routes/huddle.ts`: live values for the current call and the running huddles, and commands for start, join, leave and mute state.
- `state/src/huddle.ts`: atoms over those routes. Only `@juno/state` imports Atom (architecture 15).
- Containers in `apps/desktop/src/renderer/containers/huddle/`. They wire the engine's atoms and the media store to the views.
- `fake-slack`: `rooms.join` returns a fake meeting, plus `rooms.leave`, room frames and the controls `startHuddle`, `joinHuddle` and `leaveHuddle` for other users. The e2e tests use the fake `MediaSession`, so no test talks to Chime.
- `specs/huddle.qnt` (section 6).

## 4. Seams refactor (proposed, before huddles)

Today a feature like this touches about 15 existing files. Most of those touches are fine: one line in `engine/src/layer.ts`, one in `contract/src/routes/index.ts`, one in `slack-schema` `Methods`. Four seams are not. Each is a hand-written switch or a single hook that every new feature has to edit:

1. **Tab kinds.** `Place` lives in `state/src/tabs.ts`. Code branches on `place.kind` in 18 files across state, views and the renderer: `Workspace.tsx` (a ternary chain in `stripTab` and a switch in `Page`), `navigation.ts`, `paletteCommands.ts`, `Sidebar.tsx`, `Settings.tsx` and others. **Change:** a `tabKinds` table in the renderer, with title, icon and lazy page for each kind. `stripTab` and `Page` read from it. A new kind becomes one union member, one `PlaceJson` case and one table entry. The union stays closed, so the compiler still checks every kind.
2. **Sidebar top.** The sidebar view has fixed slots. **Change:** a generic `top` slot under the titlebar that takes the elements to show, and a list in the Sidebar container that features add to. The huddle bar becomes one entry, and the next feature's bar another.
3. **Socket events.** `sync` has one `onEvent` hook, combined by hand in `engine/src/session/SyncRunner.ts:91` for notifications and activity. **Change:** a `SocketEvents` service in the engine that publishes every `SocketEvent`. Any engine service subscribes to it in its own layer. `SyncRunner` stops knowing who listens. Notifications and activity move onto it. The huddle service subscribes without touching sync.
4. **Fake Slack features.** `fake-slack` has one `handlers` object and an inline control table in `index.ts`. **Change:** a feature module shape, `{ methods, controls }`, merged at startup. Huddle fakes become a file of their own.

This is deliberately not a plugin system. Juno is one app, built together. Runtime loading and open unions would cost type checking and add indirection, and nothing needs them. The aim is that each seam has exactly one registry, and a feature adds one line there.

After the refactor, adding huddles edits these existing files, each by a line or a case: `tabs.ts` (union and `PlaceJson`), the tab table, the sidebar list, `layer.ts`, `routes/index.ts`, `Methods`, the fake-slack feature list, and in main a `media.ts` registered from `index.ts`, plus `electron-builder.yml` and `entitlements.mac.plist`. Architecture section 15 gets a short "Seams" list so the next feature knows where to plug in.

Each seam is a small task on its own, with no behaviour change. Seams 1 and 2 edit hot renderer files, so they wait until no other agent is working in `Workspace.tsx` and `Sidebar.tsx`.

## 5. Phases

### Phase 0: seams refactor

Four tasks, one per seam, in parallel once the hot files are free. Existing e2e tests cover them; no new tests.

### Phase 1: design

Done and approved on 2026-10-19.


A design engineer agent writes the huddle section of SPEC.md, replacing "Not designed yet: calls and huddles" at line 787, with matching entries in `inventory.md`, `tokens.md` and `primitives.md`. It builds the views in `@juno/huddle-views` with gallery fixtures for every state:

- the bar (alone, two people, five people, someone speaking, muted, someone sharing, reconnecting)
- the tab (audio only, one share, two shares)
- the channel header button and the channel dot
- permission denied, join failed and the huddle ended

UI copy follows SPEC section 17. A better-interface review closes it, and the owner signs off before phase 3 wires it up. This phase runs alongside phases 0 and 2.

### Phase 2: spike (go or no-go)

The goal is to prove that Juno can join from its own session. In a private test channel made for it, with the owner's phone as the other participant:

1. Record a real `rooms.join` and `rooms.leave` from Slack desktop: request shape and response fields only, no token values.
2. Call `rooms.join` from Juno's engine with the same request shape.
3. Hand the result to the Chime SDK in Juno's renderer.
4. Hear audio both ways, then leave cleanly.

This also answers four unknowns from the research:

- whether the server checks which client is calling
- whether Chime cares about Juno's page origin
- the `ExternalUserId` format, which maps a Chime attendee to a Slack user
- the real shape of the `sh_room_*` frames

It updates `slack-huddles.md` with what it saw. If the server rejects Juno after the request shape matches, we stop and rethink.

### Phase 3: audio

Four parallel tracks, then one integration task:

- **A. Schemas and fakes.** `slack-schema/src/huddles.ts`, the fake-slack huddle module and its controls.
- **B. Engine.** `@juno/huddle`, `contract/src/routes/huddle.ts`, `specs/huddle.qnt`, and unit tests for the pure rules (participant merge, the leave that must happen).
  - The pending leave is stored in the workspace's user.db as the pref `huddle.pendingLeaves`.
  - Each renderer page's media service asks main for a page generation when it starts (`huddle.register`); main gives them out in rising order. Main tells the engine which generations are live and the highest it gave out (`huddlePages`), at the engine's `ready` and on every change, and drops one when its page commits a new document, its renderer process goes, or it is destroyed. `huddle.start` carries the generation; the engine holds a Start back while its generation is above the highest main has reported, and hands nothing to a Start whose engine connection closed before Slack answered. The page sends its whole media state with `huddle.report` (the session it holds, the last credentials it received, connection, mute, the last session it ended and why, and a sequence number) on every change and every time its engine connection opens. The engine keeps the latest report per page with the connection it came on, and computes from it, main's report and each hand-off's connection whether an attendee's media is stopped. At boot it reads every workspace's stored leaves and sends no join until all are read. Leave stops the page's media and sends `rooms.leave` at once; the stored record is cleared only once the media is known stopped (and its request has gone out); no timeout assumes a stop.
  - The "In a huddle" status, as the official client keeps it: while the call is live, `users.profile.set` with `profile` `{"huddle_state_expiration_ts": <now + 300 s>}` and `_x_reason` `increment-huddle-state-expiration-ts`, at once and then every 240 s ±10%. The client writes no other field (Slack sets `huddle_state` and `huddle_state_channel_id` itself) and sends no clearing write on leave, so the status lapses at its expiry.
- **C. Media.** `@juno/huddle-media` with Chime and the fake. Region lookup, mute, devices, active speaker, Voice Focus.
- **D. Views.** Finish the phase 1 views against the final routes.
- **E. Integration.**
  - The `huddle` tab kind, the sidebar bar entry, the channel header button and dot.
  - `state/src/huddle.ts` and the containers.
  - Main: `media.ts` (permission handlers), `NSMicrophoneUsageDescription`, the `com.apple.security.device.audio-input` entitlement, and a leave on quit, asked first while in a huddle (`main/huddleQuit.ts`, from the engine's `huddle` message).
  - e2e specs against the fake: start, join, mute from the bar, open the tab, someone else joins and leaves, leave, and quit during a huddle.
  - Built on the branch `huddle-app` (2026-10-19) as an early build for the owner's feedback: all of the above, with ⌘⇧Space in the page and the "joined on another device" toast with Join here. The Huddle menu and its ⌘K entries and the join and leave sounds followed on 2026-10-20. Leaving after 10 minutes alone followed the same day (`@juno/huddle`'s `alone.ts`). So did Mute's link to System Settings while macOS blocks the microphone (`huddle.microphoneSettings`), and the switch toast ("Left the huddle in #design"). A huddle's people the store lacks are named through the sync's `nameUsers`, as an opened topic's senders are.

The owner then checks with real people in the test channel.

### Phase 4: screen share

- **Watch first.** Built on 2026-10-20 (branch `huddle-watch-share`): remote content share in the media package, the stage in the tab, and the bar showing who is sharing. No new permissions. Chime receives only others' `#content` streams that a tab shows (`ContentOnlyDownlinkPolicy`). Who shares comes from the `#content` attendee's presence, which arrives before the video; the engine does not read the room frames' `participants_screenshare_on`, whose meaning the research has not recorded. The fake media session plays a drawn test pattern for e2e.
- **Share second.** Built on 2026-10-20 (branch `huddle-own-share`). Main lists the screens and windows with `desktopCapturer.getSources` (`huddle.shareSources`, `main/screenShare.ts`: JPEG thumbnails at 480 by 300 or smaller, Juno's own windows filtered out, a screen named by its display). The share sheet is a lazy chunk opened from Share screen in the bar and the tab, Huddle › Share Screen… and ⌘K. The page captures with `getUserMedia` and `chromeMediaSource: 'desktop'` (at most 1920 by 1080 at 15 fps, since the research did not record Slack's limits) and sends it as Chime content share (`ownShare.ts`); `main/media.ts` allows that capture for Juno's own page only. macOS says only whether Juno may record the screen, so main remembers in `launch.json` that it showed the Screen Recording prompt once (`screenRecordingAsked`); no entitlement or usage string is needed. Privacy mode may switch on while sharing; accepted. System audio stays out. A shared window is previewed in the user's own tab from the captured stream itself (no second capture); a shared screen is not (SPEC 20). The fake media session shares a drawn pattern, and main's sources and permission are drawn and set by the test under JUNO_E2E.

## 6. The Quint spec

`specs/huddle.qnt` models the call's lifecycle between the user, the engine, Slack and the socket. That means the user's join and leave, the `rooms.join` and `rooms.leave` requests and answers, room frames, socket reconnects, and an app quit or crash. The properties:

- **No ghost.** Every attendee id Juno has durably received gets a `rooms.leave` and a stopped Chime session, even if the app quits or crashes. The engine stores the pending leave before it hands media the credentials, and sends any stored leave on the next start. With `huddles_arch_v2` the stored leave does nothing, and after a crash Chime drops the attendee on its own (research section 6).
- **One call.** At most one call is live at a time. Joining another huddle leaves the current one first.
- **Leave during join.** A leave asked for while a join is in flight ends with no live call and a leave sent for the attendee the join returns.
- **No stale leave.** A late room frame for an earlier attendee or room never ends the current call. Live frames identify a user, not an attendee, so they trigger a refetch rather than ending local media.
- **Matching state.** After a reconnect or `Overflowed`, the running huddles shown match Slack's once a fresh `huddles/info` answers and Slack stays quiet. Discard responses invalidated by a later gap or frame.
- **Other device.** After the renderer reports `AudioJoinedFromAnotherDevice`, clear the current call and queued join intent. Do not reconnect media without a new user command.

Cleanup assumes an eventual leave/quit/crash, restart and successful delivery. Receipt and the durable pending-leave write are one model step: a crash between HTTP receipt and persistence cannot preserve an unknown attendee id. The implementation must keep credentials private until that write commits. See `specs/README.md`, “Huddle lifecycle”, for the checked bounds and remaining assumptions.

The checker runs in `pnpm specs:check` like the other specs.

## 7. Risks

- **Slack starts checking clients.** The spike settles this for today. If Slack adds checks later, huddles stop working until we match again. Copying the official request shape is the defence, and the failure is the same as for every other method Juno calls.
- **Flags change behaviour.** For example, `huddles_arch_v2` moves the leave to another path. The spike records which flags the owner's workspace has, and the engine reads those flags from boot data.
- **Slack clients treat Juno as an odd participant** because it never answers `capabilities` peer messages. The likely effect is that reactions and drawings are hidden for Juno only. We accept that, since peer messages are out of scope.
- **Ghost participants after a crash.** Section 6 covers this; Slack also times them out.

## 8. Decisions already made

These are recorded in the decision log on 2026-10-18:

- Scope and order: audio, then screen share. Video and all peer-message features are out.
- Huddle requests copy the official client's request shape.
- The media session runs in the main renderer, outside React.
- No live-call performance budget yet.
- Juno's own screen share may turn on privacy mode.
- A Quint spec for the call lifecycle.

Open for the owner: whether to do the seams refactor (section 4) before huddles.
