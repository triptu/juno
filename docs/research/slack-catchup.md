# Slack catch-up after a disconnect or restart

Research on 2026-10-18, IST. Juno base `746fe6db03f24148e80131c3208c1d45eafcc0cf`.
No product code changed. All live calls were reads on the cached Slack-app
`xoxc` session with its `d` cookie. No Slack content or credentials were saved.
Examples below use invented values.

## Answer and recommendation

Slack has `activity.feed`, but it is a personal notification feed, not a
workspace change log. The more useful discovery is that **`client.counts`
already supplies conversation mutation timestamps**. Slack's client compares
`updated` and `history_invalid` with its cached values to invalidate history,
including threads. Juno reads these fields in its schema but does not use them
to select mutation repairs.

Recommend a mutation-aware counts pass, followed by conditional history and
reply reads of the dirty cached ranges. Reuse the counts call Juno already makes.
Keep the existing bounded recheck until controlled tests establish which mutations
advance these timestamps. This research verifies the fields, Slack's use of them,
and conditional responses, but does not prove that every edit, delete and reaction
updates them. It establishes no single-call, complete message catch-up endpoint.

The likely saving depends on how many ranges changed. If three topics need one
page each, repair takes three calls instead of ten, a 70% reduction in the extra
recheck calls. Fifteen dirty topics take at least fifteen calls, but cover changes
outside today's arbitrary ten. Those are estimates, not measured Juno speedups.

## Evidence and limits

Read `CLAUDE.md` and all existing `docs/research/` before probing. Relevant prior
work is [Slack data access](slack-data-access.md), especially sections 2, 3, 4
and 10. Also read architecture section 5 and the Slack and sync package READMEs.

Evidence labels used here:

- **Source:** direct reading of Slack's cached client JavaScript, not a traffic
  recording of a running official client. This establishes call paths and guards,
  not which feature flags the current account enables.
- **Live:** read-only requests or sockets from this machine on 10-18. Request
  bodies and responses stayed in memory. Output was counts, field names, enum
  values, booleans and validation errors only. HTTP reads started at least 1.5 s
  apart, without retries or attempts to discover a rate ceiling.
- **Inference:** a proposed design or interpretation requiring further validation.

The original `/tmp/juno-re/webclient/pretty` extraction is now empty. The same
named bundles remain under `/Volumes/AgentWork/scratch/slack-huddle-rea/webhttp/`.
These are static CDN assets, not saved API responses. Sources used:

| Reference | Bundle and anchors | SHA-256 |
| --- | --- | --- |
| S1 | `gantry-v2-shared.c702ca6ba455738b.min.js`: `sQEb`, `fetchClientCountsData`, `fetchHistory`, `fetchReplies`, `fetchLastEkmChangeTimestamp`, `fetchAndUpsertSavedList` | `5bbd1c480e64822fc4c109b5f895ebbdc870f0b4ab3e01a3fb7c4801027ac375` |
| S2 | `gantry-v2-async-gantry-v2-shared-boot-async.df256c9e690d80a1.min.js`: `FhIQ`, `OJaN`, `yDDn`, `Oy+F`, `OKAK`, `Dg2p`, `ufh7`, `BaseSocketManager`, `fetchActivityFeed` | `50baad8e99e70aa4dcd0ef7acb383caa96705ae7099f26bd2e9b6c1fc26a6d37` |
| S3 | `client-boot.51f971944b5407a4.min.js`: `applyCountsToChannels`, `FhIQ`, `fetchMessagesData` | `20546f2aed5ff87575f557561831ccc2110e227e50a6cf0cf780d4d0878c1a65` |
| S4 | `gantry-v2-async-client-boot-render.7148d6b7b6276353.min.js`: `loadBootApisData`, `provisionallyConnectedSideEffectHandler` | `3f2d4103953d68e46634dce6052fa424631796209ed2ba6bf52c75a10e7fe5f4` |

S1-S3 have the filenames recorded by the original research. S4 is another cached
chunk; its precise build relationship to those files was not established. Other
cached boot-render variants also call counts on slow reconnect. No claim here
requires every cached chunk to belong to one deployed build.

