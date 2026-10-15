# Slack desktop local data

Findings dated 2026-10-16, Asia/Kolkata. The inspection ran on 2026-10-15 UTC against Slack desktop 4.52.178 on one Mac and one signed-in workspace, with Slack running.

Recommendation: **(c) keep the API boot and make it faster.** Slack does persist useful workspace data, including messages, without application-level encryption in the inspected stores. It is a partial, delayed client snapshot, not a second authoritative Slack database. Importing it could show some content sooner, but does not safely remove the API work that establishes current membership, follows, read state and history coverage. The adaptive background lane being built separately addresses a measured source of delay without another private schema dependency.

## Sources and method

Observed

- Read [the session and API research](slack-data-access.md), [the desktop shell research](slack-desktop-shell.md), architecture sections 2.3, 5 and 14, `packages/sync/README.md`, ADR 0011, and the existing session importer.
- The active profile was `~/Library/Application Support/Slack`. The candidate App Store location, `~/Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support/Slack`, was absent. App Store behaviour remains untested.
- Copied only `IndexedDB` and `Local Storage` into a private temporary directory. Parsed the copies with CCL Chromium Reader 0.3.18, revision `ef840de30221c4d65bc96d2f4d9057e9ef2f526d`, and temporary Python aggregation scripts. No database engine opened the live stores. Cache headers and shell JSON were read as ordinary files. No keychain lookup, session decryption or Slack API call was needed.
- Selected the highest LevelDB sequence per **user key**, then discarded deletion records before decoding IndexedDB values. Internal table keys include a sequence trailer, which must be removed for this comparison. The first scan incorrectly treated old versions as distinct keys and reported missing blobs. After correcting that selection, the current Redux record and its external blob decoded with no errors. Those initial errors were a reader issue, not evidence of cache corruption.
- Output was limited to aggregate counts, sizes, ages and allowlisted schema fields. Temporary profile copies, scripts and reader installation were deleted after inspection. No Slack files were changed or locked, and no Slack writes were made.

