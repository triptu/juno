# WP2 spec gaps: decisions and spec changes

Opus, 2026-10-14. The memory spec (`specs/agent-memory.qnt`) found four gaps in plan v3's memory design (`specs/README.md`, "Plan gaps"). The decisions are in `plan-v3.md` §0 rows G1–G4 and §4. This file lists what the spec must change to model them. Astra owns the edit. The change passes `pnpm specs:check --memory`, and `specs/README.md` drops the four plan gaps or marks them closed.

## G1. Context is raw messages, and compaction reads no pins

Decision: a job's context window is the archive sources just before its interval, newest first, up to 16,384 bytes. Removed sources are skipped. The window stops before the first source that does not fit. Compaction reads no pins.

Spec changes:

- `context(k)` selects source ids, not head lines. Walk ids from `k.a - 1` down to 0, skip ids in `s.removed`, add `s.sizes.get(i)` (plus the 64-byte framing, if the tail rendering counts it) while the sum stays ≤ 16,384, and stop at the first id that does not fit.
- `Node.inputs` holds child refs only. Add `Node.context: Set[int]` for context source ids. `deps` = own source ∪ `deps(children)` ∪ context ids. No transitive step through context.
- Remove `Node.pins` and `Job.pinRev`. Drop the pin terms from `allDeps`, `deps`, `fresh(j)`, the compaction cost in `startWith` and `complete`, and the `nodeInputsCurrent` check at line 348. `nodeInputsCurrent` instead checks that the recorded context equals `context(k)` at start, and that every context id is still unremoved at publication (`fresh`).
- `pinsSurviveCompaction` and `compactionPins` stay: they are about the pin set, which compaction must still not change.
- `contextRace` and `unrecordedContext` stay as written, now over context sources. `ancestry` (the bug in `contextRace`) still misses the cross-interval edge.
- New invariant `taintLocal`: after a redaction of source `m`, every masked line, and every node queued for rebuild by it, has an interval that contains `m`, or starts after `m` with the unremoved source bytes in `[m, start)` at most 16,384. This is the rebuild bound.
- New directed pair `localTaint` (plan #23): build a fixture of at least six leaves where each later node's context would reach `m` only through earlier summaries under the old design, redact `m`, and check `taintLocal`. Bug mode `summaryContext`: context reads head lines (the current `context(k)`), which must violate `taintLocal`.

## G2. The compactor does not pass `H` during a run

Decision: while `s.running`, no job starts on an interval that ends after `s.h`, and publication rechecks it.

Spec changes:

- `startWith`: add `not(s.running) or k.a + k.w <= s.h`.
- `publishWith` (when `validate`): add the same condition on the job's key. A merge only joins published lines, so it cannot pass `H` on its own; no change there.
- `prepareWith`: remove the empty-view fallback. `snapHead` is always `s.head`. Keep the `overlap` bug switch, which puts `[covered, n)` in the tail.
- New invariant `viewWithinCutoff`: `not(s.running) or s.head.covered <= s.h`.
- `fastCompactor` (plan #24): the corrected run must now be refused at `start` for the steer's leaf and still finish its drain after `endRun`. Bug mode `pastCutoff`: `startWith` skips the new condition, and the build publishes. That must violate `viewWithinCutoff`. A disabled start is the corrected behaviour here, so the broken mode is what must produce the violation.

## G3. Pin revision is checked with `gen`

Decision: `memory_head.pin_rev` is bumped by every pin change. Requests revalidate it with `gen`. A pin edit is a compare-and-swap on the pin version and its source lineage.

Spec changes:

- The spec already bumps `pinRev` on insert, edit and redaction, checks it at `dispatchWith`, and has `editPin` revalidate `s.pins.contains(p)` and the source. Keep all of that.
- With G1, jobs no longer depend on pins. Retarget `editedJob` (plan #19) as `editedRequest`: `prepare`, then an owner `edit`, then `dispatch`. Bug mode `genOnly`: `dispatchWith` checks `gen` but not `pinRev`. That must violate `mandatoryPinsIncluded`.
- New invariant `pinEditCurrent`: after an `editPin`, the superseded version was active in `before.pins`, its source is not in `s.removed`, and exactly one version of that pin id is active.
- New directed pair `doubleEdit` (plan #25): two `lateEdit` commands on the same `before` version. Bug mode `stalePin` (the existing switch) must violate `pinEditCurrent`.

## G4. Stored nodes are at most 16 KB

Decision: a stored node is at most 16,384 bytes. If no attempt fits, a leaf stores a copy of its source and a parent stores its shortest attempt cut to 16,384 bytes.

Spec changes:

- `complete`: when `ready` is reached and `shortest > 16384`, set `bytes` to `s.sizes.get(k.a)` and `words` to the source for a leaf, and to 16,384 with `cut: true` for a parent. `words` for a cut parent stays the shortest attempt's provenance set; cutting text removes facts, never adds them, so provenance stays conservative.
- Add an oversized output size above 16,384 (for example 20,000) to the random model outputs, so cuts happen in the sampled traces.
- Compaction window: with no pins, the largest compaction cost is 2,048 + 16,384 (reserve) + 16,384 (context) + 32,768 (input) = 67,584. Replace the 65,536 window in `startWith` and `complete` with 131,072, and keep the admission check. The plan's model check requires the compaction model to fit this.
- New invariants: `nodeBounded`: every stored node has `bytes <= 16384`. `parentInputFits`: every node key with `w > 1` whose two children are committed and clean has `bytes(children) <= 32768`.
- Liveness: `batchFeasible` and the comment at line 424 no longer list oversized nodes as a cause of an irreducible batch. Only popcount and unavailable parents remain.
- New directed pair `oversizeParent` (plan #26): five oversized outputs for each of two sibling leaves, then their parent is queued. The corrected run cuts or copies, starts the parent and finishes. Bug mode `noCap`: `complete` keeps the shortest attempt as is. That must violate `nodeBounded`.

## Not changed

- The 512-byte target, five attempts, shortest-wins and reuse of the bounded original input on each shortening call.
- The tail placeholder, the 24 KB tail cap and the 64 KB active cap.
- No new unbounded liveness claim. The temporal formulas keep their antecedents (quiet, fair recovery, allowance, eventually successful model calls).
