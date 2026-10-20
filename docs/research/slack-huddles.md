# How Slack huddles work

Reverse-engineering notes for scoping huddles in Juno. Target: Slack desktop 4.52.178 (Electron) and the web client it loads (gantry-v2, `data-build-number="134567"`, `data-version-ts="1792141056"`). Analysed 2026-10-18.

Sections 0 to 5 are static analysis: Slack was not launched, no huddle was joined and no network call was made. Section 6 records the live spike of 2026-10-19 (`scripts/huddle-live.ts`). No token, cookie or message content is reproduced here; only method names, field names and code shapes. Claims are marked **observed** (read in shipped code), **inferred** (a reasonable reading of observed code) or **unknown**.

## 0. Sources and method

- Shell: `/Applications/Slack.app/Contents/Resources/app.asar` extracted to `/Volumes/AgentWork/scratch/slack-huddle-rea/asar`, bundles prettified into `.../pretty/`. Line refs `main:N` and `preload:N` point at those prettified copies (`main.bundle.cjs`, `preload.bundle.js`). Native addon strings read with `strings` from `app.asar.unpacked`.
- Web client: most huddle code is not in the asar. It came from the user's own caches under `~/Library/Application Support/Slack`:
  - Service Worker CacheStorage (newest bucket `c23111d0-...`, 640 entries, bodies already decoded). The 545 `a.slack-edge.com/*.js` entries were copied to `.../web/`.
  - The HTTP cache (`Cache/Cache_Data`, Chromium simple-cache, brotli bodies) for the main bundles not in the SW cache. A 24-byte header, then the key, then the body up to the EOF magic `d8410d97456ffaf4`; bodies were brotli-decoded into `.../web/` and `.../webhttp/`. Tools in `.../tools/`.
- Only JS bundles were copied. No IndexedDB, Local Storage, cookies or API responses were read.
- Short names used below:
  - `shared` = `gantry-v2-shared.3b03bc2a28796cb1.min.js` (5.4 MB)
  - `shared-client` = `gantry-v2-shared-client.b302cf999efc4a84.min.js` (2.1 MB; the huddle media session, orchestrator, Chime wrapper)
  - `boot-async` = `gantry-v2-async-gantry-v2-shared-boot-async.1c911ef5c39b7787.min.js` (31 MB; RTM handlers, join thunks, UI)
  - `vendors-client` = `gantry-v2-vendors-client.5280278c71ca8329.min.js` (per-method fetcher registry and the stable Amazon Chime SDK)
  - `chime-exp` = `gantry-v2-async-amazon-chime-sdk-js-experimental.6c89da9d6895ec49.min.js`
  - Lazy huddle UI chunks: `client-huddle-view`, `client-huddles-view`, `client-channel-huddles-view`, `client-huddle-thread-view*`, `client-huddle-screenshare-popout-view`, `huddle-files-view`, `client-huddle-transcript-details-view`, `open-huddle-window-mva`, `video-effects`, `tasks-vision-wasm`.

## Summary

Huddles run on the **Amazon Chime SDK for JavaScript (3.32.0)**, inside the web client renderer, over standard WebRTC. Slack's backend creates a Chime meeting and attendee and returns them from **`rooms.join`** (field `call.free_willy.{meeting, attendee}`, Chime's own PascalCase shapes). The client feeds those straight into `new MeetingSessionConfiguration(meeting, attendee)` and then talks to Chime's signalling and TURN servers directly. Slack's own API covers the room lifecycle (`rooms.*`, `huddles.*`, `screenhero.rooms.*`), and huddle presence reaches other clients through RTM events `sh_room_join`, `sh_room_leave`, `sh_room_update`, `huddle_start` and friends, plus the edge API `huddles/info` and `huddles/list`. In-call extras (reactions, raised hands, drawing on shared screens, mute requests, music) are Slack's own protobuf messages sent over Chime's data channel. Screen share is Chime content share, captured through Electron's `desktopCapturer` source IDs; two people can share at once. The Electron shell only adds small helpers: media permission prompts, screen thumbnails, a native border around the shared window, native audio device lists and the macOS mic mode. There is no proprietary native media engine. A third-party Electron client could in principle join a huddle with the open-source Chime SDK and the user's own session. The hard parts are Slack's undocumented protobuf peer protocol, many feature flags, and the unknown server-side checks on `rooms.join`.

## What Juno uses from this

Owner decisions of 2026-10-18; the build plan is `docs/plans/huddles.md`.