The existing [CCL reader](https://github.com/cclgroupltd/ccl_chromium_reader) supplied format decoding, not a production import design. A raw scan can recover obsolete versions as well as current data. Counting every decoded record would substantially overstate what Slack currently stores.

## What is on disk

Observed directory sizes, including metadata and obsolete records, in bytes:

| Store | Files | Bytes | Role observed |
| --- | ---: | ---: | --- |
| `IndexedDB` | 9 | 3,602,820 | Workspace Redux snapshot and small additional databases |
| `Local Storage` | 10 | 575,408 | Session configuration and immediate UI persistence |
| `Cache` | 5,622 | 448,814,516 | Mostly CDN assets, plus file resources |
| `Service Worker` | 2,378 | 426,559,985 | Cache Storage, worker database and scripts |
| `Session Storage` | 7 | 65,501 | Present, not decoded in this inspection |
| `storage` | 1 | 4,893 | Desktop shell Redux state |

### IndexedDB and the workspace Redux store

Observed

`IndexedDB/https_app.slack.com_0.indexeddb.leveldb` contains five database definitions. `reduxPersistence` has the object store `reduxPersistenceStore`. Its current workspace record points to an external file under the sibling `.indexeddb.blob` directory. That file is 2,897,704 bytes and decodes into a 138-key object. The stored form uses a Blink external-blob envelope, then Snappy compression and V8 structured serialization. It is not plain JSON on disk.

Three `objectStore-<scope>` database definitions contain `sundryStorage`, with one current record across them. A fifth database has 270 current records; its application meaning was not established. Neither is counted as additional message coverage.

The decoded Redux snapshot contains:

| Field | Observed structure and count |
| --- | --- |
| `members` | 113 user objects, with profile and update fields |
| `channels` | 497 conversation objects, including DMs and group DMs; 489 have `is_member=true`, eight false; 211 have nonempty member arrays |
| `membership` | Empty map. It is not a complete membership source by itself |
| `channelCursors` | 316 channel read timestamps |
| `channelLatests` | 324 latest-message timestamps |
| `threadSub` | 676 subscription records; 675 carry `lastRead` |
| `unreadCounts` | Aggregate counts, 295 `initialUnreads` entries and 23 `countsPerChannel` entries |
| `messages` | Timestamp-keyed maps for 172 conversations, 108 nonempty; 3,575 message-shaped objects |
| `channelHistory` | 1,031 entries for channel and thread history; 131 match conversation keys, with 386 slices |
| `reactions` | Separate map with 1,242 entries. No message object has an inline `reactions` field |

There are 3,542 message-shaped objects dated within the preceding seven days, in 97 conversations. Of these, 253 have a positive `reply_count` and 784 have a valid `thread_ts` different from their own timestamp. Sixty of the 97 conversations have at most ten recent objects, 33 have 11 to 100, and four have more than 100. Only 1,826 recent objects have nonempty text. Empty text alone does not prove a stub, since file and other message types can have empty text.

Messages include blocks, edit fields and file references. There are 98 objects with nonempty file references across the full snapshot. Importing messages would also need the separate reactions and files stores and Slack's transforms, rather than treating each object as a complete `conversations.history` response.

The cached web bundle confirms the meaning of the fields. In `gantry-v2-shared.js`, module `CrEL` defines `channelCursors` through `setChannelLastRead`; module `6Yed` stores history `slices` and `reachedStart`/`reachedEnd`; `threadSub` stores subscriptions with `lastRead`. These are evidence references to the same extracted bundles described in the API research, not repository files.

### Freshness

Observed

- The Redux blob's modification time and newest cached message were both about 3.4 hours old. The oldest cached message was about 543 days old. A cache can retain old messages while missing newer ones.
- `unreadCounts.countsLastFetched` was about 5.4 hours old; its thread update timestamp was about 3.4 hours old.
- The IndexedDB log had been modified about eight minutes before the initial inventory, while Local Storage's log was about 33 seconds old. A recently modified directory or log therefore does not establish freshness of the workspace snapshot.
- Of the 131 conversation history entries, 38 had `reachedEnd=true` and 15 had `reachedStart=true`. These flags and slices were not validated against current API history.

Inferred

- Freshness is per record and per kind of state. A message timestamp establishes message age, not the last time Slack checked it for edits or deletion. A read timestamp establishes where the user read to, not when the cache observed that mark.
- The snapshot reflects Slack's use and persistence policy, not Juno's seven-day coverage requirement. Slack running does not guarantee continuous persistence of every conversation.

Unknown

- Persistence cadence, eviction limits, and coverage after a long Slack session or a cold start. This was one snapshot, not a longitudinal test.
- Exact overlap with a simultaneous API result, including missing messages, edits, deletions, reactions and departed conversations.

### Local Storage, Cache Storage and shell persistence

Observed

- Local Storage has `localConfig_v2`, used by Juno's current session import. Its current value contains 179,813 characters. The existing research documents its workspace/session configuration shape.
- Current immediate persistence includes scoped `persist-v1` entries for drafts, expandables and accessibility. These are not a second channel-history database. Drafts alone contain 114,590 characters and must not be imported as sent messages or queued actions.
- A header-only scan found 5,617 Chromium simple-cache entries under `Cache`: 5,274 with Slack CDN keys, 207 file-resource keys, 14 Slack app keys and 122 other keys. Under `Service Worker/CacheStorage`, 2,357 entries comprise 2,348 CDN keys, four app keys and five other keys. Neither scan found a key containing `/api/` or `edgeapi.slack.com`. Bodies were not exhaustively classified.
- `storage/root-state.json` is the shell's Redux persistence, distinct from the web client's IndexedDB Redux snapshot. It includes `appTeams`, `teams`, `settings`, `downloads` and `_persist`. This matches the desktop shell research.

Inferred

- Most of the roughly 875 MB in the two cache areas is not a reusable workspace history store. The CDN-heavy inventory and earlier bundle extraction explain why a large Slack profile does not imply a complete local message archive.
- The useful import candidate is the workspace IndexedDB snapshot. HTTP cache scraping and shell Redux import add little evidence of further history coverage.

## Can Juno read it?

Observed

The inspected workspace snapshot, Local Storage and shell JSON were readable without Safe Storage keys. Compression and serialization obscure their bytes but do not encrypt these values. The session cookie is a different case: the current importer copies `Cookies`, obtains the Slack Safe Storage password and decrypts the cookie before placing it in Juno's session. Session import already has a read-only LevelDB scanner in `packages/slack/src/import/leveldb.ts`.

The cached client has multiple persistence mechanisms. Its typed store registry enables object stores for `channels`, `members` and `messages`; the inspected profile instead holds those values inside the Redux snapshot. `ObjectStoreShardDiskCache` opens schema version 317 and can add, remove and clear stores during upgrades. `getStoredStateIfValid` rejects out-of-date persisted data using a minimum supported data version and `versionDataTs`.

Inferred

Juno can technically decode this installation's cache. A production reader would need Chromium LevelDB keys, logs, tables and compression, Blink envelopes, external blob resolution, V8 decoding, Slack reducer transforms and version checks. The existing token scanner covers only the first portion. Slack's shell version alone cannot pin the format because the web client is delivered separately.

Unknown

Compatibility across Slack releases, remote web builds, App Store installations, enterprise policies and encrypted-content configurations. No claim of general plaintext storage or a stable Slack export format follows from this one installation. Electron documents macOS keychain-backed encryption for [Safe Storage](https://www.electronjs.org/docs/latest/api/safe-storage), not a guarantee that every Chromium or application store uses it.

## How much cold boot could it save?

The earlier [live dry run](slack-data-access.md#the-sync-dry-run) measured 424 seconds to `live`, with sidebar data complete after 29 seconds. It made 298 Web API calls plus two edge user calls: 147 history calls, 114 reply calls, 32 followed-thread pages and five other Web API calls. History took 312 seconds on the background lane. The later ten-topic probe took 14.9 seconds with individual calls taking 257 to 446 ms. The fixed 1.5-second start spacing was a measured constraint, and neither run hit a rate limit.

Inferred estimates, not a cache-import benchmark:

- **Users and channels only, option (b).** The 113 users and 497 conversation records could populate labels early. The earlier boot needed only two batched edge user calls, while `userBoot` already fetched conversation metadata in one call. Even perfect overlap saves at most those two user lookups and perhaps the metadata portion of one boot call. `userBoot` still supplies self, team and other boot state, and live reconciliation remains necessary. This cannot explain or remove hundreds of history/reply calls.
- **Messages too, option (a).** The 3,542 recent cached objects are a substantial possible display seed. They cannot be subtracted from the earlier boot's 4,721 messages as an exact overlap: observation times differ, payloads differ, and history completeness is unknown. Recent objects in 97 conversations do not prove the 147 current history requests can be skipped. The 676 subscription records likewise do not prove coverage of the 322 followed threads returned by the earlier windowed `getView` run.
- **Safe request reduction today.** No history or reply call has been demonstrated redundant. Conservatively, retain all authoritative boot and reconciliation requests. Cache import could improve time to first cached content, but there is no defensible seconds-saved estimate for time to a correct `live` state from this inspection.

The adaptive background lane changes the trade-off materially. It can reduce the scheduling delay for every required history, reply and user request, including first launch on machines without Slack data. Its resulting speed and rate-limit behaviour still need measurement. Cache seeding would then compete with that faster API boot, while retaining its schema and reconciliation costs.

## Risks and correctness requirements

Inferred design constraints if cache seeding is reconsidered:

- **Running Slack and locks.** Never open the original database with `level` or another database engine, remove its `LOCK`, or attach Juno's Chromium profile to Slack's directory. LevelDB permits one process to open a database and takes an OS lock, as its [concurrency documentation](https://github.com/google/leveldb/blob/main/doc/index.md#concurrency) states. Copy into a private temporary directory and parse there without taking the original lock.
- **Copies are not atomic snapshots.** Compaction, appended logs and blob replacement can race a directory copy. Include tables, manifests, logs and sibling blobs, validate references and complete records, and retry a bounded number of times or fall back to API boot. Successful decoding here proves one copy was readable, not that every concurrent copy is consistent. Discarding old versions and tombstones is essential. Do not recover deleted records into Juno.
- **Schema changes.** Recognize supported shapes and data versions, validate at the import boundary and fail closed to normal API boot. Do not run Slack's cached JavaScript or migrations. Unknown versions must not block sign-in.
- **Privacy.** Importing a session does not imply permission to retain drafts, search history, download paths or every workspace's content. Any future data import should explicitly describe the additional cache read, bind it to the authenticated workspace and user, import only allowed fields, retain no raw profile copy, and use Juno's existing sign-out deletion. This research was explicitly authorized to inspect local data.
- **Membership and reads.** Cached `is_member`, member arrays, read pointers and follows are provisional. Their semantics and completeness differ from Juno's full `client.counts` membership replacement and windowed subscription reconciliation. Do not create outbound marks, subscriptions or sends from cached Slack intent.
- **Messages and merge ordering.** Feed a seed through a dedicated provisional-data path in `@juno/sync`. Keep tombstones dominant, newer edits and event reactions protected, and pending local read/follow intent intact under the existing architecture 5.4, ADR 0011 and Quint protocols. Import time is not an API request-start time: stamping a stale cache page as fresh would defeat those guards. Cached counters can also be stale or inconsistent with deletions, so applying maximum-counter rules blindly is insufficient.
- **Coverage.** Do not set `sync_state.boot`, advance `lastSyncAt`, claim `synced_ranges`, or mark a thread complete from message presence alone. Slack slices require separate validation before any translation into Juno coverage. Connect the socket and perform the normal API reconciliation; missing cache entries do not establish deletion, departure or unfollow.

## Decision and remaining evidence

Choose **(c)** for the current boot work. The expensive part is collecting history, replies and followed-thread pages under conservative scheduling. The cheap labels are already batched, and the available messages do not establish complete or current coverage. An adaptive lane has broader benefit and avoids a second import format.

Revisit option (a) only if measured first-content latency remains poor after that change. The next useful experiment would compare a cache snapshot with a simultaneous read-only API boot in memory, reporting overlap counts, verified continuous ranges, missed edits/deletes and import cost only. It would also need more Slack builds and a running-client copy-race test. Option (b) is technically smaller than (a), but its small call budget saving does not currently justify maintaining the reader.

This note proposes no sync behaviour change and adds no cache importer.
