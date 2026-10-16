# How the Slack web client accesses data

Reverse-engineering notes for Juno. Scope: the web client (app.slack.com, "gantry-v2" build) that the Slack desktop app 4.52.178 runs, its HTTP API calls, its real-time websocket, and where the desktop app stores credentials.

Everything below comes from static reading of the cached JS bundles, plus the "Observed live" notes, which come from the read-only live smoke (`scripts/smoke-live.ts`, section 10) against one single-workspace account. No token, cookie or message content is reproduced here; only names, formats and locations.

## 0. Sources and method

Observed

- Bundles came from the newest Service Worker cache entry, `gantry-1791793654` (641 entries, brotli-encoded bodies in Chromium simple-cache files). Extracted to `/tmp/juno-re/webclient/gantry-latest` with `/tmp/juno-re/scripts/extract_simple_cache.py`, then beautified with prettier into `/tmp/juno-re/webclient/pretty/`.
- `client-v2.html` declares the build: `data-version-ts="1791793654"`, `data-build-number="134135"`, `data-cdn="https://a.slack-edge.com/bv1-13-br/"`, `data-app="client-v2"`.
- Key bundles (short names used in evidence refs below):
  - `shared` = `gantry-v2-shared.c702ca6ba455738b.min.js` (API request classes, token storage, socket class, boot fetchers, thread subscription fetchers, history fetchers, notification rules).
  - `boot-async` = `gantry-v2-async-gantry-v2-shared-boot-async.df256c9e690d80a1.min.js` (socket manager, RTM event handlers, chat.postMessage, counts, boot payload processing, notification display).
  - `client-boot` = `client-boot.51f971944b5407a4.min.js` (boot of a team, conversations.view call, send-message thunk, counts application).
  - `vendors` / `vendors-client` = `gantry-v2-vendors.dec445a4b4b1ff78.min.js`, `gantry-v2-vendors-client.f076b67a6cdc90e6.min.js` (generated per-method fetcher registry: one module per API method).
- REA evidence IDs: `ev_c632a19387874e177010bd7d40f24c97d405bb4c90bd632b94ca7ce23bc68311` (analyze_javascript_application over the 7 core bundles; summary view `ev_b95cbd0ef1534f25919a580815f90b4c1cd80661f95f79a9350f976ab4ffbf90`, module page `ev_70191ead63b2835ce5d94ba24e0e782dbb308419dc2c01e1ab1f441e11e3a68d`), `ev_b5cd44e802dc43d71eff423dde6400e0aa154e4b9e42ef3e6e491a4e7f8eb341` (`shared` alone, 2283 modules), `ev_5ef7199fdef2677fdfafe521e6ac02a3a069c205be6fc61c133fa872606df35c` (threads-view chunk, complete graph). REA's semantic graphs for the big bundles were budget-truncated and feature traces (`ev_27cdcd8b…`, `ev_b9ffc976…`) returned no-match, so all behavioural claims below are backed by direct reading of the named modules, with REA as inventory evidence only.

## 1. Authentication model

Observed