Temporary probe programs are in `/Volumes/AgentWork/scratch/slack-catchup-research/`.
They read the existing `juno-dev-slack-session` keychain entry into memory and
never write it. They are investigation scratch, not product code or committed
fixtures. No official Slack client was restarted, disconnected or driven through
UI that could mark messages read. All investigation sockets were closed.

## What the official client does

**Source, S1-S4 and the previous research:**

1. At boot, `client.userBoot` supplies workspace and conversation metadata,
   `client.counts` supplies reads, unreads and mutation markers, and
   `conversations.view` supplies the opened conversation's messages. Other boot
   calls include `client.init`, extras, prefs and feature flags. This is not one
   `client.boot` request that returns all missed messages.
2. It gets a socket endpoint from `client.getWebSocketURL`. It does not use
   `rtm.connect` or `rtm.start` as its normal socket setup path.
3. A short reconnect tries the server-supplied `reconnect_url`, containing `frt`.
   The client discards a URL received more than 285 seconds ago. This is a client
   eligibility window, not a measured server replay retention guarantee.
4. On slow reconnect, S4's provisional-connect handler reloads boot APIs and
   independently calls `client.counts`. Counts processing compares mutation
   markers with the persisted `channelMutationTimestamps` store. `history_invalid`
   advancing purges cached channel history with `includeThreads: true`.
   Otherwise, `updated` advancing invalidates its history for refetch.
5. The client has `desync` and `resync` socket handlers. A resync invalidates
   affected channel/thread caches or broader state according to the affected
   subscriptions. It does not assume the socket always delivers everything.
6. `Eventlog.onSocketConnected` replays a separate HTTP event log on a slow
   connection when it has a previous event timestamp. It skips that replay on
   a fast connection unless the last replay was aborted. On a first connection
   without a timestamp it records the current time instead. Overflow and
   `timestamp_too_old` trigger gap recovery. See the restricted event set below.
7. Thread and Activity views refresh according to view state. S2 explicitly
   refreshes a visible All Threads view on slow reconnect. These view reads are
   not evidence that Slack scans every thread at boot.

**Live:** a new investigation socket received `hello.fast_reconnect=false`.
Reusing its `reconnect_url` after a five-second gap received
`hello.fast_reconnect=true`. A second experiment kept an observer connected
while another socket was absent for 16 seconds. No timestamped event arrived
during that gap, so it could not establish replay coverage. Events outside the
gap do not count as replay evidence.

