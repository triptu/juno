# How the Slack client syncs message drafts

Scope: how the official Slack client keeps message drafts in step with Slack's servers, so Juno can sync its per-topic drafts with the Slack desktop and mobile apps. Target: Slack desktop 4.52.178 (`/Applications/Slack.app/Contents/Info.plist`), running the web client build `data-version-ts="1792532253"`, `data-build-number="134909"`. Read on 2026-10-27. The evidence is static reading of the cached bundles, plus read-only calls and self-DM writes against one single-workspace account ("Observed live"). No draft text, token, cookie or id is reproduced here.

## 0. Sources and method

Observed

- Bundles came from the newest Service Worker cache entry, `gantry-1792532253` (623 entries) under `~/Library/Application Support/Slack/Service Worker/CacheStorage/<hash>/`. A new extractor (`/Volumes/AgentWork/juno-drafts-re/scripts/extract_simple_cache.py`, outside the repo) reads Chromium simple-cache `_0` files. The body (stream 1) runs from the end of the key to the stream-1 EOF record, whose size field is 0, so the size comes from the record's position. In this cache the bodies were stored uncompressed (`brotli -d` failed on all 623 and the bodies were plain text); earlier caches were brotli-encoded (`slack-data-access.md` section 0).
- A small splitter kept only the webpack modules that mention "draft", and prettier 3 formatted them. Bundle names have changed since `slack-data-access.md`. Short names used below:
  - `cbs` = `gantry-v2-async-client-boot-shared.35cfcda49f6375c9.min.js`: draft thunks (create, update, sync, reconcile, schedule), the message composer, send paths.
  - `cbr` = `gantry-v2-async-client-boot-render.5e213601c2e4c669.min.js`: socket draft handlers, the boot fetch, the drafts page, bulk delete.
  - `cb` = `client-boot.c7150e67f4bccc17.min.js`: the drafts store and its selectors, draft accessors, the delete thunk, the offline queue, the debounce helper.
  - `cbv` = `gantry-v2-async-client-boot-vendors.e3d23989a8a4ebad.min.js`, `vendors` = `gantry-v2-vendors.5955d74ca8ca84ac.min.js`: generated per-method fetchers with their error code lists.
- Module ids and function names are cited as `bundle` `moduleId` `functionName`. Generated fetchers take camelCase arguments and send snake_case (`cbv` `uGgu` `createApiMethodFetcher`).
- Live: five probe scripts (scratch, not in the repo) used the cached dev session (`juno-dev-slack-session`). Reads: `auth.test`, `client.userBoot` (to find the self-DM), `experiments.getByUser`, `drafts.list`, `drafts.listActive`, `drafts.info`. Writes were limited to the self-DM, and updates and deletes only touched drafts and messages the probe had made, with text like "juno draft test 1". A socket was open the whole time. Output was key names, value kinds and lengths, booleans and error codes only. Everything made was deleted, except two drafts that were sent: their messages were deleted, but the draft records stay on the server as inactive `is_sent` records, because `drafts.delete` refuses sent drafts.

## 1. Methods

Observed (`cbv`/`vendors` fetcher registry; call sites named per row)

