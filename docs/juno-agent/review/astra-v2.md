# Juno Agent v2 correctness review

Reviewed 2026-10-14. Verdict: revise before implementation of the affected protocols. The package split, separate action ledger, exact approval revision, persisted compaction retries, and distinction between source preservation and recall are sound directions. The current plan does not yet establish its request, redaction, ownership, or outward-action guarantees.

I read the [brief and owner decisions](../BRIEF.md), [plan v2](../plan-v2.md), all three research notes ([Astra](../research/astra.md), [Opus](../research/opus.md), [Fable](../research/fable.md)), and the [Quint conventions](../../../specs/README.md). Findings below are deductions from the proposed design, not observed implementation failures. Severity describes consequence. "Blocking" means the affected work package must not treat the current design as settled. No tests, builds, or model checks were run.

## Blocking findings

### R1. A replicated folder does not provide ownership fencing

- Severity: critical. Blocking: yes, for ownership transfer and dispatch guarantees.
- Plan: §0.2 row 17, §4.2, §12, §13.2 `staleEpochCannotDispatch`.
- Problem: `flock` excludes processes using the same local lock, not processes on two Macs. Reading an epoch from a synced folder does not establish its freshness. The dispatcher is the old executor itself, not an independent gateway that can refuse its stale requests. There is no lease protocol, renewal rule, or authoritative expiry in this design. Adding a local lease timer would not fix the missing authority.
- Failure: Mac A loses folder synchronization but can still reach Slack. Mac B confirms forced takeover and writes epoch 8. A reads its cached epoch 7 immediately before sending, passes its local check, and sends. B can also send. Even with fresh reads, A can pause between the epoch check and the network call while B takes over.
- Change: choose one enforceable v1 contract. For online fencing, all outward dispatch must cross a single authoritative gateway that atomically validates ownership and records dispatch authorization. An authority outage disables dispatch. Otherwise support only cooperative transfer after the old writer durably disables itself and drains dispatch, and document that forced recovery requires the old executor to be externally disabled. Do not claim safe forced takeover from a folder check. Model delayed folder reads and separate check, send, and destination-accept transitions. A request authorized before transfer may still arrive afterward; fencing cannot undo it.

### R2. Restoring a backup can reuse an approval after its effect already ran

- Severity: critical. Blocking: yes, for backup recovery and movable ownership.
- Plan: §4.2–4.4, §12, §14 flow 11.
- Problem: the ledger is only authoritative for what it durably knows. Five-minute backup lag can erase the record of an attempt while preserving its earlier approval. Increasing the epoch does not restore that missing knowledge. The new device cannot put an absent action into `unknown`, as §12 assumes.
- Failure: a backup contains approved Notion action A. The old Mac dispatches A successfully and fails before its next backup. The replacement restores A as approved and sends it again. Alternatively, the last backup predates A entirely, and re-asking the interrupted run creates an unrelated action ID for the same effect. Restoring an older epoch can also reuse IDs or admit a second owner.
- Change: restored databases start in an explicit recovery mode with dispatch disabled. Invalidate pending approvals, quarantine restored executable work, and require reconciliation or fresh owner authorization that states the uncertainty. Preserve globally unique action IDs and a new journal incarnation across restore. A strict cross-restore at-most-once promise requires dispatch records outside the rollback domain, or destination deduplication with a sufficient retention period. State the recovery-point limit explicitly. Cooperative transfer must export a final consistent checkpoint after stopping admissions and dispatch, publish a manifest naming that checkpoint, and make the new owner verify it before activation. Model abrupt loss separately from cooperative transfer.

### R3. The request builder has no guaranteed bounded result

- Severity: high. Blocking: yes, for the runtime and memory contract.
- Plan: §0.2 rows 3–4, §3.2–3.5, §13.1 `requestBounded`.
- Problem: `bytes / 3` is an estimate, not a conservative upper bound for arbitrary text or provider framing. The last fallback retains the entire view and all pins even when they are the cause of overflow. Emergency merges can lack built parents or a feasible low-mark partition. A model window can be smaller than the fixed prompt, pins, tools, and 16k output reserve. Keeping the shortest of five oversized summaries does not establish a 512-byte maximum.
- Failure: compaction is unavailable while the durable view grows, or the owner switches to a smaller-context model. Tail reduction and tool paging finish, but the fallback still exceeds the provider window. Token-dense text can also pass the byte estimate and fail at the provider. Merely returning instead of throwing does not establish admission safety.
- Change: define `buildRequest` as a total result with two cases: an admitted, protocol-valid request, or a local blocked response that makes no provider call. Enforce the final guard at the provider boundary, so a failed hook cannot fall back to raw pi context. Use model-specific token counting or a documented safe upper bound, including system, schemas, framing, and output reserve. Check model compatibility when selecting models and admitting pins. Permit a bounded, explicitly partial memory representation or block locally when mandatory content cannot fit. Bound every compaction request too. Treat node size and view low marks as targets unless a deterministic hard-size policy is defined.