- HTTP API URL: `/api/<method>?_x_id=<id>&...` where host is `//<team-host>` when the team has a known host, else same-origin. Built in `SlackApiRequest` (`shared`, module `GGwr`): `` D = `/api/${method}?_x_id=${id}${queryString}` ``, `L = host ? `//${host}${D}` : D`. The host comes from `GantryTeamMetadata.getHostForTeamId` (`shared`, module `/e6U`), which reads `localConfig_v2.teams[teamId].url` and takes its host. So requests go to `https://<workspace>.slack.com/api/<method>`; on failure to resolve it throws `api_missing_host_error`.
- `_x_id` format (`shared`, `EVbb` `generateId`): `` `${versionUid.substring(0,8) || "noversion"}-${(Date.now()/1000).toFixed(3)}` ``.
- Query string params added (`shared`, `Q6X1` `generateQueryString`): `slack_route=<enterpriseId:teamId | teamId>`, `_x_version_ts=<build version ts>`, `_x_frontend_build_type=current`, `_x_desktop_ia=4` (desktop only), `_x_gantry=true`, optional `_x_csid=<session id>`, `db_proxy_enabled`, pass-through `feature_*`/`force_*`/`country` params. `BaseRequest._openAndSend` (`DW51`) adds `fp=<2-char fingerprint hash>` and `_x_num_retries=<n>`. `TracedRequest._setMetaQueryString` adds `_x_b3_traceid`, `_x_b3_spanid`, `_x_b3_sampled` when sampled.
- Body: HTTP POST, `multipart/form-data` built by `getFormData` (`shared`, `qVKj`): every arg becomes a form field; objects are `JSON.stringify`'d; `token` is forced to be the first field (`UPtI` `ensureTokenIsFirstArg`). `apiCall` (`IlU1`) also injects `_x_reason=<reason>`, `_x_mode=online|degraded|offline`, and (gantry) `_x_app_name=client` plus `_x_sonic=true` on desktop.
- Token selection (`shared`, `QFsU` `computeToken`): `token` = enterprise token when the method needs org scope, else the team token from an in-memory map `tokenMap[token] = teamId` (`kgOc`), filled at boot from `localConfig_v2.teams[teamId].token` and `.enterprise_api_token` (`bootTeamContext` in `shared`). Tokens start with `xoxc-`.
- Cookie: XHR is opened with `withCredentials = true` whenever on gantry or when the token starts with `xoxc-` (`GGwr`, `SuHj`). The code never reads the `d` cookie itself; the browser attaches it. Both the `xoxc-` token (form field) and the `d` cookie (HttpOnly) are required for a successful call.
- Headers: only `X-Slack-Version-Ts` is set, and only on the `sendBeacon`/XHR fallback path (`shared`, `lL9T` `beaconApiCall`). Responses are read for `X-Slack-Req-Id` and `Retry-After`. No `Authorization` header is used.
- Edge/Flannel API (`shared`, `SuHj` `FlannelRequest` + the `query` function in the same area): JSON POST (`payload = JSON.stringify(args)`, token inside the JSON body) to `<flannelUrl>/<method>?_x_app_name=client`, where `flannelUrl` is fetched at runtime via `api.getFlannelHttpUrl` (`include_external_workspaces: true`) and cached with `ttl_seconds` in the `endpoints` store. CSP in `client-v2.html` allows `edgeapi.slack.com`.
- Websocket URL (`boot-async`, `getSocketUrl`): base from `client.getWebSocketURL`, then `token=<xoxc>` is a query param (see section 4).
- Local storage of credentials on this machine:
  - `~/Library/Application Support/Slack/Local Storage/leveldb/*.ldb|*.log`, origin `https://app.slack.com`, key `localConfig_v2`. Value is a JSON string. Read/written by `shared` module `xLyU` (`getLocalConfig`, `createLocalConfigFacade`).
  - `~/Library/Application Support/Slack/Cookies` (SQLite, table `cookies`). Slack cookies present on host `.slack.com`: `b`, `d` (Secure, HttpOnly, SameSite=Lax, ~1 year expiry, `encrypted_value` ~291 bytes), `lc`, `ssb_instance_id`, `tz`, `ui`, `utm`. `value` is empty; everything is in `encrypted_value`.
  - Where the data lives depends on the install (read from Slack 4.52.178's `main.bundle.cjs`, file names only):
    - Direct download from slack.com: `~/Library/Application Support/Slack`. Not sandboxed (its entitlements have no `com.apple.security.app-sandbox`). This Mac has this install.
    - Mac App Store build (`process.mas`): the sandbox container, `~/Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support/Slack`. Both builds have the bundle id `com.tinyspeck.slackmacgap`, hence the container name. The direct build's main process migrates from this path on first launch: when the container has `Cookies` and the direct profile has no `storage` and no `Local Storage`, it copies `Cookies`, `storage/slack-*` and every `Local Storage` entry across.
    - The cookie store is `Network/Cookies` on newer Chromium and `Cookies` on older. Slack's own helper returns `<userData>/Network/Cookies` when it exists, else `<userData>/Cookies`, and its diagnostics check the two in that order. Either may have a `-journal` file beside it. On this Mac (Electron in Slack 4.52.178) it is still `Cookies` plus `Cookies-journal`.
    - The App Store build also keeps an `auth-cookie-backup` file in its `userData` (section "Cookie hardening" in `slack-desktop-shell.md`); Juno does not read it.
  - Keychain item: generic password, service "Slack Safe Storage", account "Slack", in the login keychain (metadata checked on the direct install). Electron names it after the app name, which is "Slack" in both builds, and Slack's App Store to direct migration copies the cookie file across unchanged, which only works if both builds use the same key. So the App Store build is expected to use the same item; this is not yet checked on an App Store install. Juno falls back to the other items with Slack's account names on an App Store install and records in its import report which item unlocked the cookie, so the first App Store report settles this.
  - IndexedDB `https_app.slack.com_0.indexeddb.leveldb` holds a `reduxPersistence` database (persisted redux stores: channels, members, messages, prefs, etc.). Local Storage also holds `persist-v1::<TEAM_ID>::<USER_ID>::<storeKey>` entries (drafts, expandables, accessibility).

localConfig_v2 shape (observed keys; other keys inferred from `_z(teamId, key)` reads):

```ts
interface LocalConfigV2 {
  teams: Record<TeamId, {
    id: string; name?: string; domain?: string;
    url: string;                     // "https://<workspace>.slack.com/"
    token: string;                   // "xoxc-…"
    user_id: string; user_locale?: string;
    enterprise_id?: string; enterprise_api_token?: string; enterprise_name?: string;
    variant?: string;                // commercial | gov
    lastViewState?, lastActiveTab?, channelSidebarBackground?, customTheme? ... // UI
  }>;
  lastActiveTeamId: string; orderedTeamIds: string[]; recentlyUsedTeamIds?: string[];
  prevTeams?: Record<string, unknown>; recents?: unknown;
  lc?: unknown; lcCommercial?: unknown; lcGov?: unknown; lastFetched?: number; lastColdBootTs?: number;
}
```

Inferred

- The `d` cookie is decrypted the standard Chromium way on macOS: `encrypted_value` starts with `v10`, AES-128-CBC, key = PBKDF2-SHA1(password from Keychain item "Slack Safe Storage", salt `saltysalt`, 1003 iterations, 16 bytes), IV = 16 spaces. Recent Chromium versions prefix the plaintext with a 32-byte SHA-256 of `host_key`. (Standard Chromium `OSCrypt` behaviour; not visible in the web bundles.)
- `_x_app_name` is `client` (from `document.documentElement.dataset.app` = `client-v2` with `data-app-name-override="client"`).
- The `xoxc-` token alone is rejected without the matching `d` cookie session (server-side; consistent with `withCredentials` always being set for `xoxc-`).

Observed live

- The `xoxc-` token in the form body plus a `Cookie: d=<value>` header is enough for every call the smoke makes and for the socket upgrade. No other cookie (`d-s`, `b`, `lc`, …) was sent and none was needed. Of the query params, only `_x_id`, `slack_route` and `_x_app_name=client` are sent; `fp`, `_x_version_ts`, `_x_gantry`, `_x_sonic` and the b3 trace ids are not, and nothing was rejected.
- A session read from the installed Slack app (`localConfig_v2` token, decrypted `d` cookie) works unchanged from plain Node, outside any Chromium profile.

Unknown

- Token lifetime and whether `xoxc-` rotates; the client has an `auth.test` fetcher and a "refetch credentials" path (`handleTeamAuthentication` in `shared`) but the refresh mechanism itself lives in the desktop shell/sign-in flow, outside these bundles.
- Whether the App Store build's "Slack Safe Storage" item is readable with `security find-generic-password` from another app (it should be, since Chromium uses the legacy login keychain API, but no App Store install was available to check).
- Whether `fp` (fingerprint) is validated server-side. It is a 2-character hash from FingerprintJS components; the client always sends it.

## 2. Boot sequence

Observed (`shared`, module `sQEb`; `boot-async`, module `1lIp` `processClientBootData`; `client-boot`, `fetchMessagesData`)

Requests enqueued at boot (all POST `/api/...`, token in body):

| Method | Args (besides token) | Purpose |
| --- | --- | --- |
| `client.userBoot` | `_x_reason=fetch-client-data`, `version_all_channels`, `return_all_relevant_mpdms=true`, optional `min_channel_updated` | Primary state: self, team, channels, ims, prefs, subteams, starred |
| `client.counts` | `thread_counts_by_channel=true`, `org_wide_aware=true`, `include_file_channels=true`, `include_all_unreads=true|pref`, optional `channel_ids[]`, `counts_last_fetched` | Unread/mention counts per channel/IM/MPIM and threads |
| `users.prefs.get` | none | Full user prefs |
| `conversations.view` | `channel?`, `count=28`, `canonical_avatars`, `no_user_profile`, `ignore_replies`, `no_self`, `include_full_users`, `include_use_case`, `include_stories`, `no_members`, `include_mutation_timestamps`, `include_free_team_extra_messages` | Messages for the channel being opened (falls back to a default channel) |
| `client.channels` | same as userBoot | Channel list refresh (incremental via `min_channel_updated`) |
| `client.init`, `client.extras`, `client.gantryBoot`, `client.shouldReload`, `experiments.getByUser`, `team.info`, `team.prefs.get`, `users.info` (self), plus user-group-membership and feature-flag fetchers whose method constants were not resolved | see `sQEb` | secondary |
| `api.getFlannelHttpUrl` | `include_external_workspaces=true` | Edge API base URL |
| `client.getWebSocketURL` | none | Websocket URL (section 4) |

`client.userBoot` response fields consumed (`processClientBootData`):

```ts
interface ClientUserBoot {
  ok: true;
  self: User;                       // id, name, profile, prefs? …
  team: Team & { prefs: TeamPrefs };
  prefs: UserPrefs;                 // same keys as users.prefs.get
  channels: Channel[];              // public, private, mpim (is_member, last_read, latest?, is_open?)
  ims: Im[];                        // { id, user, is_im, last_read, is_open, … }
  is_open: string[];                // ids of open IMs/MPIMs
  starred: string[];
  subteams: { self: string[]; all?: Subteam[] };
  read_only_channels: string[]; thread_only_channels: string[];
  channels_priority: unknown; unchanged_channel_ids?: string[]; has_more_mpdms: boolean;
  links?: unknown; workspaces?: unknown; default_workspace?: string; account_types?: unknown;
  emoji_cache_ts: number; app_commands_cache_ts: number; paid_features: string[];
  can_access_client_v2?: boolean; auth_min_last_fetched?: number; hidden_messages_count?: number;
  visitor_channels?: string[]; temporary_channel_expirations?: unknown;
}
```

`client.counts` response (`boot-async` `OKlm` `transformClientCountsOutput`; `client-boot` `applyCountsToChannels`):

```ts
interface ClientCounts {
  ok: true;
  channels: CountEntry[]; ims: CountEntry[]; mpims: CountEntry[];
  threads: { has_unreads: boolean; mention_count: number;
             unread_count_by_channel?: Record<ChannelId, number>;
             mention_count_by_channel?: Record<ChannelId, number> };
  channel_badges?: Record<string, unknown>; alerts?: unknown; saved?: unknown;
  file_channels?: { quip?: { mention_count_by_channel: Record<string, number> } };
  counts_last_fetched?: number; activity_v2?: unknown;
}
interface CountEntry {
  id: ChannelId; last_read: Ts; latest?: Ts;
  has_unreads: boolean; mention_count: number; mention_count_display?: number;
  vip_count?: number; updated?: Ts; history_invalid?: Ts;
}
```

Observed live (`client.userBoot` with `version_all_channels=true`, `return_all_relevant_mpdms=true`; `client.counts` with `thread_counts_by_channel=true`)

- `client.userBoot.channels` lists every channel of the workspace, not only the user's (418 channels against 218 in `client.counts`). The channel objects carry no `is_member`, `last_read`, `latest`, `unread_count` or `is_open`; the keys present on all of them are `id, name, name_normalized, is_channel, is_group, is_im, is_mpim, is_private, is_archived, is_general, is_shared, is_ext_shared, is_org_shared, is_pending_ext_shared, is_frozen, is_slackbot_channel_enabled, created, creator, updated, unlinked, context_team_id, shared_team_ids, pending_shared, pending_connected_team_ids, parent_conversation (null), topic, purpose, properties`; `members` is present on about half, `previous_names` on half, `connected_team_ids`/`conversation_host_id`/`internal_team_ids` on shared channels only, `use_case` rarely. So membership and read state must come from `client.counts`, whose entries are the user's own conversations.
- **Membership, as Juno derives it.** `userBoot` is channel metadata only. A conversation is the user's own when `client.counts` lists it (`channels`, `mpims`, `ims`); a full counts answer (no `counts_last_fetched`) replaces the membership set, an incremental one only adds. Between counts calls the membership events keep it current: `channel_joined`/`group_joined`, `member_joined_channel` (self), `im_open`, `im_created`, `mpim_open`, `mpim_joined` add; `channel_left`/`group_left`, `member_left_channel` (self), `channel_deleted`/`group_deleted` remove. `im_close`/`mpim_close` do not remove: they hide the DM in Slack's sidebar but it stays the user's. The sync (`packages/sync/src/boot.ts`, `events.ts`) and the fake (`packages/fake-slack`) follow this; the sidebar query filters on it. Unknown: whether an incremental `client.counts` (with `counts_last_fetched`) lists only changed entries or everything; Juno assumes the former and takes a full list at every warm boot, so a channel left while the app was closed drops out then.
- `client.userBoot.ims` entries always have `id, user, is_im, is_open, is_archived, is_frozen, is_org_shared, is_slackbot_channel_enabled, created, updated, context_team_id`; `is_shared`/`is_ext_shared`/`shared_team_ids`/`connected_team_ids` only on shared DMs.
- `emoji_cache_ts`, `app_commands_cache_ts` and `translations_cache_ts` are ts-formatted strings, not numbers. `subteams` had only `self` (no `all`). `self.profile` includes `email`, `status_*`, `huddle_state*`, `start_date`. Extra top-level keys not in the bundle reading: `cache_ts_version, cache_version, prefs_version, slack_route, dnd, non_threadable_channels, accept_tos_url (null), is_europe, mobile_app_requires_upgrade` and several `is_*_eligible` flags.
- `client.counts` entries (channels, mpims, ims) all carry `id, last_read, latest, updated, history_invalid` (all ts strings), `mention_count` and `has_unreads`; `mention_count_display` and `vip_count` were absent on entries, while `threads` has `has_unreads, mention_count, vip_count, unread_count_by_channel, mention_count_by_channel` (no `timestamp`). `channel_badges` is `{ channels, dms, app_dms, thread_mentions, thread_unreads }` (numbers). `alerts`, `saved` and `activity_v2` are flat objects of numeric counters.

Inferred

- `conversations.view` returns `{ messages, channel, pins?, … }` like `conversations.history` plus channel metadata; it is the client's "open this channel" call.
- Channels are kept in sync afterwards by RTM events plus periodic `client.counts` (the client passes `counts_last_fetched` to get only changed entries).

Unknown

- Exact `User`/`Channel` object field lists beyond standard Slack Web API shapes (standard shapes apply: `id`, `name`, `is_channel`, `is_private`, `is_im`, `is_mpim`, `is_member`, `last_read`, `unread_count`, `topic`, `purpose`, `user` for IMs).

## 3. API method inventory relevant to Juno

Observed. Source: generated fetcher registry (`vendors`, `vendors-client`, one module per method, e.g. `(0,N.r)("conversationsHistoryFetcher","conversations.history")`), plus the call sites named below. 405 distinct method strings were found across the core bundles; this table lists the ones Juno needs.

Listing conversations
- `client.userBoot` / `client.channels` (section 2) are what the client uses. `conversations.list`, `users.conversations` are not used by the client (`conversations.list` only appears in the async vendors chunk); use userBoot + `client.counts`.
- `client.dms` fetcher exists (DM list). `conversations.info`, `conversations.genericInfo`, `conversations.members`, `conversations.open`, `conversations.close` exist.

History (`shared`, module with `fetchHistory`/`fetchReplies`, around `determineDefaultHistoryLimit`)
- `conversations.history` args: `{ channel, limit (default 28), oldest?, latest?, inclusive: true, ignore_replies: true, include_pin_count: true, no_user_profile: true, include_stories: true, include_free_team_extra_messages: true, include_date_joined?, include_tombstones?, cursor?, cached_latest_updates: {[ts]: version} }`. Response: `{ messages, has_more, is_limited, pin_count, channel_actions_count, deleted: Ts[], response_metadata: { next_cursor? }, latest_updates?, unchanged_messages?: Ts[], date_joined? }`.
- `conversations.replies` args: `{ channel, ts: thread_ts, inclusive: true, limit, oldest?, latest?, cursor?, include_tombstones?, cached_latest_updates }`. Response: `{ messages, has_more, response_metadata, deleted, latest_updates, unchanged_messages }`. First message is the root, also when `oldest` is after it (observed live 2026-10-15, section 10, "Live probe"). Error `thread_not_found` is handled.
- `conversations.view` (section 2).
- Observed live (`conversations.history` with `limit`, `ignore_replies=true`): `{ ok, messages, has_more, pin_count, channel_actions_count, channel_actions_ts (null), response_metadata: { next_cursor } }`. Every message had `type, ts, text, client_msg_id, user`; `blocks` on nearly all, `attachments` on about two thirds, `reactions` on half; roots carry `thread_ts, reply_count, reply_users, reply_users_count, latest_reply, subscribed, is_locked` and sometimes `last_read`; `thread_broadcast` messages carry `root`.
- `conversations.historyChanges` returns `{ ekm_change_ts }` (enterprise key management only).

Thread subscriptions and unreads (`shared`, module `ZUxn`; `boot-async` `WhFy` `refreshThreads`, `zvzS` `processThreads`)
- `subscriptions.thread.add` `{ channel, thread_ts, last_read }` and `subscriptions.thread.remove` `{ channel, thread_ts, last_read }` (sent through the persisted/offline queue `d.I`).
- `subscriptions.thread.get` `{ channel, thread_ts }`.
- `subscriptions.thread.mark` `{ channel, thread_ts, ts: last_read, read: 1|0 }` (read=0 marks unread).
- `subscriptions.thread.clearAll` `{ max_ts, undo_ts? }`.
- `subscriptions.thread.getView` `{ current_ts?, limit, fetch_threads_state: boolean, priority_mode?, channel_id? }` → 

```ts
interface ThreadsGetView {
  ok: true;
  threads: Array<{
    root_msg: Message & { channel: ChannelId; thread_ts: Ts; subscribed: boolean; last_read?: Ts; reply_count: number; latest_reply?: Ts };
    unread_replies: Message[]; latest_replies: Message[]; priority?: boolean;
  }>;
  has_more: boolean; total_unread_replies: number;
  threads_state?: { has_unreads: boolean; mention_count: number; unread_count_by_channel; mention_count_by_channel; timestamp: Ts };
}
```
- Observed live (`subscriptions.thread.getView` with `limit` only): the response also has `max_ts` (ts) and `new_threads_count` (number); `threads_state` is absent unless asked for. `unread_replies` is absent, not empty, on threads with nothing unread (3 of 10 had it); `latest_replies` was absent on at least one thread in a later run (2026-10-13), so both are optional in the schema. Every `root_msg` had `channel, thread_ts, ts, reply_count, reply_users, reply_users_count, latest_reply, last_read, subscribed, is_locked, text, type`; `latest_replies` entries carry `channel` too. Bot roots can carry `agent_session` and `icons`.
- `subscriptions.thread.getTimestamps` `{ mode, limit, org_wide_aware: true }`.
- `client.counts.threads` (section 2) gives the global threads unread/mention state.

Marking read/unread
- `conversations.mark` `{ channel, ts, previous_ts?, reason? }` (`shared`, `createFetcherMark`). Marking "unread" is done by marking at the ts before the first unread message. `conversations.markMany`-style call with `markers: JSON` also exists (`K.ke` in the same module). `conversations.dms.mark` `{ undo_key }` marks old DMs read.
- These are in the "persisted/retry on reconnect" list (`shared`, `J6Mn`): `conversations.mark`, `subscriptions.thread.add/remove`, `reactions.add/remove`, `users.prefs.set`, `saved.*`, `activity.mark*`.

Posting (`boot-async`, `gzYT` `chatPostMessage`; `client-boot` send thunk around `"Sent a message to ${b} via HTTP"`)
- `chat.postMessage` args built from the pending message: `{ channel, ts (client-generated), type: "message", text?, blocks: JSON string (rich_text), markdown_text? (alternative to blocks), thread_ts?, reply_broadcast?: boolean, client_msg_id: uuid, include_channel_perm_error: true, skip_dlp_user_warning?, unfurl?: JSON, pending_slug_urls?: JSON, draft_id?, xArgs (send_as_user_id etc.) }`. Messages are sent over HTTP (not the socket) through a per-team `MessageQueue` (one in flight at a time). The server echoes the message on the socket with the same `client_msg_id`; the client resolves the placeholder by `client_msg_id`.
- Errors handled: `message_limit_exceeded`, `ekm_access_denied`, `dlp_user_warning`, `restricted_action_*`, HTTP 429 (`message_send_ratelimit`).
- `chat.update` `{ channel, ts, blocks | markdown_text, file_ids?, skip_dlp_user_warning }` (`boot-async`, `commitMessageEdit`; retries `message_not_found` up to 10× with 175 ms delay). `chat.delete`, `chat.unfurlLink`, `drafts.create/update` (`{ blocks, client_msg_id, destinations, file_ids, … }`) exist.

Reactions
- `reactions.add` / `reactions.remove` with standard `{ channel, timestamp, name }` (registered in the persisted-call list; standard Web API args; the call site args were not read in full).

Users, channels, emoji, usergroups via the Edge ("Flannel") API (`shared`, method map `U` near `MEMBER_INFO: "users/info"`; `fetchObjectsById`, `fetchObjectsWithQuery`, `fetchChannelFirstNMembers`)
- Methods: `users/info`, `users/search`, `users/list`, `users/counts`, `users/searchBulk`, `channels/info`, `channels/search`, `channels/list`, `channels/membership`, `mpims/search`, `usergroups/info`, `usergroups/search`, `usergroups/searchBulk`, `emojis/info`, `emojis/search`, `emojis/list`, `huddles/info|list`, `objects/search`, `permissions/info`, `externalTeams/*`, `apps/info`.
- By-id query: `{ updated_ids: {[id]: updated_ts_or_0}, check_membership?, check_interaction?, include_profile_only_users? }` or `{ ids: [...] }` when not conditional. Max ids per query is a constant `L` (chunked, concurrency 2).
- List/search query: `{ query?, count, marker?, filter?, present_first?, channels?: [id] }`; e.g. channel members: `{ channels: [id], present_first: true, filter: "everyone AND NOT bots AND NOT apps", count: n<=100 }`.
- Response: `{ ok, results: Object[] | Record, failed_ids?, pending_ids?, invalid_ids?, member_channels?, mpims?, disconnected_ids?, can_interact?, next_marker? }`. Paging is by `marker = next_marker`.
- Web API fallbacks: `users.info` (default args `canonical_avatars`, `name_tagging`), `users.list`, `usergroups.search`, `subteams.info` `{ usergroups: ids, include_users: false, include_count: true, include_disabled: true }`, `emoji.adminList`/`emoji.getInfo`.
- `emoji.list` is not called by this client; custom emoji come from `emojis/list` on the edge API.
- **User groups, observed live 2026-10-16** (`pnpm probe:live -- --only usergroups`, key census and counts only). `client.userBoot.subteams` had only `self` (the ids of the user's own groups), never `all`, so handles must come from elsewhere. `usergroups.list` with `include_disabled=true` answers `{ ok, usergroups }` with no paging cursor; every group carries `id, team_id, name, handle, description, is_usergroup, is_subteam, is_external, is_org_level, is_section, is_visible, is_idp_group, is_membership_locked, is_editing_restricted, auto_provision, auto_type (null), prefs (object), channel_count, user_count, date_create, date_update, date_delete, created_by, updated_by, deleted_by (null), enterprise_subteam_id`. `date_delete` is a number on every group, `0` for a live one. No `users` list unless `include_users` is set. `handle` has no leading "@". Every `subteams.self` id was in the list. In 15 recent history pages, every group mention in `text` was the bare `<!subteam^S…>` with no `|@handle` label, and each such message also had a rich text `usergroup` element with only `type` and `usergroup_id`. So a client cannot name a group from the message alone. Unknown: the shape of `subteam_*` socket events (none was seen); Juno reads `subteam_created`/`subteam_updated` as carrying `subteam` (a full group, as Slack's public Events API documents), `subteam_members_changed` as `subteam_id` with `added_users`/`removed_users`, and `subteam_self_added`/`subteam_self_removed` as `subteam_id`.
- **`emojis/list` results, observed live 2026-10-16** (`pnpm probe:live -- --only emoji`, key census only): `name`, `value`, `updated`, and on some `collection_id`. `value` is the image URL, `alias:<name>` for an alias, or an object of per-vendor URLs (`apple`, `google`). Aliases also carry `alias` (the target name) and `is_alias: true`; an alias can name a standard emoji, not only a custom one. There is no `url` or `alias_for` field: Juno read those until 2026-10-16, so every custom emoji was stored without an image and showed as `:name:`. Unknown: what other `value` object keys exist.

Search (`shared`, `createThunkSearchModules` area: `` `search.modules.${module}` ``)
- Method is `search.modules.<module>` with module in `messages | files | people | channels | dms | shortcuts | workflows | salesforce | agents | default`. Args: `{ module, query, page, cursor, client_req_id?, search_session_id?, browse_session_id?, extracts: 1, highlight: 1, max_extract_len: 200, extra_message_data: 1, no_user_profile: 1, count (20/21/50), file_title_only, query_rewrite_disabled, … }`. `search.messages` is not used.

Permalinks
- No API call. `constructMsgPermalink(channel, ts, threadTs)` → `/archives/<C>/p<ts without dot>` plus `?thread_ts=<root>&cid=<C>` for replies; absolute form `https://<team domain>.slack.com/archives/...` (`shared`, `constructAbsoluteMsgPermalink`). `chat.getPermalink` is never called.

Presence
- Subscribe over the socket: `{ type: "presence_sub", ids: [userIds] }` (`client-boot`, `sendPresenceSubEvent`). Updates arrive as `presence_change` events (section 4). `presence.set` exists for the self user. No `users.getPresence`.
- **Setting your own presence, read 2026-10-16** (`boot-async`, `toggleUserPresence` in module `whHN`, `setCurrentMemberPresence` and `toggleMemberPresence` in `qj7u`; method constant in the vendors-async fetcher `presenceSetFetcher`). The menu toggle calls `presence.set { presence }` with `presence` from the enum `{ Away: "away", Active: "active" }` (`uCdg`): `active` or `away`, never `auto`. `auto` is the public `users.setPresence` value. The client updates its own `manual_presence` and `presence` optimistically and reverts them when the call fails; the answer is not read.
- **Reading it back.** `client.userBoot` `self` carries `manual_presence` (observed live 2026-10-16, key only). The client keeps it current from `manual_presence_change { presence }`, whose value must be `active` or `away` (anything else is logged as unknown).
- Unknown: the error `presence.set` gives for another value. Juno sent `auto` until 2026-10-16 and "Set yourself active" did nothing on the owner's workspace, which fits a rejection; the fake now refuses anything but `active` and `away` with `invalid_presence`, the public API's error name.
- **How the official client keeps you active, read 2026-10-17** (Slack 4.52.178 desktop shell `app.asar`, and the web bundles from the Service Worker cache, `shared` module `lWLC`, `7tEa`, `LFLp`, `XE4p`; `shared-boot-async` `BaseSocketManager`). No HTTP call does it: no `users.setActive` fetcher exists in the bundles, and `presence.set` is only the menu toggle above. The client sends a socket frame, `{ type: "tickle", reason, id }`:
  - The shell's `systemIdleStatusEpic` runs every 10 s: when `powerMonitor.getSystemIdleTime()` is at most 20 s and the screen is not locked (`lock-screen` / `unlock-screen`), it sends `TICKLE_MESSAGE_SERVER` to every loaded web client, whose preload calls `desktopDelegate.maybeTickleMS()` with `reason: "polling"`. So any keyboard or mouse input on the Mac counts, not only input in Slack.
  - The web client also tickles on window focus (`reason: "focus"`), `mousedown` and `keydown` in its window.
  - `maybeTickleMS` sends only when the socket state is `CONNECTED`, the self user's `manual_presence` is not `away`, and at least 19 s passed since `connectivity.lastSocketActivity`, which is the time the last `tickle`, `typing` or `user_typing` frame went out. It is not reset by a reconnect. `tickle` is fire and forget: no pending entry, no reply read.
  - Nothing is sent when the Mac goes idle, and nothing on quit; the socket just closes (code 4102 "client is going to sleep" on sleep).
- Unknown: how long after the last `tickle` Slack shows the user away, and whether an open socket with no `tickle` counts as active at all. The owner's report (Juno open, colleagues saw them offline, and Juno sent no `tickle` until 2026-10-17) fits a socket alone not being enough. The fake shows the user away 10 minutes after the last `tickle`, an assumption. Also unknown: whether the server reads `reason`.

Files
- `files.getUploadURL` / `files.completeUpload` (and `files.uploadExternal`, `files.info`, `files.list`, `files.share`) exist in the async vendors chunk. The file object on messages, `files.info` and download auth were observed live (section 10, "Live probe", Files).
- **Composer upload, read 2026-10-15** (`shared-boot-async`, `UploadQueue` in module `HExl`; `shareFile` in module `bw5L`). The composer uploads each file as soon as it is attached ("eager upload", `addAndUploadPendingFile`) and posts later:
  1. `files.getUploadURL { filename (file.name, else "Untitled"), length (bytes), snippet_type?, subtype?, alt_txt?, client_context_team_id? }`, `_x_reason=upload-queue`, once per file, files of one job in parallel. Answer read: `{ file, upload_url }`; `file` is the new id.
  2. The bytes go to `upload_url` by `XMLHttpRequest` `POST`, `FormData` with one field `file` (the File, so its name and type). No token, no extra headers, `withCredentials` not set: the url authorises itself. `client_context_team_id` is added as a query parameter when present. Success is HTTP 200. Progress comes from `xhr.upload` `progress` events, summed over the job's files.
  3. `files.completeUpload { files: JSON [{ id, title (file.title || file.name) }] }` once per job. From the composer it carries no channel. The answer is not read.
  4. The client waits for the socket's `file_created` with the file's id, polling the files after 60 s without it (7.5 s, doubling to 30 s, giving up after 600 s with `processing_timeout`). The id is then attached to the draft.
  5. On send, `files.share { files (an array of ids; `getFormData` appends it as is, so FormData joins it with commas), channel, thread_ts?, broadcast?, blocks (JSON rich_text), comment (plain text, only without blocks), client_msg_id, resharing_aware: true, skip_dlp_user_warning: false, from_share_modal: false, unfurl?, pending_slug_urls?, client_context_team_id? }`, `_x_reason=send_message_with_files`. The answer is not read on success; the message arrives like any other, matched by `client_msg_id`. When `files.share` fails, the message and its files go back to a draft.
  - The first failed upload retries the whole job once with new urls; after that an eager upload shows an error on the pending file. Errors not retried: `file_uploads_disabled`, `file_uploads_except_images_disabled`, `blocked_file_type`, `malware_detected`, `file_upload_size_restricted`, `file_upload_quota_exceeded`, `files_upload_has_exceeded_limit`, `dlp_user_warning`, `dlp_processing`, the Slack Connect sharing errors, `file_not_found_on_device`; `processing_timeout` is retried.
  - Limits: at most 10 files per message (`tooManyFiles`, the file input's `maxFiles`), at most 1 GiB per file (`0x40000000`), lowered by the team pref `max_file_upload_size`. Empty files and folders are left out.
  - Paste (`getFilesFromDataTransfer`): every `items` entry of kind `file`, `getAsFile()`, files with an empty name dropped. No renaming: a pasted screenshot goes up under the name Chromium gives it.
  - The snippet path (not the composer) puts `channel, thread_ts, client_msg_id, intro, blocks, broadcast` on `files.completeUpload` instead and skips `files.share`.
- **Files on a message** (renderer reads): `id, name, title, mimetype, filetype, size, mode, created, url_private, url_private_download, permalink, original_w/h, image_exif_rotation, alt_txt, thumb_tiny`, square `thumb_64/80/160` without sizes, `thumb_360/480/720/800/960/1024` each with `_w/_h`, `thumb_360_gif/480_gif`, `thumb_pdf(_w/_h)`, `thumb_video(_w/_h)`, `mp4`, `aac`, `converted_pdf`. `getThumbSrcForFile` prefers `thumb_pdf`, then 1024 (box over 480), 960 (over 360), 720, 480, 360. The full image is `url_private`, or the largest thumbnail when the EXIF rotation is over 1 or the original size is missing (rotation over 4 swaps `original_w/h`). `url_private` is a plain `<img src>` relying on the `d` cookie (same site as `app.slack.com`); no token, no `?t=`.
- Unknown: the upload host and whether its url is signed; whether `reply_broadcast` is honoured (the client sends `broadcast`); whether the upload POST minds the `d` cookie that Juno's session sends with it.
- Unknown: what `chat.delete` does to a message posted by `files.share` when another message (the network copy's twin, same `client_msg_id`) shares the same files. It may leave the files, or remove them from the other message too. Until this is checked in the private test channel, Juno never deletes a network copy of a post with files: it hides it locally and records it in `kept_copies` as "file copy kept until verified" (ADR 0014). To check: share a file with `files.share`, call `files.share` again with the same ids and `client_msg_id`, delete one message with `chat.delete`, then read the other with `conversations.history` and the file with `files.info`.


Activity / mentions (`boot-async`, `fetchActivityFeed` thunk; fetcher `activityFeedFetcher`)
- `activity.feed` args: `{ mode: "chrono_v1" | "chrono_unreads" | "priority_unreads_inbox_v1", types: string[], limit: 20, cursor?, archiveOnly, unreadOnly, priorityOnly, channelIds?, channelSectionIds?, excludeAutomations? }`. Also `activity.markRead`, `activity.markUnread`, `activity.markAllRead`, `activity.archive`.
- Mentions for Juno are more simply derived from `client.counts` (`mention_count`) and message text.

Prefs
- `users.prefs.get` (all prefs), `users.prefs.set` `{ prefs: JSON }` (persisted), `users.prefs.setNotifications`. The DND schedule prefs and their setter are in section 7, "Slack's notification schedule". Notification-relevant prefs read in the notification code: `mute_sounds`, `show_typing`, per-channel `channel_notification_settings`/`muted_channels`, `desktop_notification_actions`, `enable_unread_view`, `enable_threads_view`.

Internal/undocumented methods used: `client.userBoot`, `client.channels`, `client.counts`, `client.dms`, `client.init`, `client.extras`, `client.gantryBoot`, `client.shouldReload`, `client.getWebSocketURL`, `api.getFlannelHttpUrl`, `conversations.view`, `conversations.genericInfo`, `conversations.historyChanges`, `conversations.dms.mark`, `subscriptions.thread.*`, `search.modules.*`, `activity.*`, `drafts.*`, `experiments.getByUser`, the whole edge `users/list`-style API.

Inferred

- The standard public API shapes (`messages[]`, `ok/error`, `response_metadata.next_cursor`) apply; the extra args above only add fields.
- `reactions.add` args are the public `{ channel, timestamp, name }` since the persisted-call layer treats them like any Web API call.

Unknown

- Full response schema of `conversations.view`, `client.dms`, the edge `results` object fields for emoji (`name`, `url`, `alias_for` are referenced elsewhere), and `activity.feed` item shapes.

## 4. Real-time (websocket)

Observed (`boot-async`: `EndpointManager`, `getSocketUrl`, `BaseSocketManager`; `shared`: `Kot3` `SlackSocket`, `LtEM` RTM handler registry, `iPXF` socket flannel)

- URL acquisition: POST `client.getWebSocketURL` (token in body) → `{ primary_websocket_url, fallback_websocket_url, ttl_seconds, routing_context }`. Cached in localStorage under an `endpoints`-versioned key until expiry. `rtm.connect` / `rtm.start` are not used (an `rtm.start` default-args entry exists but no call site).
- Connection URL = `primary_websocket_url` + query params: `token=<xoxc>`, `sync_desync=1`, `slack_client=desktop`, `start_args=<urlencoded JSON>`, `no_query_on_subscribe=1`, `flannel=3`, `lazy_channels=1`, `gateway_server=<routing_context>`, `enterprise_id?`, `exclude_events?`, `ws_region?`, `is_backup=1` + `last_primary_region` on fallback, `frt=<fast reconnect token>`, `batch_presence_aware=1`, `slack_route?`. Hosts are validated against an allow-list that includes `wss-primary.slack.com` (`isValidSlackWebSocketUrl`). A separate `wss://wss-primary.slack.com/switchboard?token&team` socket exists for speech-to-text only.
- `start_args` default: `{ agent: "client", feature_*…, org_wide_aware: true, agent_version: <version ts>, eac_cache_ts: true, cache_ts: 0, name_tagging: true, only_self_subteams: true, connect_only: true, ms_latest: true, no_presence?: true, no_subteams?: true }`.
- Protocol: JSON text frames. Every outgoing message gets an incrementing numeric `id` (starting at 16385); replies carry `reply_to` and `ok`. Max outgoing frame 32768 chars. Types sent: `ping` every 10 s (close with code 4998 if no pong for 90 s), `tickle` (fire-and-forget "the user is here", at most every 19 s; see section 3, Presence), `typing`/`user_typing` `{ type: "user_typing", channel, thread_ts? }`, `presence_sub { ids }`, `subscription_update { subtype: user_change_subscribe_request | user_change_unsubscribe_request | dnd_invalidated_*, ids }`, and `flannel { subtype: <method>, ...args }` (edge queries over the socket).
- First frame is `{ type: "hello", flannel?, region, start?: {...} }`; `start` (when present) carries `self` and boot data. `{ type: "error", error: { code, msg, retry_after } }` is handled: `rate_limited`/`ratelimited`/`backend_overloaded`/`unknown` → backoff `retry_after` s or 30 s; `Socket URL has expired` → refetch; `invalid_auth` during fast-reconnect → slow reconnect. `{ type: "goodbye" }` → disconnect when window not focused. `{ type: "reconnect_url", url }` → stored for fast reconnect (valid 285 s). `{ type: "access_paused" }` routes to the access-paused handler. `pong` is the reply to `ping` (matched by `reply_to`).
- Reconnect: state machine (`PROV_CONNECT → PROV_CONNECTING → PROV_CONNECTED → PROV_FINALIZE → CONNECTED`, `ERROR → WAIT_FOR_RATE_LIMIT → CONNECT`, `WAIT_FOR_CONNECTIVITY`, `SLEEP/ASLEEP`, `HALT`). Backoff is exponential with cap 60 s, base 1 s (`WAIT_FOR_RATE_LIMIT`). After a successful connect the client refreshes counts via `client.counts` (inferred from `applyCountsToChannelsAndThreads` logging "wasLastConnectFast").
- Event dispatch: `addRtmHandler(type, fn)` / `addSharedRtmHandler` / `addBatchRtmHandler` registry; `message` events are routed by `subtype` in `messageReceived`.

Event types with payloads relevant to Juno (handlers in `boot-async` unless noted):

```ts
// message (no subtype): a full Message object with { type:"message", channel, user, text, ts, thread_ts?, blocks?, client_msg_id?, files?, attachments?, reply_count?, subscribed?, team? }
// message subtypes handled: message_changed, message_deleted, message_replied, thread_broadcast, message_locked,
//   channel_join/leave (join-leave list), channel_topic/purpose, bot_message, me_message, reply_broadcast (legacy), document_mention, tabbed_canvas_updated, …
{ type:"message", subtype:"message_changed", channel, ts, message: Message, previous_message?: Message, event_ts, hidden?: true }
{ type:"message", subtype:"message_deleted", channel, deleted_ts, previous_message?, event_ts }
{ type:"message", subtype:"message_replied", channel, message: { ts, reply_count, latest_reply, replies?: [{user, ts}] }, event_ts }
{ type:"channel_marked" | "group_marked" | "im_marked" | "mpim_marked", channel, ts, unread_count?, mention_count? }
{ type:"thread_subscribed" | "thread_unsubscribed" | "thread_marked", subscription: { channel, thread_ts, last_read, date_create?, active? } }
{ type:"update_thread_state" | "update_global_thread_state", has_unreads, mention_count, unread_count_by_channel, mention_count_by_channel, timestamp, channel_badges?, org_wide? }
{ type:"reaction_added" | "reaction_removed", reaction: string, user, item_user?, item: { type:"message", channel, ts } | { type:"file", file } , event_ts, url? }
{ type:"user_typing", channel, user, thread_ts? }            // batched
{ type:"presence_change", presence: "active"|"away", users: string[] }   // batched; manual_presence_change for self
{ type:"channel_joined" | "channel_left" | "channel_created" | "channel_rename" | "channel_archive" | "channel_unarchive" | "channel_deleted" | "channel_converted_to_shared", channel: Channel | id }
{ type:"im_open" | "im_close" | "im_created" | "mpim_open" | "mpim_close", channel, user? }
{ type:"member_joined_channel" | "member_left_channel", user, channel }  // batched
{ type:"desktop_notification", channel, ts | msg, thread_ts?, user?, title, subtitle, content, is_shared?, is_channel_invite?, launchUri?, imageUri?, avatarImage?, event_ts, trace_ctx? }
{ type:"pref_change", name, value } ; { type:"user_change", user } ; { type:"dnd_updated"|"dnd_updated_user", user, dnd_status }
{ type:"pin_added" | "pin_removed" } ; { type:"star_added" | "star_removed" } ; { type:"emoji_changed" } ; { type:"bot_changed" }
{ type:"subteam_*" } ; { type:"channel_history_changed"|"im_history_changed", channel, latest, event_ts } ; { type:"force_reload" } ; { type:"user_session_expiration" }
```

Observed live (plain Node `ws`, headers `Cookie: d=…`, `Origin: https://app.slack.com`, a non-browser `User-Agent`)

- `client.getWebSocketURL` answers `{ primary_websocket_url, fallback_websocket_url, ttl_seconds: 604800, routing_context }`; the primary URL is `wss://wss-primary.slack.com/` with no query of its own.
- **`start_args` must not be sent.** With any `start_args` value in the query, even `{}`, the server completes the upgrade (101) and then sends nothing: no `hello`, no reply to a `ping`, no close, for over 75 s. This held with and without `flannel=3`, with the full official parameter set and with a Chrome-like `User-Agent`. Without `start_args`, `hello` arrives within about 0.5 s. Juno loads its boot data over HTTP, so it never sends `start_args`; `token, sync_desync=1, slack_client=desktop, no_query_on_subscribe=1, flannel=3, lazy_channels=1, batch_presence_aware=1, slack_route, gateway_server` are sent and accepted.
- The upgrade response carries no `Sec-WebSocket-Extensions` (no compression) and no `Set-Cookie`.
- First frames: `{ type: "hello", fast_reconnect: false, region, host_id, start: true }` (so `start` is a boolean here, not a payload), then `{ type: "reconnect_url", url }` about 0.2 s later and again every 30 to 60 s. `pong` is `{ type: "pong", reply_to }`. `message` frames arrive with `event_ts`, `suppress_notification`, `source_team`, `user_team` next to the usual message fields; `message_changed` carries `message`, `previous_message`, `hidden: true`, `ts`, `event_ts`.

Inferred

- `channel_marked` family payloads follow the public RTM API (`unread_count`, `unread_count_display`, `mention_count` fields are consumed elsewhere via counts).
- `reaction_*` `item.ts`/`item.channel` are required (handler logs an error otherwise).

Unknown

- The full `hello.start` payload and `flannel=3` semantics (the `flannel` socket subtype lets the client run edge queries without HTTP; Juno can use HTTP edge calls instead). Live, `hello.start` was the boolean `true`.
- Why `start_args` silences the socket from Node. The official client sends it and gets `hello`, so the server must be waiting for something only the official client supplies (a first frame, a cookie the browser attaches, or a parameter tied to its build). Not needed: Juno works without it.
- Whether `reconnect_url` frames keep arriving every 30 to 60 s for the life of the connection (seen twice in 90 s) and whether an unused one expires server-side before the client's 285 s window.

## 5. Message format

Observed (`shared`, `N8wa` rich text enum; mention regexes; `client-boot` send thunk; `boot-async` `gzYT`)

- Outgoing messages are sent as `blocks` (JSON string) of one `rich_text` block (or `markdown_text` when the markdown composer is on). Minimal text: `[{ type:"rich_text", elements:[{ type:"rich_text_section", elements:[{ type:"text", text }] }] }]`.
- Rich text element types: `rich_text_section`, `rich_text_header`, `rich_text_divider`, `rich_text_quote`, `rich_text_preformatted`, `rich_text_list` (`style: bullet|ordered|check|checked|unchecked`, `indent`), inline `text` (with `style: {bold, italic, strike, code}`), `user {user_id}`, `usergroup {usergroup_id}`, `channel {channel_id}`, `broadcast {range: here|channel|everyone}`, `emoji {name, unicode?}`, `link {url, text?}`, `date`, `color`, `workflowtoken`, `file`, `canvas`, `message_mention`, `workflow_mention`, `list_record`, `truncation`, `unknown`.
- Quotes: a `rich_text_quote` element wraps a section; in the mrkdwn `text` field it is `&gt; ` at line start. There is no reply/quote object.
- mrkdwn `text` encodings the client parses: `<@U…>` user, `<#C…|name>` channel, `<!subteam^S…|@handle>` usergroup (live messages carry the bare `<!subteam^S…>`, section 3), `<!here>`, `<!channel>`, `<!everyone>`, `<!date^…>`, `<url|label>`, `<!sf:…>` (Salesforce). Regexes: `/<!channel\b/`, `/<!here\b/`, `/<!everyone\b/`, `/<!group\b/`, `` `<!subteam^${id}|@${handle}>` ``.
- **Links, observed live 2026-10-16** (`pnpm probe:live -- --only links`: the self-DM and the 10 most recently active conversations, one history page each, 256 messages with a `client_msg_id`, counts only). Slack's clients send every URL as a `link` element: no `text` element held anything URL-like. 44 link elements in 34 messages. Keys: `type`, `url` always; `text` on 30; `truncated` (15), `is_slack_url` (4), `from_llm` (4) and `unsafe` (1) sometimes. A URL with no `text` (14) is written `<url>` in the message `text`; one with `text` is `<url|text>`, the text being a label (10), the URL itself (8) or the URL without its scheme (12: 11 `https://`, 1 `http://`). Slack does not link `text` elements itself, so a client that sends a URL in one gets plain text back in `blocks`. Juno sends what the clients send: a typed URL as `{ type: "link", url }` and `<url>`; a bare domain or address as `{ type: "link", url: "http://example.com", text: "example.com" }` and `<http://example.com|example.com>` (`mailto:` for an address); linked words as `{ type: "link", url, text }` and `<url|words>`. Unknown: what `truncated` means and which client sets it; whether today's client adds `http://` or `https://` to a bare domain typed into it (the one older domain-only sample has `http://`, as Slack's mrkdwn auto-linking does).
- Incoming messages carry both `text` (mrkdwn, HTML-escaped `&lt; &gt; &amp;`) and `blocks`; the client renders `blocks` when present (`shouldRenderBlocksInsteadOfText`) and falls back to parsing `text`.
- Thread fields on messages: `thread_ts`, `reply_count`, `reply_users`, `latest_reply`, `subscribed`, `last_read`, `unread_count` (root), `parent_user_id` (reply), `subtype: "thread_broadcast"` for "also send to channel" replies.
- Edits: `edited: { user, ts }`; deletions arrive as `message_deleted` with `deleted_ts`.

Inferred

- For Juno, sending `blocks` with a `rich_text` block is the safest; `text` can still be sent as a plain fallback (the API accepts both). Mentions in outgoing blocks are `{type:"user", user_id}` / `{type:"channel", channel_id}` / `{type:"usergroup", usergroup_id}` / `{type:"broadcast", range}`.

Unknown

- Exact rendering of `markdown_text`; whether the server rewrites `text` from `blocks` (standard behaviour is yes).

## 6. Rate limits, pagination, errors

Observed (`shared`, `DW51` `BaseRequest`, `GGwr` `SlackApiRequest`, `kPEx` API queue, `IlU1` `apiCall`)

- Per-team request queue: max 10 concurrent requests for the focused team, 1 for background teams. Queue pauses while offline and resumes on reconnect (`reconnectService`/`reconnectClient`). `EXPEDITED` requests jump the queue.
- Retries: default `maxAttempts = 3`, `timeout = 60 s`, `maxRetryAfter = 180 s`. Retry on HTTP 429, 500, 503, 504, client timeout/abort/unknown, and on `ok:false` with `error` in `["ratelimited","rate_limited","rate_limit_exceeded","rate_limit_reached","ratelimit","rate_limit"]` or `internal_error`. Delay = `Retry-After` header seconds if present, else backoff: 60 s base for 429/503/`ratelimited`, 15 s for 504, 30 s for other 5xx, plus jitter capped at `maxRetryAfter`. Each retry adds `_x_num_retries`.
- Never retried (fatal auth/state errors): `invalid_args, invalid_auth, account_inactive, token_revoked, not_authed, missing_scope, org_login_required, active_migration, accesslimited, access_paused, two_factor_setup_required, user_in_no_workspaces, mobile_login_required, user_needs_to_accept_custom_tos, enterprise_active_migration`. A separate list of methods is never retried at all (e.g. `chat.command`, `conversations.view`, `search.*`, `oauth.*`).
- Boot-time "start errors" that trigger sign-out/relogin UI: `user_removed_from_team, account_inactive, team_disabled, invalid_auth, two_factor_setup_required, force_reload, clear_cache, org_login_required, team_added_to_org, ratelimited, accesslimited, access_paused, user_in_no_workspaces`. `invalid_auth` with context `disallowed_ip_address` is special-cased.
- Response envelope: `{ ok: boolean, error?: string, response_metadata?: { next_cursor?: string, messages?: string[] }, ... }`. Pagination: `cursor`/`next_cursor` for `conversations.history`/`replies` (plus `oldest`/`latest`/`has_more` windows), `marker`/`next_marker` for edge queries, `page`/`cursor` for search, `cursor` for `activity.feed`, `cursor_mark`/`next_cursor_mark` for usergroup search.
- History fetch loop protection: the client logs an error every 100 history fetches for one channel (`react_messages_loop_fetch`), implying no hard client-side rate limit on history.
- Socket rate limiting: `error.retry_after` on the socket, backoff capped at 60 s.
- Live, no Web API call has been rate limited yet: 0 in the 298 calls of the sync dry run and 0 in the 34 of the probe (section 10, "Live probe"). The value a real 429 carries in `Retry-After` is still Unknown.

Inferred

- Slack applies Tier limits per method and per token; the client's 60 s default backoff on 429 is a good default for Juno.

### Request pacing policy (2026-10-17)

The published [history](https://docs.slack.dev/reference/methods/conversations.history/) and [replies](https://docs.slack.dev/reference/methods/conversations.replies/) methods have Tier 3 limits (50+ per minute) for Marketplace and internal customer-built apps. Those pages also document a separate 1/minute policy for affected commercially distributed non-Marketplace apps. Neither policy establishes the limit of the internal `xoxc` session Juno uses. The live runs above only establish that 40/minute caused no 429.

Juno spaces background starts per method (2026-10-16, `SlackConfig.lanes.backgroundPacing`): `conversations.history` and `conversations.replies` 1,500 ms apart (40/minute), `search.modules.messages` 6,000 ms (10/minute), edge `users/info` and every other method 3,000 ms (20/minute), and any two background starts at least 500 ms apart (120/minute in total). Slack's tiers are per method, so independent methods now run side by side. Until then all background starts shared one 1,500 ms clock (40/minute in total); the 298-call live run measured about 40/minute across all methods. No method now starts more often than it could then, and each stays below the published tier of the public method of the same name (history and replies Tier 3, 50+; `search.messages` Tier 2, 20+), leaving room for the official client on the same token. This is evidence for a conservative budget, not a guarantee for the internal session token. Unknown: whether Slack also counts all methods of one token together; the 120/minute ceiling bounds that case.

Interactive reads use a separate token bucket: capacity 20, refill one token every 500 ms (2/second). Reconnect refetches beyond that allowance queue; waits release lane permits and recheck the method pause before dispatch. The send lane remains one in flight. The interactive budget is a local policy for normal use and bounded bursts, not a measured Slack allowance. The fake can inject method or global 429s but does not enforce a measured throughput limit.

A 429 retains Retry-After and doubles that method's background interval once per active pause window, capped at 60 s. Every 429 resets its quiet timer. After five minutes without another 429 the interval halves, then halves every further five quiet minutes down to that method's base. Existing start deadlines are retained. Interactive calls fail fast only for a method pause longer than five seconds, not because their token bucket is empty. Test overrides can disable background spacing and interactive refill waits independently.

`subscriptions.thread.getView` cannot be paged in parallel from the known API: `current_ts` is the last preceding page's `latest_reply`, not an offset or an independently obtainable cursor. Guessing timestamps risks gaps when activity is uneven or moves between requests. The existing sequential pass remains; increasing `limit` does not remove its 10-row cap.


## 7. Notifications

Observed (`boot-async` `ojMJ` `maybeShowNotification`; `shared` `shouldShowNotificationFor*`; `boot-async` `bMHo` reason table)

- The server decides candidates: a `desktop_notification` RTM event is sent for every message the server thinks should notify (mentions, DMs, keywords, thread replies you follow), with pre-rendered `title`/`subtitle`/`content`. The client only raises an OS notification from this event (handler `addRtmHandler("desktop_notification", maybeShowNotification)`); plain `message` events do not raise notifications by themselves (they only play sounds via `maybePlayMessageSentOrArrivedNoise`).
- Client-side gate (`shouldShowNotificationForDesktopNotification`, result 0 = show): skip when channel unknown (3), channel belongs to another org/team (24, 17), not a reply/root mismatch (7), the thread/huddle is active on screen (16), sender is hidden (29), message ts is newer than latest in store (19, duplicate guard), or the thread's `last_read >= ts` (20). `is_channel_invite` always shows. Dedup by a 100-entry processed-notification set (21). Also `fe_notification_clogging`, `pref-disabled` channel (`u0` pref check → `slack_settings`), in-progress streaming (33).
- Channel/DM message gates (used for sounds and legacy paths) add: `no_display`(4), `no_notifications`(5), reply/not reply (6/7), join/leave (8), bot/app without mention (9/10), own message (11), muted channel (12), DND (13; `_ignore_dnd` overrides, and a `dnd_override` RTM event re-runs the check), pref `nothing` (14), OS permission denied (15), active view visible (16), oversized mention (18), email-shared (22), app DM suppressed (23).
- Desktop display options passed through from the event: `skip_formatting: true`, `launch_uri`, `image_uri`, `avatar_image`. Sounds: pref `mute_sounds`; per-channel `desktop_notification_setting` of `everything | mentions | nothing`.

Inferred

- Juno should subscribe to `desktop_notification` as its "server says this matters" signal, then apply its own rules (section 14 of the spec) on top; it must not depend on `message` events alone for mention detection, but can compute mentions locally from `text` (`<@SELF>`, `<!here>`, `<!channel>`, usergroup ids from `subteams.self`) when the user has notifications muted.

Unknown

- Whether `desktop_notification` is sent when the client's notification prefs are "nothing" (the client-side gate suggests the server still sends and the client filters).

### Slack's notification schedule (DND)

Researched 2026-10-15 for the M10 backlog item. Sources: static reading of the bundles in section 0, plus one read-only live check against the same account with the cached dev session (`users.prefs.get` and `dnd.info` only, formats printed, values never printed or kept). No setter was called.

Observed

- **The schedule is a set of ordinary user prefs.** It has no endpoint of its own. The settings page component `DndPreferences` (`boot-async`, around module `SN+s`, which holds the key and value constants) reads these prefs and writes them with `setMultiplePrefsByApi`:
  - `dnd_enabled` (boolean): the schedule is on.
  - `dnd_days`: `every_day | weekdays | custom`.
  - `dnd_start_hour`, `dnd_end_hour`: notifications pause at `dnd_start_hour` and resume at `dnd_end_hour`, so the paused span crosses midnight. The page reads them backwards: "Allow notifications: [`dnd_end_hour`] to [`dnd_start_hour`]" (`JiU7` `BaseDndTimeSelect`). These two apply when `dnd_days` is `every_day` or `weekdays`. With `weekdays` the page says "You won't receive notifications on Saturday or Sunday."
  - Per day, used when `dnd_days` is `custom`, for `<day>` in `monday` to `sunday`: `dnd_before_<day>` (notifications start), `dnd_after_<day>` (notifications stop), and `dnd_enabled_<day>`: `all_day | disabled | partial`. `all_day` means no notifications that day: the page offers it as "None" for the start time, and only while fewer than 6 days are already `all_day`. `disabled` is drawn as allowed from 00:00 to 23:59 (inferred: no pause that day). Picking a time sets the day to `partial`.
  - `dnd_weekdays_off_allday` (boolean). Present in the constants and live, but the page code read does not use it.
  - Times are `"HH:mm"` strings in 30-minute steps from the client's picker (`qn32`), with `"23:59"` standing for midnight.
- **Live, `users.prefs.get`** with `prefs=<comma-separated names>` returned all 28 names asked for under `prefs`. `dnd_enabled`, `dnd_weekdays_off_allday` and `priority_dnd_override` are booleans. `dnd_days` and every `dnd_enabled_<day>` hold one of the enum values above. Hours came back in both forms: some `"H:MM"` without the leading zero, some `"HH:MM"`. The client pads to five characters before comparing (`kKOK`, `JiU7`), so a reader must accept both. Without arguments, `users.prefs.get` returned 729 prefs. The ones whose names mention dnd, VIP or priority are the keys above plus `dnd_custom_new_badge_seen`, `dnd_notification_schedule_new_badge_seen`, `mega_dnd_expiration`, `priority_dnd_override`, `priority_sidebar_section`, `scheduled_dnd_status`, `today_priority_channels` and `vip_users`.
- **The same keys are in `client.userBoot`** under `prefs`, so Juno can read the schedule at boot without another call. They are also under `team.prefs` and `workspaces[].prefs`, which are presumably the workspace's default schedule for new members (recorded fixture `client.userBoot.json`).
- **The boot `dnd` object** is `{ dnd_enabled, next_dnd_start_ts, next_dnd_end_ts, snooze_enabled }`, and `dnd.info` returns the same four fields plus `ok`. It holds the next pause, already worked out by the server in Unix seconds, not the schedule itself. `dnd.info` with `{ user }` adds `snooze_endtime` and `dnd_profile_status` when they apply (`shared` `fetchUserDndInfo`). `dnd.teamInfo` with `{ users: "<ids,>" }` returns `{ users: { <id>: { next_dnd_start_ts, next_dnd_end_ts, dnd_profile_status? } } }` (`fetchUsersDndInfo`).
- **`dnd_updated` and `dnd_updated_user`.** The handlers (`boot-async`, `dndUpdated` and `dndUpdatedUser`) read only `user` from the frame and refetch that person's DND with `dnd.teamInfo`. The `dnd_status` field in section 4 is never read. `dnd_invalidated` carries a list of `{ user }` and does the same. No `dnd_updated` frame was seen live, so its payload shape is still from the bundle only.
- **The setter.** It is `users.prefs.set` with a JSON object of prefs. Call chain: `DndPreferences.setDndPrefs(changes)`, then `setMultiplePrefsByApi({ ...changes, dnd_enabled: true })` (`shared` `N0Kh`, export `Hj`), which updates local prefs first and rolls them back on failure. That calls `setMultipleUserPrefsFetcher` (`shared` `Nu4c`, export `TZ`), then `apiCall` with:
  - method `users.prefs.set`
  - form fields `token`, `prefs` = `JSON.stringify({ <pref>: <value>, ... })`
  - `_x_reason=prefs-api/setMultipleUserPrefsByApi`

  After success the client fires a local `pref_change` for each key. The one-pref form is `users.prefs.set` with `{ name, value }` (`setUserPrefFetcher`). Every write from this page also sets `dnd_enabled: true`, and the page has no path that turns `dnd_enabled` off. Examples of what the page sends:
  - Every day, paused 18:00 to 09:00: `prefs={"dnd_days":"every_day","dnd_start_hour":"18:00","dnd_end_hour":"09:00","dnd_enabled":true}` (the page sends one key per change; sending several at once is the same call).
  - Custom Saturday, no notifications all day: `prefs={"dnd_enabled_saturday":"all_day","dnd_enabled":true}`.
  - Custom Monday, notifications 09:00 to 18:00: `prefs={"dnd_before_monday":"09:00","dnd_after_monday":"18:00","dnd_enabled_monday":"partial","dnd_enabled":true}`. When a new start is not before the stop, the page also moves the stop to the next half hour.
- **Snooze is separate from the schedule:** `dnd.setSnooze` `{ num_minutes }` (`shared` `Glrq`), `dnd.endSnooze`, `dnd.endDnd` (ends a scheduled pause now).
- **No channel can get through a pause.** The only DND exception in the bundle is for people. `shouldOverrideDndForMessage` (`shared`, near the `priority` store) lets a message through only when the pref `priority_dnd_override` is true, the sender (or a bot's `bot_profile.user_id`) is in the VIP list, and the message mentions someone or something or is in a DM. The VIP list comes from the `vip_users` pref, the `vip_users_updated` socket event and `users.priority.list`. The snooze dialog writes `priority_dnd_override` ("Everyone except VIPs"). The per-channel notification prefs (`all_notifications_prefs`, and `users.prefs.setNotifications` names `desktop`, `mobile`, `muted`, `suppress_at_channel`, `desktop_sound`) have no DND exception. The `dnd_override` socket event `{ channel, timestamp }` re-shows one message with `_ignore_dnd`. It fits the sender's "notify anyway" for a person in DND (a DM context-bar banner) and is not a setting. `silentSidebar.dndOverrideChannelIds` is local focus-mode state that is not synced. `today_priority_channels` is a JSON list for the Today view and is not used by the DND check.
- `scheduled_dnd_status` is the "After hours" profile status option on the Availability page (`{ show, cleared_ts }`), not the schedule.

Inferred

- To make the phone match Juno's notification hours, Juno writes `dnd_days: "every_day"`, `dnd_end_hour: <hours start>`, `dnd_start_hour: <hours end>` and `dnd_enabled: true` in one `users.prefs.set` call. If the hours differ by weekday, it writes `dnd_days: "custom"` with the per-day keys instead. Times are rounded to the half hour, because the official page cannot show other values, although it inserts an unknown value as an extra option.
- Pauses for mobile push are applied by Slack's server from these prefs, and `next_dnd_*_ts` show the server works out the times. Juno's desktop notifications are its own and do not depend on them.

Unknown

- Which time zone the server applies the hours in. Probably the profile `tz`; not checked.
- Whether the server stores values exactly as sent. Some live values come back without the leading zero, so either an older client wrote them or the server normalises them.
- Whether `users.prefs.set` returns the stored values, and whether the server sends `pref_change` and `dnd_updated` to the other clients after the write. Expected, but not seen.
- What `dnd_weekdays_off_allday` controls, and how `weekdays` applies the weekend (whole weekend paused, going by the page text).
- How `disabled` gets set for a day. The page code read never writes it.
- How Enterprise Grid org policy, or the workspace default under `team.prefs`, interacts with a user's own values.

## 8. Recommended minimal API surface for Juno v1

Transport
- `POST https://<workspace>.slack.com/api/<method>?_x_id=<8hex>-<unix.sss>&slack_route=<team>&_x_version_ts=<build ts from client-v2.html, or omit>&_x_app_name=client` with `multipart/form-data`, `token` first, `_x_reason=<short-reason>`, cookie `d` attached (Electron `session` with the decrypted cookie, or run inside the same Chromium profile). Honour `Retry-After`, retry 429/5xx up to 3 times with 60 s base backoff.
- Edge: `POST <api.getFlannelHttpUrl().url>/users/info?_x_app_name=client` with JSON `{ token, updated_ids:{…} | ids:[…] }` (fallback to `users.info`/`users.list` Web API if simpler).
- Websocket: `client.getWebSocketURL` → connect with `token`, `sync_desync=1`, `slack_client=desktop`, `start_args={"agent":"juno"...}`, `flannel=3`, `lazy_channels=1`, `batch_presence_aware=1`, `no_query_on_subscribe=1`; `ping` every 10 s; handle `hello`, `error`, `goodbye`, `reconnect_url`; exponential backoff on close.

Calls
1. Boot: `client.userBoot` (`return_all_relevant_mpdms=true`, `version_all_channels`), `client.counts` (`thread_counts_by_channel=true`), `users.prefs.get`, `api.getFlannelHttpUrl`, `client.getWebSocketURL`.
2. Topics: `subscriptions.thread.getView` (paged by `current_ts`) for followed threads; `conversations.history` (`ignore_replies=true`, `limit`, `oldest/latest`) for Main; `conversations.replies` for a topic; `client.counts` for unread badges.
3. Read state: `conversations.mark {channel, ts}`; `subscriptions.thread.mark {channel, thread_ts, ts, read}`; `subscriptions.thread.add/remove {channel, thread_ts, last_read}`.
4. Write: `chat.postMessage {channel, blocks(JSON rich_text) | text, thread_ts?, reply_broadcast?, client_msg_id, ts}`; `reactions.add/remove {channel, timestamp, name}`; `chat.update` for edits.
5. People and lookup: edge `users/info`, `users/search`, `channels/info`, `usergroups/info`, `emojis/list` (or `users.info`/`users.list`, `conversations.info` Web API equivalents); `users.prefs.get` for highlight words and muted channels.
6. Search: `search.modules.messages {query, page, count, extracts:1, highlight:1}`.
7. Live: RTM events `message` (+ `message_changed`, `message_deleted`, `message_replied`, `thread_broadcast`), `channel_marked`/`im_marked`/`mpim_marked`/`group_marked`, `thread_marked`/`thread_subscribed`/`thread_unsubscribed`, `update_thread_state`, `reaction_added/removed`, `user_typing`, `presence_change` (after `presence_sub`), `channel_joined/left`, `im_open/close`, `desktop_notification`, `pref_change`, `user_change`, `force_reload`, `user_session_expiration`.

## 9. Risks

- Terms of Service: using an `xoxc-` user session token outside the official client is against Slack's API ToS for third-party apps and can lead to the session or account being flagged. The app should be personal-use only, never ship tokens, and never automate posting at scale.
- Token and cookie coupling: `xoxc-` tokens are only valid with the `d` cookie session. Decrypting `Cookies` needs the "Slack Safe Storage" Keychain item (user prompt). If Slack rotates the session (`user_session_expiration`, `invalid_auth`, `token_revoked`) Juno must re-read `localConfig_v2` and the cookie, or ask the user to re-sign-in in Slack. The desktop app may re-encrypt cookies with a different scheme on Chromium upgrades.
- Undocumented methods (`client.userBoot`, `client.counts`, `subscriptions.thread.*`, `search.modules.*`, edge `users/list`) can change without notice; version-gate by `_x_version_ts` and keep fallbacks on public methods (`conversations.list`, `users.conversations`, `conversations.history`, `search.messages`).
- Rate limits: the official client stays under limits with one message in flight and 10 concurrent reads per team. Thread fan-out (one `conversations.replies` per topic) must be batched and cached; prefer `subscriptions.thread.getView` and `client.counts` deltas.
- Fingerprint/anti-bot params (`fp`, `_x_sonic`, `_x_gantry`, `slack_client=desktop`): unknown whether validated. Observed live: calls without `fp`, `_x_gantry`, `_x_sonic` and `_x_version_ts` succeed, and a socket without `start_args` and with a non-browser `User-Agent` receives events. Copying the official client's query params blindly is not safe either: `start_args` broke the socket (section 4).
- Enterprise Grid differences: `enterprise_id`/`enterprise_api_token` per team, `slack_route=<enterprise>:<team>`, org-wide threads (`update_global_thread_state`), `org_login_required`, and edge API URL per enterprise. The test account here is a single workspace; Grid paths are untested.
- Websocket allow-list: the client only accepts `wss-primary.slack.com`-style hosts; `fallback_websocket_url` is a backup region, not an alternate protocol.
- Local state coupling: reading `localConfig_v2` while Slack is running is safe (read-only leveldb copy), but writing to Slack's storage must never happen.

## 10. Live smoke results

`JUNO_LIVE=1 pnpm smoke:live` (`docs/development.md`, "Sign-in and the live smoke") against one single-workspace account, read-only. Counts and decode status only; the redacted shapes are in `packages/slack-schema/test/fixtures/recorded/` and decode in `packages/slack-schema/test/recorded.test.ts`.

| Call | Result | Decodes with `@juno/slack-schema` |
| --- | --- | --- |
| `auth.test` | ok | yes |
| `client.userBoot` | ok: 418 channels, 47 ims, no enterprise | yes, after making `emoji_cache_ts`/`app_commands_cache_ts` untyped (they are ts strings) |
| `client.counts` | ok: 218 channels, 27 mpims, 47 ims | yes |
| `subscriptions.thread.getView` | ok: 10 followed threads | yes, after making `unread_replies` optional |
| `conversations.history` | ok: 20 messages from one member channel | yes |
| `client.getWebSocketURL` | ok | yes |
| socket, 90 s | `hello`, `reconnect_url` ×2, `pong` ×8, `message` ×2 (`bot_message`, `message_changed`) | all known frames |

Problems reported by the smoke: 0. Two findings changed code: the socket must not send `start_args` (section 4), and `client.userBoot.channels` carries no membership or read state (section 2). Not yet seen live, so still only from the bundle reading: `conversations.view`, every write method, and socket frames other than the four above.

### Search, observed live (2026-10-13)

`search.modules.messages` with `module=messages`, `query="is:thread after:<date>"`, `count=50`, `page=1`, `no_user_profile=1`, `sort=timestamp`, `sort_dir=desc` answered `ok` with 50 items. Key names only, no values were read:

- Top level: `items`, `pagination` (`page`, `page_count`, `per_page`, `total_count`, `first`, `last`), `module`, `query`, `filters`, `ai_filters`, `manual_filters`, `filter_suggestions`.
- Every item: `channel` (an object with `id`, `name` and the `is_*` flags), `iid`, `team`, and `messages`, an array. The message fields are inside `messages`: `ts`, `text`, `user`, `username`, `permalink`, `iid`, `extracts`, sometimes `attachments` (with a numeric `ts`). No `thread_ts`, no `reply_count`, no `blocks`, no `files`, no reactions in the sample, so a reply's thread is known only from its permalink's `thread_ts` parameter.
- The flat shape the schema expected (fields on the item) did not decode; `@juno/slack-schema` now decodes both and `searchMatches` flattens them. The fake answers in the live shape.

Measured on 2026-10-15 ("Live probe" below): `is:thread` filters exactly, `sort=timestamp` is honoured, and with `extra_message_data=1` every match carries `thread_ts` and roots carry `reply_count`. The run above did not send `extra_message_data`, which is why it saw no `thread_ts`.

### The sync dry run

`JUNO_LIVE=1 pnpm sync:live` (`scripts/sync-live-dry-run.ts`, docs/development.md) ran the real `@juno/sync` cold boot read-only against the same workspace into a temporary directory, with the default `SyncConfig` (7-day window, 100-message history pages) and the default lanes (background calls 1.5 s apart). Aggregate numbers only:

| What | Number |
| --- | --- |
| Boot to `live` | 424 s; the sidebar data (`userBoot`, `counts`, `getView`) was complete after 29 s |
| Web API calls | 298: `conversations.history` 147 (312 s on the background lane), `conversations.replies` 114 (50 thread previews plus roots fetched for replies whose root was outside the window), `subscriptions.thread.getView` 32, one each of `client.userBoot`, `users.prefs.get`, `client.counts`, `client.getWebSocketURL`, `api.getFlannelHttpUrl`; edge `users/info` 2 |
| Rate-limit hits, decode issues, failed calls | 0, 0, 0 |
| `client.userBoot` conversations | 418 channels = 142 public, 76 private, 200 group DMs; 47 DMs |
| `client.counts` entries (members) | 142 public, 76 private, 27 group DMs, 47 DMs; 20 with unreads, 3 mentions |
| Followed threads (`getView`) | 322, in 32 pages of 10 |
| Stored after boot | 4 721 messages in 152 conversations (773 thread roots, 850 replies, 844 reactions), 147 synced ranges, 105 users |
| Topics | 152 Main, 773 threads; 19 Main and 34 threads unread, 6 Main as a dot (history does not reach the read pointer) |
| Sidebar, all topics, 7-day quiet rule | 910 rows (762 threads, 148 Main), 52 unread, 1 mention; `topics.list` for the 300-row window 3 to 4 ms, 386 KB of JSON |

What this changed or confirmed:

- The 418 "channels" of section 2 are 142 public + 76 private + 200 group DMs (`return_all_relevant_mpdms`). `client.counts` lists all 218 channels and 27 of the group DMs, so on this account the channels missing from `counts` are closed or stale group DMs, and membership from `counts` keeps them out of the sidebar (173 would otherwise show as Main topics). Whether `userBoot` also lists public channels the user is not in cannot be told from this account, which is in every public channel; the fake includes such channels and the sync drops them the same way.
- `subscriptions.thread.getView` returned 10 threads per page whatever `limit` said (`limit: 50` here, 20 in the smoke, 10 each time), so paging the followed threads costs one interactive call per 10 threads: 32 calls and about 20 s before the sidebar is complete. Inferred: the page size is capped at 10 server-side. A follow-up could page in parallel or stop earlier.
- `users.prefs.get`, `conversations.replies` and the edge `users/info` decode with the schemas as they are; `conversations.replies` with `oldest = latest_reply, inclusive, limit 2` gives the preview as designed.
- The cost estimate of architecture 5.1 holds: about one history call per active conversation, on the background lane at 1.5 s spacing, a few minutes for 150 channels.

### Live probe (2026-10-15)

`JUNO_LIVE=1 pnpm probe:live` (`scripts/probe-live.ts`, docs/development.md) against the same single-workspace account, read-only, with the cached session. 34 Web API calls in all (27 in the full run, 7 in two `--only search` runs), started at least 1.5 s apart, plus 3 GETs of one thumbnail. Counts, key names and milliseconds only; no value was printed or kept. Redacted shapes: `conversations.replies.json`, `search.modules.messages.json` and `users.prefs.get.json` in `packages/slack-schema/test/fixtures/recorded/`. Every response decoded with `@juno/slack-schema` where the method is in `Methods`.

#### 1. The cost of the M7 recheck (2026-10-15)

Run as a warm boot would run it now (architecture 5.8): the 10 most recently active topics of the last 24 hours, one page each, back 24 hours, `limit=100`. The probe picked them from `client.counts` `latest` and the first `getView` page, which approximates the store's `topic_index` (it misses unfollowed threads).

| What | Number |
| --- | --- |
| Member Main topics with activity in the last 24 hours | 84; the first `getView` page had 10 followed threads active in that time |
| Topics rechecked | 10: 8 Main (`conversations.history`), 2 threads (`conversations.replies`) |
| Calls | 10, one per topic. Latency 257 to 446 ms each |
| Time | 14.9 s. The 1.5 s background spacing sets it, not Slack: the recheck reads one topic after the other |
| Messages per page | Main 3 to 100, threads 4 and 9; 328 in all |
| Pages that did not reach back 24 hours | 1 of 10 (`has_more`, 100 messages in under 24 hours) |
| Rate limits, failures, decode issues | 0, 0, 0 |

Edits, from `edited.ts` on every message the probe read (827 distinct messages: the 10 recheck pages, 5 older Main pages that reached 1 to 30 days back, and 3 replies pages):

| Time from posting to the last edit | Messages |
| --- | --- |
| Under 1 minute | 32 |
| 1 minute to 1 hour | 33 |
| 1 hour to 24 hours | 6 |
| More than 24 hours | 0 |

71 of 827 messages (8.6 %) carried `edited`; 166 of them were older than 24 hours when read. No edit came more than 24 hours after its message. Limits: `edited` holds only the last edit; the sample is small; 523 of the 815 history messages were `bot_message`s, which bots often update soon after posting. Deletions and reaction changes leave no trace on a page, so their age cannot be measured this way.

#### 2. `conversations.history` with `ignore_replies` (2026-10-15)

- **Thread broadcasts are returned.** The 13 history pages (815 messages) held 33 `thread_broadcast` messages and no other reply. The one broadcast found in a replies page was also returned by a history read at its ts with `ignore_replies=true`, with subtype `thread_broadcast`.
- **`reactions` is left out when a message has none.** 27 of 828 messages carried `reactions`; none carried an empty array.

#### 3. `conversations.replies` with `oldest` (2026-10-15)

The root is always the first message, whatever `oldest` says. Seen in all 3 pages: a recheck page whose root is older than `oldest`, one whose root is newer, and `oldest = latest_reply`, `inclusive`, `limit=2`, which returned the root and the latest reply with `has_more: false`. So the root takes one place of `limit`.

#### 4. Retry-After (2026-10-15)

No 429 and no `ok:false` rate-limit error in the 34 calls, and no `Retry-After` header on any response. The value a real 429 carries is still Unknown. What is known comes from the bundle (section 6): the client waits `Retry-After` seconds when the header is there, 60 s for a 429 without it, at most 180 s, and the socket's `error.retry_after` is capped at 60 s. Juno's defaults are the same (`defaultRetryAfterMillis` 60 s, `maxRetryAfterMillis` 180 s). The sync dry run (298 calls at the default spacing) hit none either.

#### 5. Search with an `xoxc` session (2026-10-15)

`search.modules.messages` works for the session, and `is:thread after:<date>` does what the discovery sweep needs.

- **`is:thread` filters.** `is:thread after:<date>` counted 2 043 matches where `after:<date>` alone counted 5 887. All 80 `is:thread` matches on four pages were thread messages (each had `thread_ts` or a permalink with `thread_ts`); the page with `thread_ts` held 17 replies and 3 roots. Of 20 matches of `after:` alone, at least 10 were plain messages (checked against history pages).
- **`after:` excludes the named day.** No match was older than the end of that day (UTC).
- **`sort=timestamp`, `sort_dir=desc` is honoured.** Every page was newest first. A query without `sort` was also newest first (20 of 20), so whether leaving it out gives relevance order is Unknown.
- **Pagination is by page.** `pagination: { page, page_count, per_page, total_count, first, last }`, numbers; no `response_metadata` and no cursor. `count=20` gave 20 matches per page.
- **Every item holds exactly one message** (145 of 145 items). Item keys: `channel`, `iid`, `team`, `messages`.
- **Channel object:** `id`, `name`, `is_archived`, `is_channel`, `is_group`, `is_im`, `is_mpim`, `is_private`, `is_shared`, `is_ext_shared`, `is_org_shared`, all present; `user` on DMs; `is_pending_ext_shared` and `pending_shared` on some.
- **Message keys depend on `extra_message_data`.** With the discovery sweep's arguments (`no_user_profile`, `sort`, `sort_dir`, no `extra_message_data`): `ts`, `text`, `user`, `username`, `permalink`, `iid`, `extracts`, and on most `blocks`, `blocks_extracts`, `blocks_extracts_typed`, sometimes `attachments`. No `thread_ts`. With the official client's arguments (`extracts=1`, `highlight=1`, `max_extract_len=200`, `extra_message_data=1`) every thread match also carries `thread_ts`, roots carry `reply_count` and `latest_reply`, and bot messages carry `subtype`, `bot_id`, `bot_profile` and `icons`; `files` (2 of 20) and `reactions` (1 of 20) appear when the message has them.
- **No highlights.** With `highlight=1` and `extracts=1`, by time or without `sort`, `extracts` was an empty array on every match (80 of 80), and no string in any match held U+E000/U+E001 or any other private-use marker, or an `<em>`, `<b>` or `<mark>` tag (one `<em>` was inside a snippet file's `preview`, which is file content). `blocks_extracts` and `blocks_extracts_typed` are `rich_text` blocks of `rich_text_section`s of `text` elements, with no style in the sampled elements. How the official client highlights is Unknown; Juno must mark the query terms itself.
- **Latency** 300 to 540 ms per call. No rate limit in 11 search calls.

#### 6. Files (2026-10-15)

From the messages read above: 6 files (3 `png`, 2 `mov`, 1 `markdown` snippet; `mode` `hosted` ×5, `snippet` ×1). One `files.info`, and 3 GETs of one image's `thumb_64`.

- **Every file:** `id`, `created`, `timestamp`, `name`, `title`, `mimetype`, `filetype`, `pretty_type`, `user`, `user_team`, `username`, `size`, `mode`, `editable`, `is_external`, `external_type`, `is_public`, `public_url_shared`, `display_as_bot`, `is_starred`, `is_modified_by_ai`, `has_rich_preview`, `skipped_shares`, `file_access`, `url_private`, `url_private_download`, `permalink`, `permalink_public`; `media_display_type` on 5 of 6.
- **Images:** `original_w`, `original_h`, `thumb_64`, `thumb_80`, `thumb_160`, `thumb_360` and `thumb_480` with `_w`/`_h` on 360 and 480, `thumb_tiny`, and `thumb_720`, `thumb_800`, `thumb_960`, `thumb_1024` with their `_w`/`_h` only when the original is large enough.
- **Videos:** `mp4`, `hls`, `hls_embed`, `thumb_video` with `_w`/`_h`, `duration_ms`, `transcription`, `media_progress`, `is_transcription_region_supported`. No `thumb_360` and no `original_w`/`_h`.
- **Snippets:** `preview`, `preview_highlight`, `preview_is_truncated`, `lines`, `lines_more`, `edit_link`.
- **`url_private` host:** `files.slack.com` for all 6.
- **`files.info { file }`** returns `{ ok, file, comments, paging }`. The file has the keys above plus `channels`, `groups`, `ims`, `shares`, `has_more_shares`, `comments_count` and `favorites`.
- **Download auth is the `d` cookie.** GET of `thumb_64`: no credentials gave 302 to a sign-in page; the `d` cookie alone gave 200 with an image content type; `Authorization: Bearer <xoxc token>` without the cookie gave 302 to sign-in. Fetching through the `persist:slack` session (architecture 9) is the right path.
- **Upload.** Not tested in this probe. The later bundle reading in section 3 documents the official composer’s internal `files.getUploadURL`, multipart POST, `files.completeUpload` and `files.share` flow. Architecture 9 follows that flow. See "Upload probe" below.
- **Upload probe** (2026-10-16, one synthetic 640×400 PNG and a short comment in the owner's self-DM with the cached `xoxc` session and socket open; the file was deleted afterwards; key names only). The composer flow works as section 3 describes: the upload POST answered HTTP 200. `files.completeUpload` answers `{ ok, files }` with each file as `{ id, title }` only. `files.share` answers `{ ok, file_msg_ts }`, with no files. On the socket, in order: the message echo (top-level `upload`, `files`, `client_msg_id`, `blocks`), whose file has no `thumb_*` and no `original_w`/`original_h` (it has `id, name, title, mimetype, filetype, pretty_type, size, mode, url_private, url_private_download, permalink`, `skipped_shares` and the usual flags); then `file_shared` (`file_id, file: { id }, channel_id, user_id, ts, event_ts`); then about 0.2 s later `file_thumbnail_generated` (`file_id, client_file_id, permalink, thumb_64, thumb_80, thumb_160, thumb_360, thumb_480, thumb_url, event_ts`, no `_w`/`_h` and no original size) and `file_created` (`file_id, file: { id }`). No `file_change` and no `message_changed` for the message came in the next 30 s. `files.info` 0.3 s after the share already had `original_w`, `original_h`, `thumb_tiny`, `thumb_64/80/160` and `thumb_360/480` with `_w`/`_h`, plus `channels, groups, ims, shares, has_more_shares, comments_count, favorites`. So a sent image's message never carries thumbnails unless the client asks again; Juno asks `files.info` (architecture 9, "Late thumbnails").
- **File census** (2026-10-17, read-only: `client.counts`, one `conversations.history` page of 100 for each of the 20 most recently active conversations, `files.info` for 6 files, and 15 minutes of socket; key names and counts only). History: 257 files, 128 images, 22 videos, 102 text (`mode: email` ×100), 5 other. Every image had `original_w`/`original_h`, `thumb_64/80/160/360` and `thumb_tiny`, and larger sizes as the original allowed. Every video had `thumb_video` with `thumb_video_w`/`_h` and `hls`; 20 of 22 had `mp4`, and none had `thumb_360` or `original_w`/`_h`. `file_access` was `visible` and `is_external` false on all 257, so no partial or other-workspace file was seen; `check_file_info` and Slack Connect shares stay unobserved here. `files.info` answered the same keys plus `channels, groups, ims, shares, has_more_shares, comments_count, favorites`. On the socket, files came on `message`, `message_changed` and `message_replied` frames (all with thumbnails in this window), and `file_shared` ×5, `file_change` ×1 and `file_public` ×1 carried `file: { id }` alone. Together with the upload probe: an image or video is shown inline from `mimetype` plus, for an image, a `thumb_360/480/720` with a size (`original_w/h` or `thumb_360_w/h`), and for a video, `thumb_video` with its size; without them it is a card. A message stored from the socket before those fields exist is not sent again, and a topic's open reads only history newer than what is stored, so the card stayed until Juno asks `files.info` (architecture 9, "Late thumbnails").

#### 7. Notification schedule (2026-10-15)

Confirms the read of the same day in section 7, "Slack's notification schedule".

- **`users.prefs.get`** without arguments: `{ ok, prefs }`, 729 prefs. The schedule keys are there with these types: `dnd_enabled`, `dnd_weekdays_off_allday`, `priority_dnd_override`, `priority_sidebar_section`, `dnd_custom_new_badge_seen`, `dnd_notification_schedule_new_badge_seen` booleans; `dnd_days` and the seven `dnd_enabled_<day>` enum strings; `dnd_start_hour`, `dnd_end_hour` and the fourteen `dnd_before_<day>` / `dnd_after_<day>` time strings, again a mix of `H:MM` and `HH:MM`; `vip_users`, `today_priority_channels` and `scheduled_dnd_status` strings; `mega_dnd_expiration` a number.
- **`dnd.info`** without arguments: `{ ok, dnd_enabled, next_dnd_start_ts, next_dnd_end_ts, snooze_enabled }`: two booleans and two Unix-second numbers. `dnd.info` is now in `@juno/slack-schema`'s `Methods`, with a synthetic fake-server test of this shape.

#### 8. Users (2026-10-16)

Why the first real session showed user ids instead of names. `JUNO_LIVE=1 pnpm probe:live -- --only users`: `client.userBoot`, `client.counts`, `api.getFlannelHttpUrl`, 8 history pages (the most recently active member conversations, 50 messages each), then the ids those reference through the edge `users/info`, one page of edge `users/list` and one of `users.list`. 14 calls, no rate limit, nothing failed or failed to decode. Counts only.

| What | Number |
| --- | --- |
| Member DMs, member group DMs | 46, 26; all 26 group DMs carry `members` in `client.userBoot` |
| Distinct user ids referenced | 57: 46 DM partners, 24 group DM members, 18 senders and 13 mentions on the 310 messages read, 25 in `reply_users`; none start with `W` |
| `users/info` for all 57, one call | 57 returned as an array, `failed_ids` 0, `pending_ids` 0, `invalid_ids` 0. 12 from another team (`team_id` differs, `is_stranger` set: Slack Connect), 15 bots, 23 with an empty `profile.display_name` |
| Edge `users/list`, `count=100` | `ok`, 100 results, a `next_marker` |
| `users.list`, `limit=200` | `ok`, 200 members, a `next_cursor` |
| Messages whose `text` holds `&amp;`, `&lt;` or `&gt;` | 7 of 310 |

So the edge answers every id the sync asks about, Slack Connect users included, and the names were missing because of when and what Juno asked. The cold boot fetched users once, after the history of every active conversation (several minutes on the background lane, section "The sync dry run"); the ids it asked for were senders and DM partners only, never group DM members, mentions or repliers; and the views fell back to the raw id. Since then the sync names the people of every DM and group DM right after `client.counts`, names the people on each boot page before it lands, and asks for anyone else as soon as they appear, all on the interactive lane (`packages/sync/src/users.ts`). An empty `display_name` is common, so the shown name falls back to the real name, then the handle.

### Live reactions (2026-10-16)

`JUNO_LIVE=1 pnpm react:live` (`scripts/react-live.ts`) runs the whole engine on the cached session in a temporary directory. The transport refuses every write except reactions and posts in the self-DM and deletes of the posts the run made. It reacts through the real path: `messages.react`, the `outbox` row, `ActionWorker`. Shapes and codes only:

| Call | Target | Name | Slack's answer | `reactions.get` after |
| --- | --- | --- | --- | --- |
| `reactions.add {channel, timestamp, name}` (form fields `_x_mode, channel, timestamp, name`) | message from history | `+1` | `ok` | mine |
| same | same | `+1::skin-tone-2` | `ok` | mine |
| same | same | custom (bare name, from `emoji.list`, 306 custom) | `ok` | mine |
| same | same | a name no emoji has | `invalid_name` | absent |
| `reactions.remove`, the three above | same | | `ok` each | none left |
| `reactions.add` while Juno's post was still sending (row waited on `depends_on`) | own new post | `+1` | `ok`, sent with Slack's ts | mine |
| add and remove | own post, then a thread reply to it | `eyes`, `+1` | `ok` each | as asked |
| `reactions.add` at a ts no message has | self-DM | `+1` | `message_not_found` | |

Every row ended within 0.3 to 2.5 s of the command. The two test posts were deleted through Juno (`chat.delete`, `ok`); nothing was left over.

Then, read-only, `reactions.get {channel, timestamp}` for up to six stored messages of each kind in a fresh boot's store (4,769 messages; by conversation kind, membership, root, reply or plain, subtype, own or others'): 47 kinds, every answer `ok`. So Slack finds every stored message by the pair a reaction names, thread broadcasts, bot, huddle and join messages included.

And `emoji.list {include_categories: true}` lists 1,859 standard names in 9 categories. Of the picker's 1,867 emoji (emoji-datasource 16), 16 have no name in that list, mostly person variants (`bearded_person`, `shrug`, `face_palm`); whether Slack refuses them is Unknown.

What this means for Juno: the call Juno makes is right. Slack answers `message_not_found` to a reaction on a message it does not have, and the worker counted that answer as "already done" for reactions as for deletes, so it stored a reaction Slack never took and the chip stayed. It now treats that answer as a refusal for reactions.

#### 9. Profile photos (2026-10-16)

Why users showed initials instead of photos. Same `--only users` run as section 8, which now also prints how photos are spelled. Counts and host names only.

| Source | Users | `image_24` to `image_512` | `image_original` | `avatar_hash` | `is_custom_image` |
| --- | --- | --- | --- | --- | --- |
| Edge `users/info` | 57 | none | 42 | 57 | `true` on 42, absent on 15 (never `false`) |
| Edge `users/list` | 100 | none | 43 | 100 | `true` on 43, absent on 57 |
| `client.userBoot` `self` | 1 | none | 1 | 1 | `true` |
| `users.list` (web) | 200 | all 200 | 149 | 200 | `true` on 149, absent on 51 |

- On `users.list`, `image_72` is on `avatars.slack-edge.com` for custom photos (149), on `secure.gravatar.com` with a `d=` default on `a.slack-edge.com` for default photos (50), and on `a.slack-edge.com` once.
- The edge profile carries no photo url at all, only `avatar_hash` (and `image_original`, a custom photo's full-size upload). The official client builds the url from the hash: `<team.avatar_base_url><team_id>-<user id>-<avatar_hash>-<size>`. `client.userBoot` `team.avatar_base_url` is `https://ca.slack-edge.com/`.
- One GET of that url at size 72, for one user with a custom photo and one without, answered 200 with `image/jpeg` and `image/png`, with or without the `d` cookie, and no redirect. Default photos have a hash too.
- All 57 users had a `team_id` starting with `T`. Whether Enterprise Grid users need the enterprise id in the url is not known.

So the sync stored no photo for anyone: `toUserRow` read only `image_48`, `image_72` and `image_192`, which the edge never sends. It now builds the url from the hash when those are missing (`packages/sync/src/write/users.ts`), and the fake answers the edge calls without them.