| Method | Arguments the client sends | Answer | `_x_reason` values seen |
| --- | --- | --- | --- |
| `drafts.list` | `is_active` (bool), `limit` (25), `next_ts` (cursor). `last_updated_ts` exists in the fetcher but no caller passes it (`cbs` `h/H5` `fetchDraftsApi`) | `{ ok, drafts: Draft[], files: File[], has_more }`, no cursor in the answer | `client-v2-boot-team` (boot), `fetchDraftsOnReconnect`, `attached_draft_exists:recovery` (with `limit: 100`) |
| `drafts.listActive` | `limit` (1000), `next_ts` (`cbs` `h/H5` `fetchActiveDraftIds`) | `{ ok, active_draft_ids: string[], has_more, next_ts }` | same as the fetch that called it |
| `drafts.info` | `draft_id` (`cbs` `UYdH`) | `{ ok, draft: Draft, files }` | `resolve_draft_conflict` |
| `drafts.create` | `blocks` (JSON string), `client_msg_id` (uuid), `destinations` (JSON string), `file_ids` (JSON string), `attachments`, `unfurl` (JSON), `is_from_composer`, `date_scheduled`, `date_stashed`, `file_permissions` (`cbs` `/S/P` `createDraftApi`) | `{ ok, draft: Draft, files }` | the reason given to `setDraft`: `MessageInput:updateDraft`, `syncDraftsOnReconnect`, `schedule-draft`, `draft-management-save-as-draft`, `addFileIdToDraft`, `undoSendLastMessageInChannel`, `attached_draft_exists:recovery`, `select-stashed-draft-*`, and others |
| `drafts.update` | `draft_id`, `client_last_updated_ts`, `blocks`, `destinations`, `file_ids`, `attachments`, `unfurl`, `date_scheduled` (only when scheduling), `date_stashed`, `is_from_composer`, `file_permissions` (`cbs` `/Y7u` `updateDraftApi`) | `{ ok, draft: Draft & { client_last_updated_ts }, files }` | as for create, plus `resolve_draft_conflict_force_update` |
| `drafts.delete` | `draft_id`, `client_last_updated_ts`, `skip_file_deletion` (`cb` `m4U8` `deleteDraftApi`) | `{ ok }` | the reason given to `clearDrafts`: `MessageInput:updateDraft`, `InputContainer:sendMessage`, `DeleteDraftModal`, `draftsListenerBefore`, `deleteDraftsWithoutTextOrFilesOrGifUnfurls`, `syncDraftsOnReconnect`, `attached_draft_exists:recovery`, and others |
| `drafts.bulkDelete` | `draft_ids` (JSON) or `is_select_all: true`, `client_last_updated_ts` (now) (`cbr` `bulkDeleteDraftsApi`) | not read beyond `ok` | `modal-bulk-delete-drafts` |

- There is no `drafts.get` (the grep hit was `canvases.drafts.get`), no separate scheduled-drafts method and no `chat.scheduleMessage` call: scheduled messages are drafts with `date_scheduled` (section 9). The Drafts page reads the same drafts store.
- Error codes declared for `drafts.create` (`cbv` `b7oz`): `invalid_channel`, `invalid_draft`, `invalid_thread_ts`, `invalid_client_msg_id`, `must_provide_thread_ts_and_broadcast`, `invalid_unattached_thread_draft`, `both_blocks_and_text_provided`, `must_provide_blocks_or_text`, `both_user_ids_and_channel_id_provided_in_destination`, `invalid_destinations_count`, `attached_draft_exists`, `invalid_message`, `msg_blocks_too_long`, `file_not_found`, `invalid_user_ids`, `invalid_time`, `time_in_past`, `time_too_far`, `error_setting_timer`, `unable_to_create_draft`, `scheduled_draft_cannot_be_attached`, the `invalid_unfurl_*` and `invalid_file_permissions_*` codes, `message_limit_exceeded`, `team_access_not_granted`. For `drafts.delete` (`vendors` `mbK/`): `draft_not_found`, `unable_to_delete_draft`, `draft_has_conflict`, `draft_delete_invalid`. For `drafts.update` the client checks `draft_already_deleted`, `draft_already_sent` (with `sent_message: { channel, ts }`) and `draft_has_conflict` (`cbs` `UYdH`).

Observed live

- The server draft object, the same in `drafts.list`, `drafts.info`, create and update answers and socket events:

```ts
interface Draft {
  id: string                    // "Dr" + 10 characters
  client_msg_id: string         // uuid, echoed exactly as sent at create
  user_id: string
  team_id: string
  date_created: number          // epoch seconds, integer
  last_updated_ts: string       // "1792000000.123456", seconds with microseconds
  last_updated_client: string   // "" for the probe's writes; 5, 6 or 20 characters on drafts written by official clients
  blocks: RichTextBlock[]       // an array in answers; sent as a JSON string
  file_ids: string[]
  is_from_composer: boolean
  is_deleted: boolean
  is_sent: boolean
  date_scheduled: number        // 0 when not scheduled
  destinations: Array<{
    channel_id?: string
    user_ids?: string[]         // the server adds it to DM destinations
    thread_ts?: string
    broadcast?: boolean         // the server adds false to thread destinations
    message_ts?: string         // added once the draft is sent
  }>
  unfurl?: unknown              // present on some drafts
  client_last_updated_ts?: string  // only in update answers and draft_update events: "1792000000123.456000", ms with 6 decimals
}
```