Pi's hook dispatch reports ordinary hook exceptions and continues. This makes a separate admission guard necessary; a promise that application code "never throws" is not a failure boundary. See the [pi 1.2.0 hook contract](https://raw.githubusercontent.com/earendil-works/pi/v1.2.0/packages/durable/docs/spec.md), §7.2.

### R4. Redaction leaves retained copies and allows stale output back into memory

- Severity: critical. Blocking: yes, for the promised forgetting behavior.
- Plan: §3.1–3.3, §3.6, §7, §12, §13.1 `redactionClean`.
- Problem: inserting `ver+1` never deletes the old summary text. Marking a pin for removal is weaker than removing it from all reads in the redaction transaction. The dirty set covers tree ancestors, but a compaction also reads an auxiliary memory view. A summary outside the source's tree ancestry can copy information from that view. Current root requests, subagents, action payloads, reports, and local harness transcripts can retain copies too. Waiting for every background task to become idle gives journal cleanup no finite completion point.
- Failure: message 3 contains a secret. A compaction for message 20 reads a context view containing it and repeats it. Removing message 3 rebuilds only its ancestors. Node 20, old node versions, or a delayed subagent report puts the secret into the next request. A pending action card can still send the old text after the source bubble says Removed.
- Change: separate immediate exclusion from eventual storage purge. Atomically tombstone the source, remove active pins, invalidate dependent proposals, and increment a redaction generation checked by request admission and result publication. Abort or quarantine work that saw the old generation. Record dependencies on every input to a compaction, including auxiliary context, or conservatively invalidate the broader affected set. Remove obsolete text-bearing nodes and pin history, and define treatment of copied messages, action payloads, pi journals, Codex sessions, attachments, search indexes, and backups. Preserve non-content audit metadata where needed. Rebuild outside the transaction, then publish against the current redaction generation. Set a cleanup deadline and a visible pending state if journals cannot yet be retired. Do not promise recall erasure at external providers or forensic erasure on storage merely from `secure_delete` and `VACUUM`.

The O(log N) rebuild claim holds only for dependencies restricted to tree edges. It does not hold for arbitrary model-visible context or derived replies. An honest narrower promise is removal of selected stored records and tracked derivatives, with the scope stated explicitly.

### R5. Versioned nodes are not bound to an atomic published view

- Severity: high. Blocking: yes, for memory publication and redaction.
- Plan: §3.1–3.2, §3.6, §13.1.
- Problem: nodes are keyed by `(l,i,ver)`, but view lines contain only `(l,i)`. The plan does not define how a revision selects versions, which record is the CAS target, or whether source validation and publication share a transaction. Local version numbers do not by themselves identify compatible child inputs. "Restart loads the latest revision" cannot reconstruct a stable snapshot if readers resolve node versions independently.
- Failure: a parent job reads old children, the owner redacts one child, and the job finishes after a digest check performed outside the commit transaction. The old parent is inserted or selected by a new view. Another request reads old pins and new view lines in separate queries, creating a combination that never existed as a valid memory state.
- Change: store exact node-version references in each view revision, plus `covered` and the redaction generation. Use a singleton head row for a transactional CAS from the expected revision to the new immutable revision. Node insertion can precede publication, but digest and generation validation, head advancement, and relevant dirty-state updates must be atomic. Requests read pins, view, tail cutoff, and redaction state from one database snapshot and revalidate admission after asynchronous preparation. Store exact child versions and actual input digests. Define masked intervals as their own view entry type so `(being updated)` does not pretend to be a clean built node.

### R6. A projection from a weaker journal cannot be the acknowledged archive