- **Used:** `rooms.join` and `rooms.leave` (section 2), the Chime SDK for audio and content share (sections 1 and 3), room frames and `huddles/info` for participants and running huddles (sections 2 and 4), Voice Focus, and the `users.profile.set` status renewal.
- **Not used:** everything in the protobuf peer protocol (reactions, raised hands, drawing, mute requests, music, awareness, transcript catch-up), video and its effects, recording, captions, knocks, external guests, scheduled huddles, multi-device, the separate huddle window. Decoding the peer-message descriptors (step 5 of the runtime checks) is no longer needed.
- **Requests:** Juno sends the huddle methods with the same query parameters, form fields and `_x_reason` as the official client, recorded from a real `rooms.join` in the spike. This answers the first unknown by matching it, not by probing which fields matter.
- **Screen share and privacy mode:** Juno's own capture may trip `screenWatch` (`screen-share-detection.md`) and turn on privacy mode. Accepted.

## 1. Media stack

### Observed

- **Amazon Chime SDK JS.** `vendors-client` has the full SDK (`semverString:"3.32.0"`, classes `DefaultAudioVideoController`, `DefaultContentShareController`, `NoOpAudioVideoController` with `urls.signalingURL="wss://localhost/"`). `chime-exp` is a second, experimental build loaded when the `calls_chime_sdk_exp` flag is on (`shared-client`: `async function setUseExpSDK(e){... i.e("amazon-chime-sdk-js-experimental") ...}`, and `sdkVersion}${e.useChimeSdkExp?" (Experimental)":""}`).
- Classes Slack uses from the SDK (`shared-client`, module `uSb7`): `DefaultMeetingSession`, `MeetingSessionConfiguration`, `DefaultDeviceController`, `DefaultMeetingReadinessChecker`, `VideoPriorityBasedPolicy`, `NScaleVideoUplinkBandwidthPolicy`, `VoiceFocusDeviceTransformer`, `BackgroundBlurVideoFrameProcessor`, `BackgroundReplacementVideoFrameProcessor`, `VideoFxProcessor`, `ContentShareConstants`, `DefaultModality`.
- Session set-up (`shared-client` near `this.meetingSessionConfiguration=new eC.QJ(this.meeting,this.attendee)`): `enableSVC=true`; simulcast optional; `disablePeriodicKeyframeRequestOnContentSender=true`; a `urlRewriter` that drops TURN URLs by transport (`transportProtocols` from the server: udp, tcp, tls) and rewrites TURN UDP port `3478` to `22466` unless flag `huddles_use_udp_port_3478` is on (`TURN_PORT_UDP=3478`, `OVERRIDE_TURN_PORT_UDP=22466`). A "dual UDP" mode returns both ports.
- Region: before `rooms.join` the client asks Chime for the nearest media region: `fetchNearestChimeMediaRegion` GETs `https://nearest-media-region.l.chime.aws` (or `https://nearest-us-gov-media-region.l.chime.aws/` for GovSlack) and reads `.region`; cached in local storage under `ChimeRegionStorage-chimeRegionCache` (`shared-client`, module `S9Ck`).
- Noise suppression: **Amazon Voice Focus** (Chime's WASM model), with a capability cache in local storage and flags `huddles_voice_focus_model_ladder`, `huddles_voice_focus_swap_timeout`. Boot HTML CSP allows `script-src ... 'wasm-eval' 'wasm-unsafe-eval' https://*.sdkassets.chime.aws` for those assets. No Krisp or RNNoise in huddle code (the only `Krisp` hits are in LiveKit inside `elevenlabs-client`, unrelated).
- Video effects: Chime background blur and replacement (`https://static.sdkassets.chime.aws/bgblur/models/selfie_segmentation_landscape.tflite`, `.../background_segmentation/otherassets/background-segmentation-processor.js`) plus MediaPipe chunks (`tasks-vision-wasm`, `vision_wasm_internal.*.bin.js`, `selfie_segmentation_solution_*_wasm_bin.*.bin.js`, `video-effects`).
- **No native media engine.** The app bundle has no media `.node` addon or dylib beyond Electron's `libffmpeg.dylib`. The only native piece touching calls is `@tinyspeck/slack-desktop-utils` (`slackdesktoputils.node`), which exports `huddles.WindowBorderPanel` (screen-share border), `audio.enumerateAudioDevices`, `audio.getAudioDeviceDetails`, `audio.getMicrophoneMode`, `canInitAudioDeviceWin`, and a `startVoiceIsolatedCapture` (`com.slack.voice-isolation.capture`, "voice isolation is not active; ask the user to enable it in Control Center -> Mic Mode"). The shell JS never calls `startVoiceIsolatedCapture` (0 hits in `main`/`preload`); it only calls `getMicrophoneMode` (`main:78092`).
- Older backend path still in code: `handleCallAPIResponse` (`shared`) maps a response without `free_willy` to a legacy "calls server" shape: `{token, tokenExpiry, hostname, port, turn:{username, password, ports}}`.

### Inferred

- "Free Willy" is Slack's internal name for the Chime-backed huddle backend (`media_backend_type` on rooms, timing mark `huddle_time_free_willy_sdk_init`, `convertFreeWillyConnectionQuality`). The legacy path is the pre-Chime Slack Calls server, likely dead for huddles.
- Media goes to Chime's SFU (Chime meetings are SFU-based), not peer to peer.

## 2. Signalling and control API

### Observed: Web API methods

All go through the normal `apiCall` (same `/api/<method>` POST with the `xoxc` token and `d` cookie described in `slack-data-access.md`). Fetchers are registered in `vendors-client` as `(0,m.r)("roomsJoinFetcher","rooms.join")` etc.

| Method | Use (from the calling thunk) |
| --- | --- |
| `rooms.join` | Start or join. Args: `id` (room, optional), `channel_id`, `thread_ts` (huddle in thread), `regions` (nearest Chime region), `multidevice`. Reason `calls-api/joinRoom` (`boot-async`, thunk "Join a calls / huddle room"). |
| `rooms.leave` | Args `channel_id, call_id, attendee_id, reason`. A user's leave sends `reason:"user_initiated"` (`userLeaveEffects` in `shared-client`); it is also sent as a `sendBeacon` on `beforeunload` with `reason:"unload"`. Benign errors: `channel_not_found, room_not_found, invalid_channel_id, attendee_not_found`. `feature_not_enabled` is logged as a warning, "rooms.leave arch mismatch", not an error. With `huddles_arch_v2` the same call goes through `apiCallPersisted` (module `jKdt`), which queues it while offline; method, args and `_x_reason` do not change. See section 6. |
| `rooms.notifyMember` | Ring a member: `channel_id, user_id`. Errors include `huddle_not_found`, `user_is_external_guest`, `cannot_invite_external`. |
| `rooms.inviteResponse`, `rooms.getLink` (`channel_id`), `rooms.request`, `rooms.appOptions.list` | Invites, huddle link, third-party call apps. |
| `rooms.startTranscription`, `rooms.stopTranscription` | Captions. |
| `screenhero.rooms.info` | Room by id: `room` arg, returns `{room}` ("huddles-call-info"). |
| `screenhero.rooms.rename` | Huddle topic: `room, room_name`. |
| `screenhero.rooms.join`, `.invite`, `.refreshToken`, `.userEvent`, `.proxyLogs`, `.proxyAnalytics`, `.proxyMeetingEvents` | Older Screenhero-era names; some still used for logs and events. |
| `huddles.get`, `huddles.history`, `huddles.update`, `huddles.readiness`, `huddles.getIndirectHuddle`, `huddles.getTrackUrls` | Huddle records, history page, music tracks. |
| `huddles.knock`, `huddles.knockResponse`, `huddles.cancelKnock` | Knock to join. |
| `huddles.listBackgrounds` | Video backgrounds. |
| `huddles.recording.start`, `.cancel`, `.setLanguage`, `.auditLog` | AI notes / recording. |
| `huddles.scheduled.new` | Scheduled huddles. |
| `huddles.external.new`, `.generate`, `.linkInfo`, `.listExternalParticipants`, `.kick`, `.end` | External guests by link. |
| `calls.request`, `calls.reject`, `calls.apps.list` | Legacy calls and call apps. |
| `meetings.channel.getOrCreate`, `meetings.update`, `meetings.removeChannel`, `meetings.transcribeChunk` | Calendar meeting channels. |
| `users.profile.set` with `huddle_state_expiration_ts` | Keeps the "in a huddle" status alive (every ~240 s ±10%, sets expiry now+300 s; flag `huddles_set_status`). The profile is one JSON field, `{"huddle_state_expiration_ts": <seconds>}`, the only field written, with reason `increment-huddle-state-expiration-ts`. It starts when the call reaches `STARTED`; on `ENDING` or an error the timer is cancelled and nothing is sent, so the status lapses at the expiry (`scheduleHuddleStateExpirationIncrement`, `boot-async`). |

Edge (Flannel) API: `HUDDLES_INFO:"huddles/info"` (query `channel_ids`, chunks of IDs, concurrency 2) and `HUDDLES_LIST:"huddles/list"` (`shared`, method map next to `MEMBER_INFO:"users/info"`). The response feeds `upsertKnownHuddlesForTeamId`, which reads `{channel_id, call_id, active_members, dropped_members}` per huddle. After a reconnect the client re-fetches huddles for every channel in `huddles.activeChannels`.

### Observed: join response

From the `rooms.join` thunk (`boot-async`):

```js
.then(e=>({server:(0,p.YY)(e.call), roomId:e.call.call_id, ..., channelId:e.huddle?.channels[0],
  ...e.canvas&&e.canvas.root_thread_ts&&{rootThreadTs:e.canvas.root_thread_ts},
  ...e.canvas&&e.canvas.canvas_file_id&&{canvasFileId:e.canvas.canvas_file_id}}))
```

and `p.YY` (`shared`):

```js
function callsServerCreateOrJoinRoomResponseType(e){return{meeting:e.free_willy.meeting,attendee:e.free_willy.attendee,...e.survey&&{survey:e.survey}}}
```

So the response holds `call.call_id`, `call.free_willy.meeting` (Chime `Meeting`: `MeetingId`, `ExternalMeetingId`, `MediaPlacement.{AudioHostUrl, SignalingUrl, TurnControlUrl, EventIngestionUrl}`, `MeetingFeatures`), `call.free_willy.attendee` (Chime `Attendee`: `AttendeeId`, `ExternalUserId`, `JoinToken`), optional `call.survey`, `huddle.channels[]`, `canvas.root_thread_ts`, `canvas.canvas_file_id`. The client checks `if(!e?.server?.meeting||!e?.server?.attendee)throw Error("create_meeting_failed")`, reads `attendee.AttendeeId` into its state, and gets the room id back from `meeting.ExternalMeetingId.split("-")[1]`. A `transportProtocols` field is read from the same server config. Join errors: `rooms_no_servers_available`, `rooms_invalid_channel`, `rooms_info_error`, `calls_disabled`, `rooms_region_mismatch`, `rooms_max_teams`, `rooms_invalid_room`, `rooms_invalid_parameters`, `room_max_participants`.

Room and call id formats (`shared`): call ids start with `R`; room ids start with `Vr` or `zt-`.

### Observed: RTM events

Registered in `boot-async` with `(0,r.d1)(type, handler)`:

- `sh_room_join`, `sh_room_leave`, `sh_room_update` → `updateCallState` → `updateHuddleRtmHandler` when the event has a `huddle`. Event fields read: `type`, `user`, `huddle.channel_id`, `room` (full room object, below), `room.knocks`, `room.last_invite_status_by_user`, `room.pending_invitees`, `room.has_ended`, `room.participants`.
- `huddle_start`, `huddle_invite`, `huddle_invite_cancel`, `huddle_recommend`, `room_update`, `ended_huddle_update`, `call_block_updated`, `ai_automatic_huddle_notes_error`.
- Message subtypes `sh_room_created` and `sh_room_shared` carry a `room` object on the channel message (`slurpCalls` in `shared`).

Room object as normalised by `convertRtmRoomMessageForRedux` (`shared`, module `Ero4`): `id, name, created_by, is_dm_call, channels, date_start, date_end, participants, participant_history, missed_participants, media_backend_type, has_ended, canvas_thread_ts, background_id, was_missed, was_rejected, was_accepted, is_prewarmed, is_scheduled, expiration, locale, recording{transcript, summary, notetaking, is_paused, summary_status, can_record_summary, recording_type, cancellation_reason}`.

### Observed: client state machine

`HuddleSessionOrchestrator` (`shared-client`) is an event-driven state machine: states include `NOT_STARTED`, `PENDING`, `PRE_JOINED`, `STARTED`, `ENDING`, `SURVEY`; events include `JOIN_REQUESTED`, `PREJOIN_HANDOFF`, `CREDENTIALS_RECEIVED`, `CONNECTION_FAILED`, `DISCONNECTED`, `MEDIA_CONTROL_REQUESTED`, `LEAVE_WITH_SURVEY`; sub-states include `IN_PROGRESS_ALONE` and `IN_PROGRESS_ALONE_NOTICE_ACTIVE`. Timeouts of 60 s and 10 s guard joins. "Quick join" prefetches credentials (`huddle_quick_join_credentials_received`), and "pre-join" opens a signalling-only Chime session before the user commits.

### Inferred

- A Chime `JoinToken` is the only credential needed to connect media. Chime signalling (`wss://...chime.aws`) does not see the Slack session.

## 3. Screen share, video and the Electron shell

### Observed: web client

- Screen share is Chime **content share** (`DefaultContentShareController`, an extra attendee with modality `#content`). On desktop it captures with `getUserMedia({video:{mandatory:{chromeMediaSource:"desktop", chromeMediaSourceId:<id>, maxWidth, maxHeight, maxFrameRate}}})`, where the id comes from the shell's thumbnail list. In a plain browser it uses `getDisplayMedia({audio:false, video:{frameRate:{max:15}}})` (`shared-client`).
- System audio: when `shareAudio` is set, an audio track with `chromeMediaSource:"desktop"` is added (flag `huddles_screenshare_share_audio`, metric `system_audio_share_start`).
- Two sharers at once: UI copy "Two people can share their screens at the same time - maximum collaboration." (`boot-async`).
- Drawing on a shared screen: peer messages of type `draw` with `itemId` and Bezier `segment{a,b,c,d}` points, types new, edit, end, change-hue, position (`convertPeerMessageToDrawMessage`, `shared-client`). Icons `huddle_icon_drawing_on/off`.
- Popout window for a shared screen: chunk `client-huddle-screenshare-popout-view`; the huddle itself can live in a separate window (`open-huddle-window-mva`, `huddle_window_full`, `huddle_window_compact`, `huddle_miniplayer`).
- Video: Chime video tiles with `VideoPriorityBasedPolicy` downlink and `NScaleVideoUplinkBandwidthPolicy` uplink; client state `huddle_visible_video_subscriptions`.

### Observed: shell (main and preload)

- Bridge namespaces in `window.desktop` (`preload:37061-37147`): `calls` = `canInitAudioDevice`, `getVirtualCameras`, `getMediaAccessStatus`, `askForMediaAccess`, `getScreenPreviewThumbnails`, `getAudioDeviceDetails`, `getMicrophoneMode`, `enumerateAudioDevices`; `callsScreenshare` = `createBorderWindow`, `showBorder`, `hideBorder`, `setWindowOrScreenId`, `setWindowBorderWidth`, `setWindowBorderColor`, `setTimerIntervalMs`, `getWindowPositionAndDimensions`.
- `GET_SCREEN_PREVIEW_THUMBNAILS` → `desktopCapturer.getSources({types, thumbnailSize})`, capped at 480x480, returns `display_id, id, name, thumbnail.dataURL`, filtering out Slack's own windows (`main:78693-78716`).
- `ASK_FOR_MEDIA_ACCESS` → `systemPreferences.askForMediaAccess(type)` (`main:78982`).
- `setDisplayMediaRequestHandler` on the main session answers any `getDisplayMedia` with `desktopCapturer.getSources({types:["window","screen"]})[0]` and `audio:"loopbackWithMute"`, with `{useSystemPicker:true}` so macOS shows its own picker (`main:80164-80209`).
- `setPermissionRequestHandler` and `setPermissionCheckHandler` grant permissions (camera, microphone, display capture and others) only to Slack origins in the main frame of a known window (`v7`, `main:79755`).
- Chromium features enabled: `ScreenCaptureKitMac`, `ScreenCaptureKitPickerScreen`, `ScreenCaptureKitStreamPickerSonoma`, `ThumbnailCapturerMac:capture_mode/sc_screenshot_manager`. Disabled: `WebRtcHideLocalIpsWithMdns`, `HardwareMediaKeyHandling`, `IntensiveWakeUpThrottling` and others (`main:80354-80374`).
- Audio devices: native `enumerateAudioDevices` joined with `navigator.mediaDevices.enumerateDevices()` by an HMAC-SHA256 of the device unique id, salted with Chromium's `electron.media.device_id_salt` from the `Preferences` file and the page origin, so native and WebRTC device ids match (`main:78100-78147`, `preload:37072-37122`).
- Shell to web: `CLOSE_CALL` IPC calls `window.desktopDelegate.closeCall()` (`preload:38154`). The stealth-restart check (`STEALTH_RESTART_SAFE_RESPONSE`) accepts `reason:"huddle"`, so updates wait while a huddle runs (`main:61048`).
- Call sounds ship in the app: `calls_incoming_ring_v2.mp3`, `calls_you_joined_call_v2.mp3`, `calls_they_left_call_v2.mp3` and others.

## 4. Huddle UI state

### Observed

- **Participants:** from RTM room events (`participants`, `participant_history`) and from Chime attendee presence (`realtimeAttendeeIdPresenceCallback`, with a 60 s stale-attendee checker). Each Chime attendee maps to a Slack user through `ExternalUserId`.
- **Active speaker:** Chime active speaker detection with a windowed policy (`windowedActiveSpeakerPolicy`) and `realtimeSubscribeToVolumeIndicator`.
- **Mute:** local mute is `realtimeMuteLocalAudio`; remote mute state comes from Chime's volume indicator. A participant can ask another to mute through a `muteRequest` peer message (throttled to 50 per 10 s). Flags `huddles_mute_by_default`, `huddles_global_mute` (a global shortcut).
- **Peer messages:** protobuf over the Chime data channel. Topic `data-channel` carries `reacji`, `draw`, `muteRequest`, `kickNotification`, `contentShareDetails`, `capabilities`, `jukeboxRequest`. Topic `awareness-sync-channel` carries `awarenessBroadcast` (field name, value, timestamp per user). Topic `transcript-catchup` carries `transcriptCatchUp`. Messages over 2032 bytes are split.
- **Hand raise:** a sticker reaction with the raised-hand emoji (`isHandRaised`, `raisedHandSkinToneEmojiName`, `toggleHandRaise`, `useAutoLowerRaisedHand`, analytics `huddles_raise_hand` / `huddles_lower_hand`), sent as a `reacji` peer message of type sticker.
- **Huddle thread and chat:** the join response returns `canvas.root_thread_ts` and `canvas.canvas_file_id`; the room has `canvas_thread_ts`. Chunks `client-huddle-thread-view*` and `huddle-files-view`. The huddle chat is a thread on the huddle's channel message.
- **"Huddle in progress" on channels:** a `huddles.activeChannels` store keyed by channel with `callId`, filled from `huddles/info` and RTM room events. Channel properties `properties.huddles.is_huddle_channel`. Other users' status uses profile fields `huddle_state:"in_a_huddle"`, `huddle_state_channel_id`, `huddle_state_expiration_ts` (`getMemberCustomStatusHuddleChannelId`, `boot-async`).
- **Other features in the code:** captions (`huddles_captions`, `huddles_cc_by_default`), AI notes and recording, knocks, scheduled huddles, external guests, a music player ("jukebox"), backgrounds, special reactions with particle effects, post-call survey, troubleshooting panel, "lite mode" and audio-only mode.

## 5. What makes a third-party client hard

### Observed

- No proprietary media engine and no end-to-end encryption in huddle code (no `e2ee`, `sframe` or insertable-streams use in `shared-client`; the SDK's own `RTCRtpScriptTransform` code exists in `vendors-client` but Slack does not call it). Media security is Chime's DTLS-SRTP.
- The Chime SDK is open source (Apache 2.0), so Juno could ship the same SDK in its own renderer.
- Slack-specific layers sit on top of Chime: the protobuf peer protocol, the awareness channel, the transcript catch-up channel and the `ExternalUserId` mapping. None has a published schema. To show reactions and drawings from Slack users, or send them, Juno would need to recover the protobuf descriptors from `shared-client`.
- Behaviour is gated by many flags. About 60 `huddles_*` names (flags and analytics events together) appear in `shared-client` alone (for example `huddles_arch_v2`, `huddles_use_udp_port_3478`, `calls_chime_sdk_exp`).
- The shell's display-media handler and permission handlers only grant to Slack origins. Juno, as its own Electron app, would set its own handlers; this is not a blocker.
- `rooms.leave` must be sent with `attendee_id` on exit. Slack uses a `beforeunload` beacon. A client that crashes leaves a ghost participant until Chime or Slack times it out.
- The "in a huddle" status needs `users.profile.set` every few minutes.

### Inferred

- Joining is a `rooms.join` call with the user's own `xoxc` token and `d` cookie, the same path Juno already uses for other methods. No extra client header is visible in the thunk. Juno will still copy the official request shape in full (see "What Juno uses from this").
- A third-party client that joins without the peer protocol would still be heard and seen. It would not show reactions, raised hands or drawings, and might not answer `capabilities` messages as Slack expects. Juno accepts this: peer messages are out of scope.

## 6. Live spike (2026-10-19)

Run with `scripts/huddle-live.ts` on the owner's session, in a private test channel with one member. In the two runs recorded here Juno was alone in the huddle; a run with the owner's phone was in progress when this was written. Field names and shapes only; no values were printed.

### Observed

- **Join.** `rooms.join` with `channel_id`, `regions` (the nearest Chime region, one string) and `multidevice=false`, `_x_reason=calls-api/joinRoom`, through Juno's usual request shape, answered `ok`. The server did not reject Juno as a client.
- **Media.** The answer's `call.free_willy.meeting` and `attendee` went into `MeetingSessionConfiguration` in a Chrome page served from `http://localhost`. Chime reached `audioVideoDidStart`, and its volume indicator showed Chromium's fake microphone arriving at Chime. Chime does not check the page origin, at least for localhost.
- **`rooms.join` answer**, field names:
  - `call`: `call_id`, `survey_percent`, `free_willy.meeting` and `free_willy.attendee`.
  - `meeting`: `MeetingId`, `ExternalMeetingId`, `MeetingArn`, `MediaRegion`, `MeetingFeatures` (null), `MeetingHostId` (null), `PrimaryMeetingId` (null), `TenantIds[]`, `is_prewarmed`, and `MediaPlacement` with `AudioHostUrl`, `AudioFallbackUrl`, `ScreenDataUrl`, `ScreenSharingUrl`, `ScreenViewingUrl`, `SignalingUrl`, `TurnControlUrl`, `EventIngestionUrl`.
  - `attendee`: `AttendeeId`, `ExternalUserId`, `JoinToken`, `Capabilities.{Audio, Content, Video}`, `EventActions` (null).
  - `canvas`: `canvas_file_id`, `thread_channel_id`, `root_thread_ts`.
  - `huddle`: `id`, `name`, `created_by`, `date_start`, `date_end`, `participants[]`, `participant_history[]`, `channels[]`, `has_ended`, `huddle_link`, `thread_root_ts`, `background_id`, `external_unique_id`, `attached_file_ids[]`, `pending_invitees`, `last_invite_status_by_user`, `prototypes.{is_prewarmed, is_scheduled}`, `recording.can_record_summary`, `locale`.
- **Identities and times** (a third run, 2026-10-19, 30 s, booleans and units only): the `room.id` of `sh_room_join`, the `call_id` of `huddles/info` and the room part of `ExternalUserId` all equal the `call.call_id` of `rooms.join`. `room.date_start` and `huddles/info`'s `start_date` are epoch seconds.
- **`ExternalUserId`** has the shape `T` + 10 chars, `-`, `R` + 10 chars, `-`, `U` + 10 chars: team id, room id, user id. The third part is the joining user's id. There is no `#` session part.
- **Socket frames** for the room: `sh_room_join` on join, `huddle_invite_cancel` (`type, team_id, channel_id, event_ts`) right after it, and `sh_room_leave` on leave. `sh_room_join` and `sh_room_leave` have `type`, `user`, `huddle.channel_id`, `event_ts`, `ts` and a full `room`:
  - `id`, `name`, `media_server`, `media_backend_type`, `created_by`, `date_start`, `date_end`, `channels[]`, `is_dm_call`, `has_ended`.
  - `participants[]` (user ids), `participant_history[]`, and `participants_events.<user id>.{user_team, joined, camera_on, camera_off, screenshare_on, screenshare_off}`.
  - `participants_camera_on[]`, `participants_camera_off[]`, `participants_screenshare_on[]`, `participants_screenshare_off[]`.
  - `canvas_thread_ts`, `thread_root_ts`, `background_id`, `canvas_background`, `is_prewarmed`, `is_scheduled`, `recording.can_record_summary`, `locale`, `attached_file_ids[]`, `display_id`, `external_unique_id`, `app_id`, `call_family`, `pending_invitees`, `last_invite_status_by_user`, `knocks`, `huddle_link`, `was_rejected`, `was_missed`, `was_accepted`.

  On leave, `room.participants` is empty.
- **A huddle starting** was never seen as its own frame: the live runs saw `sh_room_join` with the whole room (its `created_by` and `date_start` included) and `huddle_invite_cancel`, and no `huddle_start`. Juno's incoming huddles (SPEC 20) are read from the room frames and `huddles/info`, so they do not depend on `huddle_start`, `huddle_invite` or their unrecorded shapes.
- **Edge `huddles/info`** with `channel_ids: [<id>]` answers `{ok, huddles[]}`, empty when no huddle runs. A running huddle has `call_id`, `channel_id`, `active_members[]`, `dropped_members[]`, `name`, `background_id`, `thread_root_ts`, `pending_invitees`, `last_invite_status_by_user`, `is_scheduled`, `created_by`, `knocks`, `start_date`, `expiration` (0 here), `locale`, `recording.{transcript, is_paused, summary, recording_user, can_record_summary, recording_type}`, `updated`, `is_private`.
- **Leave.** `rooms.leave` with `channel_id`, `call_id`, `attendee_id` and `_x_reason=calls-api/leaveRoom` answered `feature_not_enabled`, with and without `reason=user_initiated`. Even so, nothing was left behind. In the second run, `huddles/info` read just after the Chime session stopped (`audioVideoDidStop`, status `Left`) still listed the user as active. `sh_room_leave` arrived about a second later. Three seconds later, `huddles/info` listed the huddle with no active members, and a later read listed no huddle at all.

### Inferred

- On this workspace the server runs huddles with `huddles_arch_v2` and does not use `rooms.leave`. It learns that an attendee left from Chime. The official client sends `rooms.leave` anyway and treats `feature_not_enabled` as an expected "arch mismatch".
- So on such a workspace, leaving the Chime meeting is the leave. A crash that never stops the Chime session leaves the attendee until Chime drops it for silence on the connection. The time this takes was not measured.
- Juno should do what the official client does. Its ending transition (`transitionToEnding` in `shared-client`) first sends `rooms.leave` with `reason=user_initiated` (`NOTIFY_SERVER_LEAVE`, not awaited, errors only logged), then stops the Chime session (`DESTROY_MEDIA_SESSION`). Juno sends the same leave, stops Chime without waiting for the answer, and treats `feature_not_enabled` like the other benign errors. With arch v2 the Chime stop is what removes the attendee, so it must happen even when the leave fails.
- The spike's own leave sent `rooms.leave` after the Chime stop, so it did not test the official order. On an arch v2 workspace the order should not matter, since `rooms.leave` does nothing there.

## Unknowns

- Whether Slack checks the client for other huddle methods. `rooms.join` accepted Juno's request shape (section 6).
- Whether Chime cares about the page origin in Electron. A `http://localhost` page in Chrome connected (section 6).
- Whether audio from another participant arrives. The spike had no second participant yet.
- The protobuf schema of the peer messages (field numbers and types). The descriptors are in the minified bundle but were not decoded. Not needed for Juno's scope.
- Whether the legacy calls-server path (`hostname`, `port`, `turn_auth`) is ever returned today. The live answer had `free_willy`.
- Whether multi-device join (`multidevice`) or quick join needs extra calls not seen here.
- Whether `rooms.leave` succeeds on a workspace without `huddles_arch_v2`, and what else `huddles_arch_v2` changes on the server. On the client it switches the state manager, device setup and the leave's offline queue (section 6).
- Whether Enterprise Grid, GovSlack or Slack Connect channels add more checks.
- Whether the huddle window opened by the web client needs anything from `child-preload` beyond the general `window.open` handling.

## How to confirm at runtime (read-only)

These need a running Slack client or Juno build but no writes to other people's channels.

1. In the user's own Slack desktop app with DevTools (launch with `SLACK_DEVELOPER_MENU=true`, which the shell reads, then View > Developer > Toggle DevTools), open the Network panel, start a huddle **in a private test channel made for it**, and record `rooms.join`. Check the response shape (`call.free_willy.meeting`, `call.free_willy.attendee`, `canvas`, `huddle`) without copying token values. Leave and check `rooms.leave`.
2. On the RTM websocket frames from step 1, note the `sh_room_join`, `sh_room_update` and `sh_room_leave` event shapes.
3. Without joining, call the edge API `huddles/info` for a few channel ids the user is in and see what comes back when a huddle is or is not running.
4. In `chrome://webrtc-internals` during the test huddle, confirm the ICE servers (Chime TURN hosts, port 3478 or 22466) and that the remote endpoint is a Chime media host.
5. Only if peer messages come into scope later: read the protobuf descriptors from `shared-client` with REA (`trace_javascript_semantics` on the `lP` schema module).
6. Done on 2026-10-19 except two-way audio (section 6). In a Juno prototype, call `rooms.join` with the user's session and the request shape recorded in step 1, and pass the result to the open-source Chime SDK. If the server rejects it, compare request params with step 1. Keep this to a private test channel made for it, with the owner's phone as the second participant. This is phase 2 of `docs/plans/huddles.md`; it also settles the Chime origin question, the `ExternalUserId` format and the real frame shapes.

## Missed-huddle recovery

The message room fields above can provide evidence of an offline miss when `has_ended`, `date_end`, `created_by` and `participant_history` are present. This is an inference from the recorded shapes, not a claim that every historical message supplies complete participation. Juno leaves missing history unknown. `huddles/info` only lists running rooms and cannot recover ended ones. Local acknowledgements and observed joins must survive relaunch independently of Slack’s message.