- `drafts.list` caps `limit` at 100 (asked for 200, got 100 with `has_more`). Drafts come newest first by `last_updated_ts`. `next_ts` is exclusive: it returns only drafts older than it. `last_updated_ts` works as a changed-since filter: it returns only drafts updated after it.
- `is_active=true` returns only live drafts. `is_active=false`, or no `is_active`, returns everything, including deleted (`is_deleted`) and sent (`is_sent`) records. So `drafts.list { last_updated_ts: <cursor> }` without `is_active` is a feed of changes since the cursor, with deletions and sends included. The official client does not use it.
- `date_stashed` was absent on the 50 drafts whose keys were listed (none were stashed).

## 2. Keys and destinations

Observed (`cb` `Bxxi`, `cb` `jd0U`, `cb` `wmAi`)

- The client keeps a local key, `client_draft_id`, alongside the server's `id`:
  - Attached drafts (`is_from_composer: false`), the text sitting in a channel's or a thread's message box: the key is `<channel_id>` or `<channel_id>-<thread_ts>` (`encodeDraftKey`). The reducer gives each one a random `temp_attached_draft_unique_id`; that uuid is what goes to the server as `client_msg_id`.
  - Composer drafts (`is_from_composer: true`), from the "new message" composer, saved stashes and scheduled messages: the key is a random uuid, sent as `client_msg_id`.
  - From a server draft the client recovers the key with `getDraftClientIdFromServerDraft`: `client_msg_id` for composer drafts, `channel_id[-thread_ts]` from `destinations[0]` for attached drafts.
- Destinations are built by `createDraftDestinations`: one `{ channel_id }` per channel, plus one `{ user_ids: [...] }` for people with no conversation yet. The send path opens that DM or group DM at send time (`cbs` `BxQG` `prepareDraftForSend`). Thread destinations add `thread_ts` and the "also send to channel" flag as `broadcast`.
- When reading server drafts, `getNormalizedDraftDestinations` drops `user_ids` from attached drafts and from thread destinations. A composer draft with both `channel_id` and `user_ids` and no thread keeps only `user_ids`.
- One destination can have only one attached draft, but any number of composer drafts. The client caps composer drafts at 500 (`cbs` `CqO9` `hasMaxComposerDrafts`, which shows a "maximum number of drafts" toast).

Observed live

- A second attached `drafts.create` for the same self-DM answered `attached_draft_exists`. A thread destination without `broadcast` was accepted, and the server added `broadcast: false`. A composer draft with `thread_ts` and no `date_scheduled` was accepted.

When two attached drafts collide (`cbs` `9XoJ` `handleExistingAttachedDraft`, `cbr` `lOiM` `reconcileNewDraft`):

- A `draft_create` event or listed draft for an attached key that already exists locally is ignored: the local draft wins.
- When the local draft is later created and the server answers `attached_draft_exists`, the client calls `drafts.list { is_active: true, limit: 100 }` and finds the server draft with the same destination. If that draft is already in the local store, it stops. Otherwise it deletes the server draft (`client_last_updated_ts` = now, `skip_file_deletion: true`) and creates the local one again. For channel drafts (not threads) it first copies the other device's text into a new composer draft, so that text moves to the Drafts list. For thread drafts the other device's text is dropped.

## 3. Versions and conflicts

Observed

- Local fields (`cbs` `9XoJ` `setDraft`, `cb` `wmAi` `setLocalDraft`): `last_updated` is set to `Date.now()` (ms) on every local change. `last_updated_ts` is the server's `last_updated_ts` (seconds, as a float), stored after each successful create or update.
- `drafts.update` and `drafts.delete` send `client_last_updated_ts = String(last_updated)`, the local edit time in ms. `drafts.create` sends no version. Bulk delete and the collision delete send the current time. Nothing else that looks like a revision is sent. The client never reads `last_updated_client`.
- Handling of update errors (`cbs` `UYdH` `syncDraftUpdates`) only runs when the experiment `draft_syncing_reconciliation` is `"on"`:
  - `draft_already_deleted`: drop the local draft.
  - `draft_already_sent`: drop the local draft, then call `chat.delete` on `sent_message { channel, ts }` (reason `delete_duplicate_sent_draft`).
  - `draft_has_conflict`: call `drafts.info`. If the server's `last_updated_ts` is newer than the local `last_updated_ts`, the client stores only the server's `id` and `last_updated_ts`; it does not load the server's blocks ("Accepting server version"). Otherwise it sends the same update again (reason `resolve_draft_conflict_force_update`).
  - Any other error, or any error when the experiment is off: log only. No retry, and the local draft stays.