- Severity: high. Blocking: yes, for durable chat and pi integration.
- Plan: §0.2 rows 1–2, §2 storage, §3.1, §3.3, §4.1, §4.4, WP0 S1.
- Problem: inputs enter pi before the indexer makes them durable in `agent.sqlite`. Pi's default `NORMAL` SQLite adapter has weaker power-loss durability than the `FULL` archive. No acknowledgement barrier, replay mapping after journal rollback, journal-incarnation key, or reset/input recovery transaction is specified. An entry cursor alone does not define recovery after rotation. Pinning package versions and wrapping imports do not address the experimental runtime's persisted-state compatibility.
- Failure: pi accepts a message and the UI clears Queued, but power fails before the archive projection commits. The source entry disappears from pi, so the archive cannot recover it. Conversely, the archive cursor survives farther than pi's recovered journal. Rotation then starts a new journal whose entry IDs collide with the old cursor. A crash between reset and input can also leave admission half-complete.
- Change: persist owner input and its globally unique operation ID in an authoritative `FULL` inbox before acknowledging it. Submit through an idempotent bridge and persist the mapping. Either make pi's authoritative journal equally durable or define how archive-ahead and journal-ahead states recover, including outputs and task identities. Key projection positions and task references by journal incarnation and commit position. Drain projection before rotation and atomically publish a new incarnation manifest. Serialize idle detection, reset, and admission. Extend S1 with crash, power-loss, rotate, reopen, and schema-migration cases. Unsupported recovery must stop safely instead of replaying unknown work.