**No `last_event_ts` replay contract found.** The public
[`rtm.connect` reference](https://docs.slack.dev/reference/methods/rtm.connect/)
lists presence options, not a last-event cursor. The inspected socket setup
uses `frt`, not `last_event_ts`. A successful HTTP call with an unknown argument
would not establish that the argument is honored. Juno already retains and
uses fresh `reconnect_url` values in `packages/slack/src/client/socket.ts`.
Do not count that existing behavior as a new saving, or skip reconciliation
solely because a reconnect URL was attempted.

## Candidate comparison

For all undocumented methods below, the rate tier and server retention are
**unknown unless stated**. Successful reads at conservative spacing do not
establish a rate tier. All successful live rows used the same existing token
and cookie; no additional OAuth scopes or credentials were acquired.

| Candidate | Coverage and live result | Reach and paging | Rate evidence |
| --- | --- | --- | --- |
| `client.counts` | Live success. Conversation IDs, latest message, read pointer, unread/mention counts, `updated`, `history_invalid`, thread summaries. No message bodies or mutation operations. Best candidate to locate dirty conversations. | Current snapshot, not historical events. No cursor observed. `counts_last_fetched` reduces fields, not necessarily the number of IDs. Exact delta retention unknown; use full counts after restart. | Internal tier unknown. |
| `users.counts` | Live success after one initial transport failure. Legacy `channels`, `groups`, `ims`, unread/mention counters and metadata. Sample channel had no `latest`, `updated` or `history_invalid`. Not a message delta. Distinct from edge `users/counts`, which is a directory query. | No paging field in observed response. Returned 786 channels and 131 IMs; broader and differently shaped than `client.counts`. No history window. | Internal tier unknown. |
| `activity.feed` | Live success for mentions, reactions, bundled threads and DMs. Personal notification entries, often only message references. No proven edit/delete/removal log or all-conversation coverage. | `limit=20`, `response_metadata.next_cursor`; a second page succeeded for each working type. First pages reached roughly 1.1-2.5 days back, not a retention limit. No validated since-event cursor. | Internal tier unknown. |
| `activity.views` | Live success: five saved/default view definitions plus prefs. Fields include name, sort, density, position, view type. No messages. `activity.views.list` returned `unknown_method`. | Configuration snapshot, no paging observed. | Internal tier unknown. |
| `client.boot` | Live success: self, team, prefs, subteams, cache metadata and URL. No message collection. Official code uses the split boot calls above. | Current bootstrap state; no message change cursor or paging observed. | Internal tier unknown. |
| `conversations.history` with `oldest` | Current Main messages, root reply metadata and broadcast replies. Bodies include current edits/reactions when returned. An old message edited today still has its old message timestamp, so a since-disconnect `oldest` misses it. | One conversation; cursor and time bounds; history retained and visible to the account. `ignore_replies=true` excludes ordinary replies. Deletion by absence requires a proven covered span. | Public reference lists Tier 3, 50+/min, for Marketplace/internal customer-built apps; a separate 1/min policy applies to specified commercial apps. Neither establishes the `xoxc` limit. |
| Conditional history and `conversations.replies` | Source supports `cached_latest_updates`, `latest_updates`, `unchanged_messages`, `deleted`. Live history confirmed unchanged-message suppression. Replies return the thread root and replies; prior live work confirms the root can be returned before `oldest`. | Same per-conversation/per-thread paging and retained history. Versions reduce bytes, not the number of ranges that need checking. No global mutation cursor. | Same public Tier 3 qualification; internal-session limit unknown. |
| `subscriptions.thread.getView` | Live success: followed roots and unread/latest reply previews, not every message in every thread. Does not prove unfollowing or deletion from absence on a short page. | `current_ts` pagination, `has_more`, `max_ts`; requested 50, got 10, matching prior runs. Reach is retained followed activity; complete preview coverage and server cutoff unknown. | Internal tier unknown. |
| `rtm.start` | Live `not_allowed_token_type` with this session, despite the cookie. Deprecated API; public docs say existing callers now receive the `rtm.connect` response. Not a suitable replacement. | No usable result here. Public optional flags include `simple_latest`, `no_unreads`, `mpim_aware`, presence controls. No documented event-resume argument. | Public Tier 1, 1+/min; internal behavior unknown. |
| `rtm.connect` | Live success: URL plus minimal self/team, no missed events in HTTP response. Opening a socket is separate. | Public URL validity is 30 seconds. No documented historical paging or `last_event_ts`. Live socket experiment used the official internal endpoint instead. | Public Tier 1, 1+/min; internal-session limit unknown. |
| Socket fast reconnect | Live `hello.fast_reconnect=true` with `frt`. Official code treats it differently from a slow reconnect. Actual gap-event replay remains unproven by this run. | Client permits reconnect URL age under 285 seconds. No established restart/long-outage replay guarantee. | Server socket limits unknown; honor retry guidance. |
| All unreads | Source and existing research use counts, read pointers and history fetches. Activity has unread filters. No general mutation log was identified. Already-read old edits and reactions are not necessarily unread. | Unread state can shrink when another client reads. It is not a durable cursor. No separate unreads endpoint was live-validated. | Endpoint-dependent; internal tiers unknown. |
| `saved.list` | Live success with an empty `saved_items` list and counts. Source lists personal saved messages/reminders and tombstone options, not general message changes. | Cursor; source default 15, maximum 50. Retention and removal behavior unverified on this empty account list. | Internal tier unknown. |
| `search.modules.messages` | Prior live research confirms new messages and thread replies across channels, sorted by original message timestamp; extra message data adds thread metadata and some reactions. Not an edit/delete/reaction event log. | Page numbers and `pagination`; prior `count=20` and `count=50` work. Date filters select message dates, not last mutation time. Search visibility/index delay and retention apply; no completeness watermark. Not re-probed here. | Internal tier unknown. Public `search.messages` Tier 2 is not evidence for this method. |
| `conversations.historyChanges` | Live shape differs from old EKM-only source: `channel_timestamps`, `invalid_channel_ids`, `last_checked_ts`. All tested maps were empty. No demonstrated usable message delta. | No cursor observed. No-arg, `channel`, `channel_ids` list/comma-string, and `channels` list/comma-string probes did not populate the map. Arguments may have been ignored. Do not infer no mutations. | Internal tier and supported arguments unknown. |
| `ublockworkaround.history` / event log | Source replay API. Live accepted metadata-event include list, returned empty events. Explicit `message`, `message_changed,message_deleted` and `reaction_added,reaction_removed` include sets were rejected. | `start`, `count`; source default 2,000, recursive next start from last `event_ts`. `total`/`has_more`; overflow and `timestamp_too_old` need fallback. Retention not measured. | Internal tier unknown. `eventlog.history` also rejected the mixed message/reaction include probe; do not assume full alias equivalence. |

Public references checked on 10-18:
[`conversations.history`](https://docs.slack.dev/reference/methods/conversations.history/),
[`conversations.replies`](https://docs.slack.dev/reference/methods/conversations.replies/),
[`rtm.start`](https://docs.slack.dev/reference/methods/rtm.start/),
[`rtm.connect`](https://docs.slack.dev/reference/methods/rtm.connect/), and
[legacy RTM](https://docs.slack.dev/legacy/legacy-rtm-api/).
Public API documentation does not specify the private client methods' guarantees.

## Counts and conditional history: the useful path

**Live:** full counts returned 224 channels, 48 IMs and 21 MPIMs. Every sampled
full entry had the seven fields below. In 286 of 293 entries `updated` differed
from `latest`, and 201 had nonzero `history_invalid`. Those numbers establish
that the fields are distinct; they do not attribute a particular mutation.

```json
{
  "ok": true,
  "channels": [{
    "id": "CEXAMPLE", "last_read": "1700000000.000001",
    "latest": "1700000100.000001", "has_unreads": true,
    "mention_count": 1, "updated": "1700000200.000001",
    "history_invalid": "1700000050.000001"
  }],
  "ims": [], "mpims": [],
  "counts_last_fetched": 1700000300
}
```

This example omits the thread and other counters. A subsequent call supplying
that server `counts_last_fetched` again returned all 293 IDs. Of them, 242 had
only `id,last_read`; 51 had the full seven fields. The partial rows were 182
channels, 41 IMs and 19 MPIMs. Full rows need not mean exactly 51 new mutations:
this was a near-immediate follow-up, and unread state or server policy may also
retain full rows.

This exposes an existing schema mismatch. At the research base,
`packages/slack-schema/src/boot.ts` requires `has_unreads` and `mention_count`
on every `CountEntry`, while `loadCounts` sends `counts_last_fetched` during
sweeps. These observed partial rows cannot satisfy that schema. Fixing it is
separate product work; this branch changes no code. Missing fields must preserve
previous values, not clear unread state or certify that a range is fresh.

**Source:** S2 `OJaN` advances `updatedTs` for history mutations and explicitly
names reaction events. `yDDn` advances `historyInvalidTs` for changes requiring
purge, with retention deletions as an example. `FhIQ` compares server values with
these local baselines. This is stronger evidence than guessing from field names,
but it is not a controlled server-side test of every mutation kind.

**Live:** `conversations.history` with `include_mutation_timestamps=true`
returns `mutation_timestamps: {latest, updated, history_invalid}`. Supplying
`cached_latest_updates={}` returned five messages and five version entries.
A second call fixed `oldest` and `latest` to that page, set `inclusive=true`,
and sent the returned versions. It returned zero message bodies and five
`unchanged_messages`. No deletion occurred during this test.

Invented conditional exchange, shortened:

```json
{
  "channel": "CEXAMPLE", "limit": 5, "inclusive": true,
  "oldest": "1700000000.000001", "latest": "1700000100.000001",
  "include_mutation_timestamps": true,
  "cached_latest_updates": {"1700000000.000001": "1700000200.000001"}
}
```

```json
{
  "ok": true, "messages": [], "has_more": false,
  "latest_updates": {}, "unchanged_messages": ["1700000000.000001"],
  "mutation_timestamps": {
    "latest": "1700000100.000001", "updated": "1700000200.000001",
    "history_invalid": "1700000050.000001"
  }
}
```

The `deleted` array is source-backed, not live-confirmed here. Never treat an
`unchanged_messages` entry as deleted just because its body is absent. Version
maps and unchanged IDs contribute to page coverage. Persist returned versions,
not `edited.ts` as a substitute: reaction changes also require a version.

## Activity and the event log

**Live working Activity request:** `mode=chrono_v1`, `types=["at_user"]`,
`limit=20`, `archive_only=false`, `unread_only=false`, `priority_only=false`.
The same request worked separately for `message_reaction`, `thread_v2`, and
`dm`. `chrono_reads_and_unreads` also worked for `at_user`. Each returned 20
entries and a next cursor, and each second page succeeded. `thread_reply`
with `chrono_reads_and_unreads` returned `invalid_arguments`. A combined list
containing it also failed. Use the actual wire snake_case fields; the source
fetcher converts its camelCase arguments.

An empty type list succeeded with zero items. Omitting types failed. Neither
result means that a workspace has no activity.

The response wraps the typed entry in `items[].item`. The first reaction page's
message references had only `channel,ts`; its reaction had `name,user`.
Mentions had `author_user_id,channel,is_broadcast,ts`. DM and thread entries had
`bundle_info.payload`. These are references/bundles, not full history pages.
For example, with invented values:

```json
{
  "ok": true,
  "items": [{
    "key": "example-notification", "feed_ts": "1700000300.000001",
    "version": "example-version", "is_unread": true, "is_archived": false,
    "item": {
      "type": "message_reaction",
      "message": {"channel": "CEXAMPLE", "ts": "1700000000.000001"},
      "reaction": {"name": "eyes", "user": "UEXAMPLE"}
    }
  }],
  "response_metadata": {"next_cursor": "example-cursor"}
}
```

The reaction entry does not supply the message author or a complete current
reaction set. This run did not fetch the referenced messages to establish whose
messages qualify. Do not turn a notification into a blind reaction increment:
removals, duplicates, grouping and cleared notifications need reconciliation.
Activity can prioritize a referenced message for refresh, but adding that feed
costs requests and still does not establish complete coverage.

**Source event log:** S2 `OKAK` calls the method registered as
`ublockworkaround.history`, with `start`, `count`, `include_events`,
`no_payload_if_has_more` and `batch_deleted_files`. Its modern default include
set is metadata such as channel deletion/rename, emoji changes, file deletion,
app removal, stars and user-group deletion. A legacy source branch also lists
`message` and history-change events. That branch is not evidence that the
current session accepts them: the live server explicitly rejected `message`.
A 24-hour metadata request returned `{ok:true, events:[], total:0, has_more:false}`.
The empty result proves only that the request works, not retention or delivery.

**Correction to earlier research:** the EKM call site for
`conversations.historyChanges` is real, but its live response was:

```json
{
  "ok": true, "channel_timestamps": {}, "invalid_channel_ids": [],
  "last_checked_ts": "1700000300.000001"
}
```

The inspected cached source has no `channel_timestamps` or `last_checked_ts`
consumer. Supported arguments and nonempty behavior remain unknown. It would
be premature either to rely on it or to describe the endpoint as EKM-only.

## Cost and coverage for 150 active conversations

Juno already fetches counts and histories whose `latest` moved, followed-thread
pages, discovery results and open-topic pages. The ten-topic recheck is
**additional mutation repair**, not the entire reconnect budget. The existing
live measurement was ten calls and 14.9 seconds under its old pacing, with one
of ten pages failing to reach the full 24-hour span. This investigation does
not predict latency under today's scheduler.

Let `R` be the total history and reply pages needed to repair dirty cached
ranges, after removing work already covered by normal catch-up. Counts identify
conversations, not thread IDs: one dirty conversation may contain many cached
threads. Let `P` be any additional Activity pages. Estimated request costs:

| Scenario | Extra mutation repair calls | What is covered |
| --- | ---: | --- |
| Current policy | Up to 10 | Selected topics, one page each, back 24 hours before the gap |
| Reuse full counts; no mutation markers changed | 0, after timestamp semantics are validated | No extra repair justified by those markers; unknown baselines still need repair |
| Three dirty topics, one page each | 3, 70% fewer than 10 | Those three ranges, even if outside the newest ten |
| Fifteen dirty topics, one page each | 15, 50% more than 10 | All fifteen ranges rather than ten selected topics |
| General mutation-aware repair | `R` | Only the dirty ranges actually read to completion |
| Add Activity prioritization | `R + P`, plus uncovered message lookups | Personal notifications; no complete-coverage guarantee |
| Hypothetical one-page refresh of all 150 Main streams | 150 | Main pages only; still not all threads or old messages |

If counts were not already present, add one call: three one-page repairs would
be four calls rather than eleven for counts plus today's ten. Against the
hypothetical full 150-Main refresh, four versus 151 is about 97% fewer calls,
but that is **not** a saving against today's implementation. Conditional reads
keep these call counts unchanged and reduce returned bodies. Five bodies to
zero was observed; no total-byte or elapsed-time reduction was measured.

## Proposed implementation boundaries and remaining checks

This is a recommendation for later work, not an approved protocol replacement.

1. Retain full counts on warm boot/reconnect for membership. Handle partial
   incremental count rows without clearing fields. Keep channel metadata's
   `updated` separate from counts' history-mutation `updated`.
2. Persist mutation baselines for history ranges successfully reconciled,
   including the associated cached threads. Compare with counts before advancing
   the baseline. A counts observation alone must not mark local messages fresh.
3. For advanced markers, enqueue dirty cached ranges, prioritizing open topics.
   `oldest=disconnect_time` alone is insufficient for older edited messages.
   Use conditional history/replies to avoid re-downloading unchanged bodies.
   Counts alone do not identify which thread or message changed.
4. Preserve Juno's socket/page ordering, tombstone dominance, pending local
   intent and verified-coverage rules. Do not purge queued local sends when
   translating Slack's cache-purge behavior. Failed or incomplete repairs retain
   their dirty state and resume later. A gap during repair starts another pass.
5. Keep follow repair and new-message/thread discovery. A removed subscription,
   an unread mark, or a previously uncached thread is not solved by refreshing
   only existing message ranges.
6. Before removing the fallback recheck, causally test old Main messages and old
   replies: edit, delete, add reaction, remove reaction, and changes made while
   another client has already read everything. The user's read-only constraint
   excludes manufacturing those live cases in this research. Test in the fake
   and, under a separate write-authorized task, the private test channel/self-DM.
   Include retention deletions, partial counts, retries and restart during repair.
7. Separately test fast reconnect against a continuously connected observer
   during a gap containing actual events, plus expiry and server fallback to
   slow connect. This run proved fast handshake success only. Do not disable
   catch-up until replay completeness and desync handling are established.
8. If investigating `historyChanges` further, obtain a current nonempty client
   call and its exact argument names. Current empty probes are not enough.
   Update architecture and the relevant Quint specs with any eventual sync
   behavior change, and run `bun run specs:check` then.

The immediate engineering follow-up is the partial-count schema mismatch.
The broader improvement is to spend the existing repair budget on ranges
whose mutation markers changed, then use conditional versions to reduce bytes.

## Validation of this research change

`bun run affected` completed successfully and reported four documentation files
changed, with nothing to run. `git diff --check` and the generated decision-log
check passed. Live probes established the results above; no product test suite
or sync-protocol verification is claimed for this documentation-only branch.

## Initial implementation and call comparison (2026-10-19, superseded below)

`mutationRepair.ts` now compares full counts with durable repaired markers on
reconnect and warm boot. It repairs every cached Main and thread range of dirty
member conversations, using conditional versions. It does not scan unchanged
conversations. The ten-topic fallback remains, skipping a topic already repaired.
Counts select conversations, not threads; a changed conversation may need several
reply calls. A populated cache upgraded without markers needs one baseline repair.

An incremental `{ id, last_read }` row previously caused `SlackDecodeError` before
`loadCounts` could merge any entries. The failed cycle kept the old cursor and
retried. Optional unread fields now decode, and the writer preserves omitted
`latest`, unread flags and mention counts. The fake returns the observed partial
shape, and the engine test checks that a sweep keeps the existing unread state.

The fake explicitly assumes edits and reactions advance `updated`, and deletion
advances `history_invalid`. Its conditional pages retain unchanged ids in paging,
return new versions with changed bodies, and identify deleted cached ids. Tests
prove Juno under these assumptions. The live research still does not establish
complete marker coverage or internal rate limits. The fallback remains for that
reason. Uncached history and unknown threads are outside mutation repair; ordinary
history and discovery still find new messages.

Call comparison uses the default `largeSeed()` (300 conversations, 5,000 threads,
100,000 messages, 2,000 users). The engine boots, caches a followed thread outside
the top ten, goes offline, and another client edits one cached reply, deletes a
second and removes a reaction from a third. No topic is opened. Calls are reset
before reconnect and counted until the sync cycle finishes. The before run uses `872f6355`; one run per side completed without request
failures. The hourly follow
pass is not due; periodic sweeps are disabled. Socket URL calls are excluded
because reconnect backoff changes their count. Background pacing is disabled as
in other fake-engine tests; these are request counts, not a latency benchmark.

| Request | Before | After |
| --- | ---: | ---: |
| `client.userBoot` | 1 | 1 |
| `client.counts` | 1 | 1 |
| `conversations.history` | 0 | 1 |
| `conversations.replies` | 10 | 15 |
| `subscriptions.thread.getView` | 1 | 1 |
| `search.modules.messages` | 2 | 2 |
| Total, excluding socket URL | 15 | 21 |

Before, all three changes remain stale. After, all three are stored without an
open: six conditional repair calls cover the dirty conversation, and ten fallback
calls remain. A subsequent unchanged warm boot makes no mutation-repair calls.
The conditional endpoint test separately verifies zero bodies for an unchanged
page and correct cursor progression through unchanged ids.

This scenario costs six more calls (40%), with broader coverage. It does **not**
confirm the earlier hypothetical 70% call saving: that estimate assumed replacing
the fallback, which this change deliberately retains. Messages with no saved server version need a full body once to establish it.
Conditional versions reduce
body transfer, but no byte percentage or live latency improvement was measured.

## Controlled self-DM mutations (2026-10-19)

The owner authorized writes in their self-DM. The probe verified the authenticated
user against the DM member, created one root and one reply, and mutated only those
two messages. The sequence ran twice with matching results; all four test messages were
deleted afterwards. Credentials stayed in memory; output
contained booleans, field types and the labels `root` and `reply`, with no real ids
or message content. Calls were spaced by at least 1.5 seconds. Each stage read full
counts, then full and conditional history and replies using the previous stage's
`latest_updates`. The history range contained the root; replies contained both.

| Stage | `updated` | `history_invalid` | `latest_updates` | Conditional history / replies |
| --- | --- | --- | --- | --- |
| Post root and reply | Baseline present | Baseline present | Both messages have versions | Root / root and reply (empty version cache) |
| Edit both | Changed | Same | Both versions changed | Root / root and reply |
| Add reaction to both | Changed | Same | Both versions changed | Root / root and reply |
| Remove reaction from both | Changed | Same | Both versions changed | Root / root and reply |
| Delete reply | Changed | Changed | Root changed; reply absent | Root / root; `deleted` empty |
| Delete remaining root | Same | Changed | Empty history version map | Empty history; `deleted` empty; replies: `thread_not_found` |

`latest` stayed fixed through edits, reactions and reply deletion, then changed on
root deletion. No message-level `version` field was observed. The fake therefore
stores versions separately and supplies them only through `latest_updates` when
conditional pages are requested. It advances edit and reaction versions; deleting
a reply updates its root's version and the conversation's `updated`, whereas
removing the final root only advances `history_invalid`. It returns an empty
`deleted` list, as this experiment did, rather than inventing tombstone ids outside
a page. Absence is checked only over proven page coverage.

This establishes these behaviors in one self-DM, not a guarantee across retention
policies, Slack Connect, all workspace types or every event. The ten ordinary
fallback pages always run, even for a topic repaired conditionally. Tests also
exercise omitted/backwards markers and a reaction whose marker/version does not
advance. Such changes outside the fallback can still wait for an open-topic read.

### Revised bounds

The foreground boot/reconnect keeps its original ten-page fallback budget.
Additional mutation repair starts only after phase `live`, on the background
lane, under the sync work permit. It attempts at most ten pages per catch-up,
one page per queued range. Main and cached replies are bounded from
24 hours before the gap began (the recheck lookback setting). Old roots fetched for
thread metadata do not extend Main; a root without cached recent replies does
not get a reply job. Unfinished cursors and refused/rate-limited jobs persist in
`repair_pending` and rotate behind unattempted work on the next catch-up or sweep.
The original request bounds stay fixed while a cursor advances.

A missing baseline seeds the current markers without enqueueing all cached
conversations after upgrade. Any supplied marker difference, including a backwards
move, queues work. Missing fields preserve the baseline. Observed markers and
queued ranges commit atomically; the marker now records observation, not completion.
Limited pages cannot prove deletion by absence. Thread roots are excluded from
thread absence checks. Repair does not certify outbox recheck coverage; the
ordinary fallback remains responsible for that safety barrier.

The revised large-seed reconnect observed 18 calls: one userBoot, one counts,
thirteen replies (ten fallback and three repair), one getView and two searches.
No mutation-repair history page was needed for this target: its cached Main
roots were outside the recent window. All three offline changes were recovered
without opening the topic. This is a request count with fake pacing disabled,
not a latency or byte benchmark. The earlier 21-call result above describes the
unbounded implementation. Failed repair calls are single-attempt, so transport
retries cannot exceed the ten-request cap. Queued ranges expire 24 hours after enqueueing. Their message bounds stay fixed,
so a multi-day gap still repairs messages from the day the app closed.


### Round 2: incremental markers and live activity

A further controlled self-DM probe created a root and reply, edited the reply,
and deleted both test messages afterwards. It compared incremental counts using
the preceding counts stamp with full counts after each operation. Calls were
spaced at least 1.5 seconds apart, with at least two seconds before each mutation.
Only field names and equality results were recorded.

| Operation | `latest` changed | `updated` changed | `history_invalid` changed |
| --- | --- | --- | --- |
| New Main message | Yes | No | No |
| New thread reply | No | Yes | No |
| Edit reply | No | Yes | No |

All three incremental rows supplied `id`, `last_read`, `latest`, `has_unreads`,
`mention_count`, `updated`, and `history_invalid`. Their markers matched full
counts. Partial read-only rows can still omit these fields. The fake now leaves
`updated` unchanged for a new Main message instead of assuming it advances.

The large-seed activity test edits cached messages in 150 conversations six times,
advancing server time ten minutes each round and waiting for live delivery and a
sweep. Wall-clock sweeps are accelerated; this is a queue/call measurement, not a
latency benchmark. After that synthetic live hour, it disconnects and edits one
message offline. At `c6e3739a`, reconnect queued 396 jobs across 150 conversations;
the offline edit remained stale after two ten-call repair passes. With baseline
refresh during uninterrupted sweeps, it queues exactly two jobs in one
conversation and repairs the edit in two calls on the first pass.

Repair selection also interleaves conversations so one conversation's threads do
not consume the whole pass. The cap remains ten calls. A drop while an incremental
counts request is in flight prevents baseline refresh. Missing markers preserve
the stored baseline. A `thread_not_found` response drops the job and tombstones
cached replies within its fixed bounds. Tests cover a Friday 18:00 close, a
Saturday edit of a Friday 17:00 message, and a Monday reopen, as well as deleting
a reply followed by its root while offline.


### Round 3: proving delivery before refreshing baselines

A connected socket alone does not prove event delivery: it can remain half-open
until its pong timeout. Incremental counts markers now become in-memory
candidates. Only a later sweep, after a pong received after that counts response,
can promote them. The pong carries the socket receive timestamp, so time spent in
sync's event queue cannot turn an old pong into new evidence. Disconnect discards
candidates. Any failed frame blocks promotion for its conversation for the rest
of the session; an unidentified conversation blocks all promotions. This can
increase repair work after an error, but preserves the dirty signal.

The fake can hold both message frames and pongs while HTTP keeps working. A
regression test changes a message, loses its event, lets sweeps run before timeout
detection, then verifies reconnect repair without fallback pages. A separate test
forces a frame's database write to fail and verifies its marker stays dirty even
after a pong and later sweep.

**Unknown:** free-plan hidden history may return `thread_not_found` for an old
root with recent replies. The self-DM deletion probe does not distinguish that
case. The response alone therefore drops the job without tombstoning replies.
Bounded cached replies are tombstoned only if the root is already deleted in
cache, including when the Main page has proved it absent. No additional live
Slack writes were needed for this revision.

The send-copy test now explicitly covers markers enabled, an original deleted
while offline, and zero fallback rechecks. Repair observes the deletion and the
surviving copy remains visible; this still does not certify outbox recheck coverage.