- Applying a server draft (`cbs` `giv0` `reconcileUpdatedDraft`, used by list fetches and `draft_update` events): it applies only if the server's `last_updated_ts` is greater than the local `last_updated_ts` and greater than local `last_updated / 1000`. So the later wall-clock edit wins, and a local edit made after the remote one keeps the local text.

Observed live

- `client_last_updated_ts` of `1000`, or a time in seconds instead of ms, answered `draft_has_conflict` on both update and delete.
- Values from 30 days in the past to 1 hour in the future were all accepted, in any order. That held even after a future value had been stored, and with `_x_csid` changed between writes to look like a second client. `drafts.info` does not return the stored `client_last_updated_ts`.
- `_x_csid` does not set `last_updated_client`.
- Updating a deleted draft or a sent draft answered `draft_update_invalid`, not `draft_already_deleted` or `draft_already_sent`. Deleting either answered `draft_delete_invalid`.

Inferred

- The real conflict rule probably compares against writes from a different client (possibly through `last_updated_client`), which one session cannot reproduce. Sending the true local edit time in ms, as the official client does, is the safe choice.

## 4. Socket events

Observed live (the probe's own socket received each of its own writes)

```ts
{ type: "draft_create", draft_id, draft: Draft, event_ts }
{ type: "draft_update", draft_id, draft: Draft & { client_last_updated_ts }, event_ts }
{ type: "draft_delete", draft_id, client_msg_id, event_ts }
{ type: "draft_send",   draft_id, client_msg_id, event_ts }   // after chat.postMessage with draft_id
```

- A rejected update (`draft_has_conflict`) sent no event. Sending a draft gave `message`, then `im_marked`, then `draft_send`. Nothing in the payload names the writing client apart from `last_updated_client`.

Observed (`cbr` `handleDraftCreate`, `handleDraftUpdate`, `handleDraftDelete`, registered for `draft_create`, `draft_update`, `draft_delete` and `draft_send`)

- `draft_create`: ignored when the draft's client key is in the "update in flight" list; otherwise `reconcileNewDraft`. That adds the draft unless the key or the unique id already exists locally, or the unique id belongs to a draft already sent.
- `draft_update`: ignored when no local draft has that server `id` (updates to unknown drafts are dropped, not added) or when the id is in flight. Otherwise `reconcileUpdatedDraft` applies the timestamp rule above.
- `draft_delete` and `draft_send`: the client first marks `client_msg_id` as sent in the `draftSending` store. Then, if a local draft has that `id` and the id is not in the "delete in flight" list, it removes the local draft (`cbs` `EEuM` `reconcileRemovedDraft`).
- Own-write echoes are suppressed three ways. Ids are added to in-memory lists (`cbs` `lw9w`) for the duration of a create, update or collision delete (the client key for creates, the server id for updates). Echoes arriving later fail the timestamp rule, because the client has already stored the server's `last_updated_ts`. A delete removes the local draft first, so its echo finds nothing.
- `draft_create` also arrives nested in file DLP events as `draft_create: { draft, draft_id }` (`cbr` `ensureAndGetDraft`).

How a change from another device reaches an open message box (`cbs` MessageInput `handlePropChanges`):

- The draft appears and the box is empty: the text is filled in.
- The draft is removed (deleted or sent elsewhere) and the box has text: the box is cleared, even when focused, unless an IME composition is in progress or this box made the deletion.
- The draft's text changes: the box is updated only when the experiment `thread_draft_sync_fix_round_2` is `"on"`, the box does not have focus, no composition is in progress and the text differs. A focused box keeps its text, and the next local keystroke overwrites the store and then the server.

## 5. Boot and catch-up

Observed

- Local copy: the `drafts` store is saved immediately to Local Storage under `persist-v1::<team>::<user>::drafts` (`cb` `wmAi`, `persistImmediately`). It holds `{ channelIds, withheldDraftIds, unifiedDrafts: { [client_draft_id]: LocalDraft }, … }`, where a local draft has `client_draft_id`, `id?`, `is_from_composer`, `date_created` (ms), `last_updated` (ms), `last_updated_ts` (s), `destinations`, `ops` (Quill delta), `file_ids`, `cursor_index`, `temp_attached_draft_unique_id?`, `date_scheduled?`, `date_stashed?`. The offline queue `draftOffline` (`{ pendingCreates, pendingUpdates, pendingDeletes }`) is saved the same way (`cb` `DJwS`).
- Boot (`cbr` `fetchedDeferredMessagingClientData`, then `cbs` `h/H5` `maybeFetchDrafts`): standalone workspaces fetch on every boot. Enterprise Grid fetches once per org per session, keyed by enterprise id; the cache resets when the slow-connection count changes.
- `fetchDrafts` runs two things in parallel:
  - `fetchActiveDrafts`: `drafts.list { is_active: true, limit: 25 }`, paging with `next_ts` = the last draft's `last_updated_ts` until `has_more` is false or 200 drafts are fetched.
  - `purgeInactiveDrafts`: `drafts.listActive { limit: 1000 }` paged, then every local draft with a server id that is not in the list is removed. This is skipped when there are no local drafts.
- `reconcileDrafts`, for each fetched draft, matching by server `id`:
  - `is_deleted` or `is_sent`: remove the local copy if there is one; otherwise ignore.
  - Known: `reconcileUpdatedDraft`.
  - New: `reconcileNewDraft`.
- Reconnect (`cbs` `updateDraftsOnReconnect`, on socket `connected` and `resynced`): drafts are fetched again unless the connection was a fast reconnect or the first slow connection. The `draftOffline` queue is then replayed at once: creates, deletes, then updates, and the queue is cleared.
- No code was found that pushes, at boot, a local draft that has no server id and is not in the offline queue (for example after a quit inside the debounce window). Such a draft is pushed on its next edit.

## 6. When drafts are saved

Observed

- Stage 1, message box to local store (`cbs` MessageInput): `updateDraftThrottled` is a lodash `debounce` (`S6U4`) of `draftDelay` = 1000 ms, trailing only. The "new message" composer page uses 10 ms. The experiment `message_input_draft_fast_lane` adds a separate 150 ms leading-and-trailing write to the local store only; it is `"off"` on this account.
- Stage 2, local store to server (`cb` `iW73` `debounceDraftSync`, `cbs` `fCtk` `getDraftSyncDebounceMs`): a lodash debounce per draft key, 3000 ms when `draft_syncing_reconciliation` is `"on"`, else 10000 ms. It is trailing only, with no `maxWait`, and every local store write resets it. `setDraft` skips both the store write and the sync when nothing that counts has changed (`isComposerDraftEqual` compares `id`, `last_updated_ts`, destinations, `ops`, `file_ids`, `date_scheduled`, the composer flag and `mpdm_name`). So cursor-only moves never sync.
- Result: steady typing never saves. A save goes out about 1 s + 10 s after the last keystroke on this account (the experiment is unassigned).
- Flushes:
  - Stage 1 is flushed on message box unmount, on a channel or thread switch (draft key change), on paste of URLs, before opening schedule-send, and as soon as the box's text becomes empty.
  - Stage 2 is never flushed: its timer outlives the component.
  - No `beforeunload` or `pagehide` handler touches drafts. A quit inside the window loses the server write but keeps the local copy.
- Sync immediately, with no stage-2 wait: offline queue replay, save as draft or stash, adding a file, undo send, schedule, and a few autofill paths.
- Deletes are not debounced: when the box becomes empty, stage 1 flushes and `clearDrafts` calls `drafts.delete` right away (with `skip_file_deletion: true`). It also cancels a pending stage-2 sync, so a draft that never reached the server is never created.
- Sending cancels both pending stages (`cancelPendingDraftUpdates`, `cancelPendingDraftSync`).
- In-flight requests: no per-draft lock. Each debounced fire calls `drafts.create` (no server id yet) or `drafts.update`; the in-flight lists only suppress socket echoes.
- Offline: when `connectivity.clientOnline && serviceOnline` is false at fire time, the draft key is queued in `draftOffline` (an update is not queued while a create is pending; a delete cancels a pending create) and replayed on reconnect. Online failures are logged and not retried.
- A create is put off while uploads are pending and the draft has no text and no file ids (`cbs` `3aw4` `syncDraftCreate`).

## 7. Text format

Observed

- Locally a draft is a Quill delta (`ops`) plus `cursor_index`. At sync time `blocks` is built with the same converter as `chat.postMessage` (`cbs` `eZ9b`: `processMsgOps`, then `convertDeltaToComposerBlocks`) and sent as a JSON string. Empty ops become `[{"type":"rich_text","elements":[]}]` (`cbs` `Z5bH`).
- The client never sends `text`. The server would accept `text` instead of `blocks` (`must_provide_blocks_or_text`, `both_blocks_and_text_provided`).
- Mentions, links and formatting are ordinary `rich_text` elements, as in messages.
- Reading a server draft (`cbs` `xgGU` `convertServerDraftToUnifiedDraft`): the client loads the users, channels and files the blocks mention (2 s timeout), then converts the blocks back to ops. In the `plain_text_mode` pref, unscheduled drafts become mrkdwn text when that loses nothing.
- Empty drafts are deleted, not updated to empty: a box with no text, files or GIF/block unfurls calls `clearDrafts`. On navigation, empty drafts that are not on screen are cleared too (`cb` `deleteDraftsWithoutTextOrFilesOrGifUnfurls`, `draftsListenerBefore`).

Observed live

- Blocks come back as an array with `block_id` added: `rich_text`, then `rich_text_section`, then `text` or `user` (`{ type: "user", user_id, from_llm: false }`). An update to empty `rich_text` was accepted.

## 8. Send

Observed

- Channel and thread message box (`cbs` `InputContainer` `sendMessage`, then `prepareAndSendMessage`):
  - `clearDrafts` removes the local draft. It calls `drafts.delete` only when the text is a slash command (`syncDelete` = `s4/N`, "starts with `/x`").
  - `xArgs` comes from `getDraftExtraArgs` (`cbs` `bstn`): `draft_id` = the server `id` when known, else the unique id (`temp_attached_draft_unique_id` or the composer key), and `send_as_user_id` when relevant.
  - Text-only messages spread `xArgs` into `chat.postMessage`. Messages with files go through `files.share` with the same `xArgs`.
- Drafts page and composer sends (`cbs` `4Nr8` `sendDraftMessage`, `sendComposerMessage`) do the same: local clear without `drafts.delete`, then send with `draft_id`. `sendDraftMessage` puts the draft back locally if the send fails.

Observed live

- `chat.postMessage` with `draft_id` set to the server id, and separately set to the draft's `client_msg_id`, both worked: the server marked the draft `is_sent: true`, added `destinations[0].message_ts`, removed it from `drafts.listActive`, and sent `draft_send`. So the server deletes the draft on send; the client does not call `drafts.delete`.

Unknown

- `files.share` with `draft_id`, and `draft_id` for a draft the server never saw, were not tried live.

## 9. Scheduled, files, stashed, deleted

Observed

- Scheduled messages are composer drafts with `date_scheduled` (epoch seconds; 0 means not scheduled) (`cbs` `j0q6` `scheduleDraft`):
  - Scheduling sets `is_from_composer: true`. It calls update when the draft has a server id, else create, sends `date_scheduled` (update sends it only in this path), and then applies the server answer with `forceReconciliation`.
  - "Save as draft" on a scheduled message reschedules to 0.
  - Errors: `invalid_time`, `time_in_past`, `time_too_far`, `error_setting_timer`, `scheduled_draft_cannot_be_attached`.
  - A scheduled thread draft is a composer draft with `thread_ts`.
- Files:
  - `file_ids` is a JSON array, and the answers list the files in `files`.
  - A create waits for uploads (section 6), and the client allows at most 10 files per draft (`cbs` `8eD2`).
  - `drafts.delete` has `skip_file_deletion`. The emptied-box and collision paths set it to true; the delete-draft dialog leaves it false.
- Stashed drafts: `date_stashed` (ms) on composer drafts, from "Save as draft" in the message box (experiment `draft_management_in_composer`). `populateMessageComposerWithStashedDraft` swaps a stash into the attached slot, turning the current attached text into a stash.
- Deleted and sent drafts are kept on the server, flagged `is_deleted` or `is_sent`. They are listed with `is_active=false` and returned by `drafts.info` (Observed live). The client ignores records it does not have and removes the ones it has.
- Threads: attached thread drafts are keyed `<channel>-<thread_ts>` and carry `broadcast`. Each channel and each thread has its own attached draft, which matches Juno's topics (one Main per conversation, plus threads).
- DMs not opened yet: composer drafts with a `{ user_ids }` destination. The DM is opened at send.

## 10. Other things Juno needs

Observed

- Experiments that change draft behaviour, with this account's groups (`experiments.getByUser`, Observed live):

  | Experiment | Effect | This account |
  | --- | --- | --- |
  | `draft_syncing_reconciliation` | 3 s instead of 10 s sync debounce; handling of update errors | not assigned (10 s, errors only logged) |
  | `thread_draft_sync_fix_round_2` | update an unfocused message box from remote changes | `on` |
  | `message_input_draft_fast_lane` | 150 ms local writes | `off` |
  | `draft_management_in_composer` | stashes, "Save as draft" | not assigned |

- No workspace pref or flag turns draft sync off; it runs for every team. On Grid the fetch is once per org (section 5).
- There are no draft-specific rate limits in the client; calls go through the normal API queue. The client's own caps: 200 drafts per fetch, 500 composer drafts, 10 files per draft. The server's: 100 drafts per `drafts.list` page.

Inferred, for Juno's design

- Map each topic to one attached draft: Main to `{ channel_id }` and a thread to `{ channel_id, thread_ts, broadcast }`. Keep the server `id` and the `client_msg_id` uuid Juno generated.
- Send `draft_id` on `chat.postMessage` (and on `files.share`) instead of deleting the draft. When the text is emptied, call `drafts.delete` at once.
- Send `client_last_updated_ts` as the local edit time in ms.
- Expect `attached_draft_exists` when another device made the draft first. Read it, adopt it or merge, then update it; avoid a blind delete.
- Treat `draft_update_invalid` and `draft_delete_invalid` as "this draft was deleted or sent elsewhere", and confirm with `drafts.info` (`is_deleted`, `is_sent`).
- Catch up with `drafts.list { last_updated_ts: <cursor> }` without `is_active`, which includes deletions and sends, paging with `next_ts`. Then follow the four socket events, dropping echoes of Juno's own writes by id while a write is in flight and by comparing `last_updated_ts`.
- Never replace the text in a focused message box from a remote change. Clearing it on `draft_send` from another device matches Slack.
- The timestamp rule compares wall clocks across devices, so clock skew decides close races.

## Unknowns

- The server's real conflict rule for `client_last_updated_ts`. One session could only trigger `draft_has_conflict` with values below about 2e9 (not plausible ms); cross-client conflicts were not reproduced.
- What `last_updated_client` holds (5, 6 or 20 characters on official clients' writes, empty for the probe's) and how the server sets it. Not `_x_csid`.
- When the server answers `draft_already_deleted` or `draft_already_sent` instead of `draft_update_invalid`. Possibly another server-side flag. What `sent_message` refers to, and why the client deletes that message.
- Whether `last_updated_ts` and `next_ts` combine for paging a long changes feed (each was tested alone).
- Whether `is_active=true` includes scheduled drafts (the account had none), and the exact server meaning of `invalid_unattached_thread_draft` (a composer thread draft without a schedule was accepted).
- `files.share` with `draft_id`, `draft_id` for a draft the server never saw, `date_stashed` round-trips, and `drafts.bulkDelete` answers. None were tried live.
- Whether the server deletes a draft's files on `drafts.delete` without `skip_file_deletion` (inferred from the argument name).
- Rate limit tiers for `drafts.*`.
- Enterprise Grid: whether `drafts.*` needs the org token or the team token, and whether drafts are org-wide (the once-per-org fetch suggests so). Not checked on a Grid account.
- How the mobile apps debounce and apply remote changes. Only the web and desktop client was read.