The pinned [Node SQLite adapter](https://raw.githubusercontent.com/earendil-works/pi/v1.2.0/packages/durable/src/storage/sqlite/node.ts) explicitly sets `synchronous=NORMAL`. A durable ledger protects recorded dispatch decisions; it does not repair unarchived conversation state.

Bind proposal deduplication to the journal incarnation and durable tool-task identity, not an assumed unique provider call ID. Pi also restores tool arguments without rerunning `beforeTool`; current approval, ownership, and redaction checks must therefore run in the dispatcher on every execution path. See the [pi 1.2.0 tool contract](https://raw.githubusercontent.com/earendil-works/pi/v1.2.0/packages/durable/docs/spec.md), §7.3. Test repeated tool execution after a crash between the ledger commit and pi's receipt commit.

### R7. "Check before retry" is not proof that the previous attempt did nothing

- Severity: critical. Blocking: yes, for non-idempotent outward tools.
- Plan: §0.2 row 9, §4 heading and §4.2–4.4, §13.2.
- Problem: "at most once per approval and attempt" permits another attempt under the same approval and does not specify what consumes permission. T3 search with no result is not proof of no launch. Comparing current Notion content to a digest is not proof of failure if another edit followed the write. Automatic retries in MCP, HTTP, or the engine outbox can bypass an application-level dispatch count. [ADR 0011](../../decisions/0011-merge-rules-and-echo-reconciliation.md) explicitly allows an outbox retry after checking history; that is not evidence that Slack provides server-side deduplication for an arbitrary retry interval.
- Failure: T3 accepts a launch but loses the response. Search has not indexed it, so a relaunch creates a second thread. A Notion append succeeds, a later edit changes the page, and the comparison says failed. Retrying duplicates the append. An SDK can also make two network attempts behind a single ledger transition.
- Change: separate immutable approval records, dispatch authorizations, attempts, and receipts. Consume authorization durably before handing bytes to the transport. Crash after consumption means unknown, including a crash before the actual send. For destinations without proven deduplication, permit one dispatch per authorization and disable transparent retries. A negative lookup preserves unknown unless it conclusively proves non-acceptance. A retry after unknown needs a new explicit authorization describing possible duplication. For deduplicated destinations, keep the same action key and payload across retries and document key scope and retention. Record endpoint-specific definite rejection evidence. Rename §4 to avoid its exactly-once heading and remove "effectively once" until the destination contract supports it.

The ledger records knowledge of the outcome; it cannot decide that a remote effect did or did not happen from a timeout alone.

### R8. Run origin and a source ID do not establish owner authorization

- Severity: high. Blocking: yes, for no-click work and schedules.
- Plan: §0.1, §3.4, §7–8, §11, §13.2 `tier2Provenance` and `scheduleHasOrigin`.
- Problem: every call in an owner-origin run inherits the no-click T3 exception, including calls induced by hostile tool results or reports steered into that run. A schedule can reference any owner message without showing that the message authorized its purpose. The `origin` parameter is model-supplied. "Ask once per job" for Tier 3 contradicts the owner's fixed rule that every other outward effect gets a click for its exact payload.
- Failure: the owner asks Juno to summarize a Slack thread. A message in that thread says to start a T3 session to modify a project. The run remains `origin_kind=owner`, so launch needs no card. A fabricated daily watch references the summary request as its origin. A Notion job approved once then makes writes the owner never saw.
- Change: keep causal provenance separate from permission. Mint a durable, narrowly scoped grant for the actual owner-requested job or watch, with target, operation class, bounds, and revocation state. Reports and tool results cannot create or broaden it, even when delivered as steering. The application binds schedule origin to an existing grant; the model does not supply authority by naming an ID. Require a card when scope cannot be established. Delete the Tier 3 "Ask once per job" exception unless the owner changes the decision. Model unauthorized content inside owner runs, not just report-origin runs.

### R9. Pin exactness and edit provenance are contradictory

- Severity: high. Blocking: yes, for mandatory memory claims.
- Plan: §0.2 row 5, §3.1, §3.4, §13.1 `pinsExact`.
- Problem: `remember(text, source_id)` only specifies that the source is a current-run user message. That does not constrain `text` to source bytes. The formal property requires equality with the whole source, while pins are capped at 280 bytes and editable independently. An owner can also quote hostile text. A user-message type alone does not make all its content an instruction.
- Failure: after a read tool returns hostile content, the model calls `remember` with that content and the ID of the owner's unrelated question. The structural source check passes. Alternatively, a valid 1,000-byte owner message cannot satisfy whole-message equality and the pin-size cap at once. A UI edit has no source record that matches its new text.
- Change: represent pins as exact immutable spans of an owner source, including source version and byte offsets, or as owner-edited records with explicit owner-edit provenance. Derive pin text on the trusted side instead of accepting arbitrary model text. Store supersession and active status explicitly, enforce the 4 KB budget atomically over active pins, and remove pins synchronously on source redaction. Distinguish quoted data from an instruction to remember it. Claim source attribution and byte exactness, not structural prevention of all prompt injection.

### R10. The history tail and active run have no disjoint boundary

- Severity: high. Blocking: yes, for request correctness.
- Plan: §0.2 row 3, §3.1, §3.3, §3.5, §7.
- Problem: the indexer appends current-run entries to the archive while the hook separately appends "this run's entries." Neither a run-start archive cutoff nor a request snapshot cutoff defines which records belong to the view, tail, and run suffix. Paging tool results does not bound large user inputs, tool-call arguments, or long assistant messages. The 24 KB tail cap and five-second wait appear in §0.2 but have no complete operational contract in §3.
- Failure: the current owner message is in the unsummarized tail and again in pi's run entries. A fast compactor also publishes its summary into the view. A later request repeats the same instruction several times. Another request removes the old tool result but keeps an incompatible call/result chain. A large current input disappears in fallback without the owner knowing which text the model saw.
- Change: establish a durable run-start history cutoff and a per-request entry cutoff. Partition historical coverage, historical unsummarized tail, and the active protocol suffix by stable source IDs. Preserve ordered steering inputs and valid tool pairs, IDs, and required provider metadata. Define allowed truncation for each kind, including an explicit local refusal for an input that cannot be admitted. Store all accepted source bytes regardless of presentation truncation. Make the tail cap, timeout, and placeholder policy explicit; one placeholder per record must not itself create an unbounded request.

## Additional findings

### R11. Exact payload approval needs a complete executable identity and batch contract

- Severity: high. Blocking: before exposing generic writes and multi-action cards.
- Plan: §4.2, §6 tool-list refresh, §9.
- Problem: the digest's contents and canonical encoding are unspecified. The action can change meaning when an account, target alias, tool schema, or server binding changes. A card containing several messages has one status but multiple independently observable effects.
- Failure: the owner approves text for one workspace; before dispatch, the connection points at another account. The text digest still matches. In a three-send card, two sends succeed and the process crashes; retrying the card repeats those two.
- Change: freeze and hash connection identity, account, stable destination IDs, tool name and schema version, canonical arguments, relevant preconditions, and the ordered operation list. Send precisely that stored payload. At dispatch, reject expired, changed-source, revoked, or incompatible approvals. Bind one approval to immutable child actions, each with its own key and outcome. Define partial success and retry only the unresolved child through the appropriate authorization rule. A changed remote page may need a version precondition or a refreshed card to prevent a stale overwrite.

### R12. Unknown recovery must not block the entire assistant indefinitely

- Severity: medium. Blocking: no, but settle before runtime recovery implementation.
- Plan: §4.4, §7 Stop, §8 Pause, §13.2 `pauseStops`, `statusForward`.
- Problem: reconciling every uncertain action before `resume()` cannot guarantee every effect is decided. Some destinations will be offline or permanently ambiguous. Pausing locally also cannot prevent a request already in flight from being accepted remotely. A single forward-only card ordering obscures independent authorization, attempt, and outcome states.
- Failure: one Notion timeout makes startup wait forever, preventing unrelated reading and chat. Or the owner pauses after transport send but before remote acceptance, and the destination writes while the UI implies nothing can happen.
- Change: startup durably classifies interrupted attempts as unknown and prevents unsafe retries before resuming. Reconcile asynchronously and expose unresolved outcomes as structured state to resumed work. Define Pause and Stop as preventing new dispatch authorizations and requesting cancellation; already authorized traffic may finish. State machines should preserve prior evidence and distinguish cancellation requested, definitely cancelled, unknown, and completed.

### R13. Backup segments need a consistent replay and redaction protocol

- Severity: high. Blocking: before shipping backup or recovery.
- Plan: §3.6, §12, WP0 and WP7.
- Problem: a SQLite changeset is not by itself a durable, ordered backup journal. The plan has no segment commit position, chain identity, gap detection, snapshot cut, or crash-safe manifest publication. Rewriting a segment after redaction can invalidate later changesets that depend on its former rows. Encryption alone does not prevent rollback to an older, valid backup.
- Failure: a full snapshot and the "next" changeset overlap or leave a gap during concurrent writes. A cloud folder exposes the latest manifest before a segment is available. Redaction rewrites a base segment while later deltas still contain old summary or pin text. Restore either fails halfway or resurrects removed content.
- Change: specify a backup generation, schema version, snapshot commit position, ordered segment positions, authenticated manifest, and gap-free replay into a fresh database followed by atomic installation. Persist export progress so a crash cannot forget unexported transactions. Use fresh AES-GCM nonces on every encryption, including rewrites. Redaction should publish a new sanitized checkpoint and compatible chain before retiring old generations. Define retention and restoration of old redaction state, including a deletion record outside any history allowed to roll back. Add a spike for session-extension availability and capture semantics in the actual utility-process SQLite runtime.

### R14. Work packages allow implementation to outrun the protocols it relies on

- Severity: high. Blocking: yes, for the current dependency graph.
- Plan: §15.
- Problem: WP4 does not depend on WP2. WP6 does not depend on the fakes used by its completion criteria or the provider path needed by its compactor. WP9 does not depend on WP7 even though MCP writes and T3 launches require its policy and dispatcher. M2 starts the runtime before the ownership work deferred to M7. The privacy inventory extends into provider and journal code with no single integration owner.
- Failure: MCP tools become callable before all paths go through the ledger. A working-looking chat ships with weaker input acknowledgement than promised. Redaction passes a memory-page check while raw journal and harness copies remain.
- Change: finish the revised memory, action, and recovery contracts before their implementations. Introduce the local lock, authoritative inbox, journal identity, and provider admission guard before M2. Make WP4 depend on WP2, runtime integration depend on fakes and a minimal provider adapter, and outward MCP work depend on WP7. Split backup and handover from basic ownership. Keep external writes disabled until action crash cases pass. Give one package owner responsibility for end-to-end redaction across stores. Expand S1 and add restore/fencing and backup-capture spikes before accepting M1 as protocol-complete.

### R15. The proposed daily cap is not a hard cap

- Severity: medium. Blocking: no; the default is still an owner question.
- Plan: §0.2 row 16, §3.2, §4.2, §5, §16.
- Problem: compaction continues after the cap, up to eight requests run concurrently, and no reservation ledger covers compaction, chat, delegates, retries, and shortened-summary attempts. Checking spend in the outward-action dispatcher does not gate direct pi-ai calls.
- Failure: eight compactions start just below the cap; all succeed, then keep retrying oversize summaries after it is exceeded. A provider turn also races the same balance.
- Change: call this a soft chat threshold if that is intended. For a hard limit, reserve an upper bound before each billable request and reconcile actual usage, with a defined compaction allowance and treatment of unknown charges. Apply the same admission rule to every model path. Do not promise progress under a permanently exhausted allowance.

## Required Quint model changes

The two proposed names are appropriate, but their current state spaces omit the most consequential failures. Keep tree/request rules in `agent-memory` and authorization/external effects in `agent-actions`. Add a small shared recovery model, or a separate `agent-recovery.qnt`, for the two journals, ownership, backup, and restore. A single scalar epoch and a crash that preserves every database commit cannot expose R1, R2, or R6.

Use opaque payloads and provenance sets rather than natural-language truth. Track all model-visible source dependencies conservatively. A summary can omit or invent a fact; the model must not silently assume faithful summarization. An unchanged message containing the same words is not automatically a derivative of the redacted source. Define deletion scope in terms of records and tracked dependencies, not string equality.

The following is the proposed exact property list. Where a predicate compares transitions, retain ghost pre-state or an event history. Do not label a relational property a state invariant without that encoding.

### `agent-memory` safety invariants

1. `sourceIdentityStable`: tree positions form a dense ordered archive prefix. Immutable source identities are never reassigned; divergent restore histories use a new archive incarnation rather than aliasing lost source IDs.
2. `retainedSourceExact`: every unredacted source and retained attachment page equals its admitted bytes; intentional presentation clipping never changes the archive.
3. `redactionMonotone`: within one archive history, a committed tombstone cannot revert and redaction generations never decrease.
4. `nodeIdentityStable`: a committed `(l,i,ver)` never changes text. Authorized purge may remove it; rebuilding creates a new identity.
5. `nodeInputsCurrent`: a newly committed clean node names its exact child or source versions and all auxiliary context dependencies, with a digest valid at commit.
6. `treeClosed`: every current readable parent has compatible committed children; a dirty or purged branch returns a defined unavailable result instead of old text.
7. `viewPartition`: view intervals are ordered, aligned, disjoint, and cover exactly `[0,covered)` with `0 <= covered <= n`. Dirty placeholders retain their interval identity.
8. `viewReferencesValid`: every readable line names an exact committed clean node version; dirty intervals render only the placeholder.
9. `viewCAS`: a head update succeeds only against the expected head and redaction generation. Stale publications leave the head unchanged.
10. `restartPreservesHead`: an ordinary restart reloads the exact committed head, version references, and coverage watermark.
11. `mergePreservesCoverage`: a merge replaces exactly two adjacent siblings with their valid parent, preserves coverage, and reduces line count by one.
12. `mergeDueOrder`: a merge selects the greatest due score measured from the last covered message, breaking ties by oldest start.
13. `prefixBetweenBatches`: absent reduction and redaction, the old rendered view is a prefix of the next. Pin changes are a separately acknowledged cache invalidation.
14. `pinAuthorityExact`: every active pin is an authorized exact source span or an explicit owner-edited record. No model-selected unrelated source ID grants authority.
15. `pinBudget`: each active pin and the serialized active pin set stay within their admission budgets; superseded and removed pins are excluded from requests.
16. `redactionExcludesReads`: after the redaction commit, newly admitted requests and retrievals expose no record or tracked derivative invalidated by that generation, including stale pins, jobs, and old node versions.
17. `retrievalSound`: zoom either returns the exact permitted child intervals or exact source pages for the requested identity, or a defined redacted/unavailable result. Pagination is gap-free for a stable source version.
18. `requestSnapshotConsistent`: each prepared request uses one committed memory snapshot and explicit historical and active-run cutoffs. Admission validates that its redaction generation is still current.
19. `requestCoverageDeclared`: historical view intervals, tail records or placeholders, and active-run source IDs have no unintended gaps or overlaps within the selected cutoffs. Any omission is explicit.
20. `requestProtocolValid`: dispatched messages retain the provider's required tool-call/result pairing, ordering, IDs, and other required metadata.
21. `requestBounded`: every actual provider dispatch, including compaction, satisfies `inputTokens + outputReserve <= contextWindow`; a blocked result dispatches nothing.
22. `mandatoryPinsIncluded`: every dispatched request to which the pin policy applies contains every active admitted pin exactly. If that is impossible, dispatch is disabled.
23. `compactorLimits`: in-flight jobs do not exceed K, and leaf admission respects the bound on earlier unbuilt leaves.
24. `pendingWorkRecoverable`: every uncovered or dirty interval has sufficient durable state to reconstruct pending work. A failed job records its retry deadline; a crash cannot strand it by losing an in-flight-only queue entry.

Do not assert a hard view low mark, 512-byte node limit, or semantic recall unless a separate rule actually enforces it. `retryWithoutInput` as currently written is queue safety, not a progress proof.

### `agent-actions` safety invariants

1. `intentBeforeDispatch`: every dispatch authorization references a committed immutable intent, complete executable payload, destination binding, and stable action ID.
2. `approvalExact`: every Tier 3 authorization has a committed owner click for that action's exact revision and digest. A batch approval names the exact ordered child actions.
3. `approvalCurrentAtAuthorization`: expiry, source invalidation, editing, discard, or revocation committed before dispatch authorization prevents use of the old approval.
4. `approvalConsumption`: a non-deduplicated dispatch authorization is consumed once, before transport handoff; recovery never makes it unconsumed.
5. `noHiddenRetry`: one non-deduplicated authorization permits at most one transport submission across the dispatcher, MCP layer, and host outbox.
6. `retryRequiresAuthority`: another non-deduplicated submission requires a new owner retry authorization. An uncertain prior effect remains recorded and disclosed.
7. `unknownPreserved`: timeout, crash after authorization, missing search results, and inconclusive reads never establish definite failure or success.
8. `dedupeIdentityStable`: all retries of a deduplicated action use the same destination-scoped key and identical payload within the destination's supported retention contract.
9. `dedupedEffectOnce`: under that explicit destination contract, its accepted-effect count for an action is at most one, including across lost responses and restarts.
10. `receiptMatchesAction`: success is supported by a receipt or conclusive reconciliation identifying the intended action and destination. A later different remote value does not erase evidence of earlier success.
11. `scopedNoClickGrant`: Tier 2 no-click dispatch is covered by a live owner job grant for that operation and target. Run origin alone cannot satisfy it.
12. `untrustedCannotGrant`: tool output, summaries, reports, model arguments, and steering of those records cannot create, broaden, or restore permission.
13. `tier4NeverDispatched`: unsupported destructive operations cannot reach transport through generic MCP, child tools, or settings changes.
14. `allWritesGated`: every external-write path and delegated writer obeys the dispatcher policy; classification cannot silently change an approved operation's meaning.
15. `currentOwnerAuthorizes`: every new dispatch authorization is accepted by the actual ownership authority for the current holder and epoch. This is not assumed from the executor's cached epoch.
16. `pauseBlocksAuthorization`: no new dispatch authorization occurs while the relevant pause, global-off, or revocation state is committed. Earlier in-flight traffic is tracked separately.
17. `quietHoursHoldAuthorization`: schedule-originated Tier 3 work cannot gain dispatch authorization during the specified quiet interval.
18. `scheduleGrantValid`: every active schedule has a live grant covering its purpose and scope, not merely an existing origin ID.
19. `occurrenceAdmissionOnce`: each `(scheduleId, scheduleRevision, dueAt)` creates at most one durable wake admission across crashes and journal rotations.
20. `cancelWinsBeforeAdmission`: a committed schedule delete or pause blocks new occurrence admissions; queued wakes revalidate schedule revision and grant before starting work.
21. `batchEffectsIndependent`: each child action retains its own authorization consumption and outcome. Retrying one child cannot dispatch completed siblings.
22. `outcomeEvidenceStable`: terminal receipt evidence and consumed authorizations are not overwritten by retry, cancellation, or stale callbacks. New attempts add history instead.

Separate `authorizeDispatch`, `transportSend`, `destinationAccept`, and `recordReceipt`. A remote acceptance after Pause or takeover may be valid if its authorization preceded that event. This is why the plan's absolute `pauseStops` wording and an executor-local epoch guard are insufficient.

### Recovery and ownership safety invariants

1. `singleLocalOwner`: at most one live process holds the same local store open for writing; shutdown retains the lock until owned I/O is stopped.
2. `acknowledgedInputDurable`: every acknowledged input exists in authoritative durable admission state under the stated power-failure model.
3. `projectionPrefix`: the archive projection applies each eligible journal record once, in order, and advances its cursor in the same transaction as its output.
4. `journalIdentityUnique`: projection, task, request, and action references include an incarnation that is never reused after rotation or restore.
5. `ordinaryCrashPreservesCommittedAuthority`: the crash abstraction preserves `FULL` authority commits and separately permits loss of weaker journal commits.
6. `transferCheckpointComplete`: a cooperative successor activates only from the final released checkpoint after the predecessor has disabled new work.
7. `restoreDoesNotAuthorize`: installing a backup never by itself revalidates approvals, clears unknown attempts, or grants ownership.
8. `backupChainComplete`: an installed snapshot and its deltas form one authenticated, gap-free history to the declared commit position; partial installation cannot become active.
9. `restoreRespectsDeletion`: executable restoration cannot resurrect records covered by the deletion generation it is required to honor. Older snapshots remain quarantined if that generation cannot be established.
10. `staleOwnerCannotAuthorize`: a partitioned or expired holder cannot obtain new dispatch authorization from the independent authority. For folder-only recovery this property is intentionally unachievable; keep its counterexample visible rather than introducing a fictional gateway transition.

### Temporal properties and assumptions

Keep these distinct from safety. Following the repository convention, typecheck the temporal formulas without claiming an unbounded proof. Add finite drain checks under explicit recovery assumptions.

- `eventuallyProjected`: every durable admission is eventually submitted and projected if the bridge runs fairly and storage remains available.
- `eventuallySummarized`: every retained message eventually enters clean covered memory under fair scheduling, eventual successful compactions, available budget, and no endless redaction of that interval.
- `retryEventuallyRuns`: a persisted due retry eventually starts without new owner input, assuming clock progress and a fair worker. A stored deadline alone is insufficient.
- `redactionEventuallySettles`: after redactions stop and workers recover, each affected interval becomes clean or an explicit permanent tombstone/unavailable state; obsolete local copies are eventually purged under the stated retention policy.
- `batchEventuallyFinishes`: an active batch eventually reaches its low mark only when a feasible partition exists and the required acceptable parents eventually become available.
- `unknownEventuallyExplained`: every unknown attempt eventually receives a reconciliation attempt and becomes conclusive or is shown as unresolved to the owner, assuming the UI and worker run fairly. Do not require eventual remote certainty.
- `approvedEventuallyAttempted`: a still-valid approved action eventually gets an attempt when ownership, pause, quiet hours, budget, and destination availability permit it. Expiry or revocation is an allowed alternative.
- `missedWakeEventuallyAdmitted`: after launch, the selected coalesced missed occurrence is eventually admitted if the schedule remains enabled and authorized. This does not promise a wake for every missed interval.
- `pauseEventuallyQuiescent`: after pause and completion or cancellation of already authorized traffic, no local work remains active. Remote jobs require a responsive cancellation API or an explicit unresolved state.
- `transferEventuallyCompletes`: a cooperative transfer eventually activates the successor under fair delivery of its final checkpoint. No liveness promise applies during a permanent partition.
- `backupEventuallyCatchesUp`: after writes stop and storage synchronization recovers, the latest committed archive prefix eventually has a verified backup chain. This is not zero-loss disaster recovery.

### Directed schedules required before claiming the protocols checked

Retain the plan's sibling, due-order, stale-job, and approval-edit cases. Add these paired broken and corrected schedules:

1. An owner loses folder sync, a successor takes over, and the old owner can still reach the destination.
2. An epoch read succeeds, takeover commits, and the old process sends afterward.
3. A backup contains an approval, the effect succeeds, and a replacement restores that backup.
4. Pi acknowledges input before archive projection, then loses its latest commits on power failure.
5. Rotation reuses entry IDs while the old projection cursor survives.
6. A redaction commits between source-digest validation and node publication.
7. A compaction outside a redacted source's ancestry copied it from auxiliary context.
8. A stale subagent result, pin edit, or active-run request arrives after redaction.
9. A small model or oversized node makes pins plus view exceed the last fallback budget.
10. A current-run input appears in both the projected tail and the active pi suffix.
11. A non-idempotent effect succeeds, loses its response, and a negative lookup precedes retry.
12. The engine outbox or transport retries underneath a single dispatcher attempt.
13. A report steers an owner-origin run into an unauthorized T3 launch or schedule.
14. One child of a multi-send card succeeds before a crash, then the remaining child is retried.
15. Schedule cancellation races a persisted wake that has not yet started work.
16. A backup manifest arrives before its segment, or redaction replaces the chain during restore.

Each broken variant must violate the intended invariant, and the corrected variant must retain the same failure schedule. Do not count syntax errors or a disabled transition as a found counterexample. Use shared protocol actions for bounded instances and simulations, as the existing specs do. Later replay selected traces against the real adapter and fake destinations; passing Quint alone does not certify pi integration, token accounting, or SQLite behavior.

## Implementation order after revision

First settle the authority and failure contracts: input acknowledgement, provider admission, dispatch authorization, restore quarantine, and redaction scope. Spike the pinned pi adapter and backup capture against those contracts. Then write the three small protocol models and the required directed schedules.

Next implement pure memory and request rules, followed by the locked local store, durable inbox, journal bridge, and fake provider. Add the dispatcher and endpoint-specific uncertainty handling before connecting writable MCP tools. Integrate redaction across every store before presenting it as complete. Ship backup and transfer only after testing stale snapshots and partitioned ownership, not merely two directories that immediately see the same epoch.

The current request fallback, folder fencing, ancestor-only redaction, and retry-on-negative-lookup rules must change before their invariants can honestly pass.
