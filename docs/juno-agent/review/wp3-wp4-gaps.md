# WP3/WP4 spec gaps: decisions and spec changes

Opus, 2026-10-14. The actions spec (`specs/agent-actions.qnt`) and the recovery spec (`specs/agent-recovery.qnt`) found nine gaps in plan v3 (`specs/README.md`, "Plan gaps: actions" and "Plan gaps: recovery"). The decisions are in `plan-v3.md` §0 rows G5–G13 and the sections they name. This file lists what the specs must change to model them. Astra owns the edit. The change passes `pnpm specs:check --actions` and `pnpm specs:check --recovery`, then the full `pnpm specs:check`. `specs/README.md` marks each gap closed or, for G7 and G13, a stated limit.

Line numbers are at commit `a3e93b4`.

| Gap | README entry | Decision | Spec change |
| --- | --- | --- | --- |
| 1 | actions 1 | G5: compaction is a sub-budget inside the cap | Small |
| 2 | actions 2 | G6: a `proposedSchedule` click is owner authority | New actions, property, pair |
| 3 | actions 3, recovery 4 | G7: stated limit; an old Mac stops when it sees a newer owner | New action, property, pair |
| 4 | recovery 1 | G8: journal ahead is normal | README only |
| 5 | recovery 2 | G9: the plan now names the S5 SQLite lock | README only |
| 6 | recovery 3 | G10: release, then checkpoint, then publish | Reorder, property, pair |
| 7 | recovery 5 | G11: install rechecks the deletion record | README only |
| 8 | recovery 6 | G12: bookkeeping is never captured | Property |
| 9 | recovery 7 | G13: trusted record from keychain, move code or strict phrase; otherwise a stated limit | New state, actions, properties, pairs |

## G5. Compaction is a sub-budget inside the cap

Decision (§5.4): `reserved + actual ≤ cap + raises` for every path. Compaction may use at most 25% of `cap + raises`. Chat may use the whole cap.

The model already does this. Two edits make the 25% follow raises:

- `agent-actions.qnt:205` (`reserve`): replace `s.compaction + 2 > 2` with `s.compaction + 2 > (s.cap + s.raises) / 4`.
- `agent-actions.qnt:264` (`capHard`): replace `s.compaction <= 2` with `s.compaction <= (s.cap + s.raises) / 4`.

With `raises = 0` and `cap = 8` both are unchanged, so `parallelBudget` and `compactionBudget` (`:458`–`:466`, `agent-checks.mjs:36`, `:38`) keep their results. No raise action is required.

## G6. A click on a proposed schedule is owner authority

Decision (§6.4, §11.1, §12): in a tainted owner run, `schedule_create` returns a `proposedSchedule` card. Start on that card is an owner op. It creates the schedule and mints its grant only if the card's stored revision is still current. Wake and report-only runs get neither path.

Spec changes in `agent-actions.qnt`:

- State (`:24`, `:49`): replace `scheduleSourceClean: bool` with `scheduleAuthority: str` (`"none" | "clean" | "click"`, initial `"none"`), and add `scheduleProposal: int` (current proposal revision, 0 = none) and `scheduleApproved: int` (the revision the owner clicked, 0 = none).
- `scheduleWith` (`:182`–`:185`): set `scheduleAuthority: if (s.ownerRun and s.clean and s.sourceInRun) "clean" else "none"`.
- New actions after `:185`:
  - `proposeSchedule`: idle unless `s.ownerRun`. Sets `scheduleProposal: s.scheduleProposal + 1`. Allowed in a tainted owner run.
  - `clickSchedule`: idle unless `s.scheduleProposal > 0`. Sets `scheduleApproved: s.scheduleProposal`.
  - `scheduleFromClick(guard)`: if `guard and not(s.scheduleProposal > 0 and s.scheduleApproved == s.scheduleProposal and mayAuthorize)` then idle. Otherwise `schedule: true`, `scheduleAuthority: "click"`, add the grant `{ target: 1, opClass: 1, source: s.gen, rev: s.scheduleRev }`, `scheduleApproved: 0`, label `"scheduleClick"`.
- `invalidate` (`:211`–`:217`): on `"redact"`, also reset `scheduleProposal` and `scheduleApproved` to 0. A proposal from a run that saw removed content is void.
- `untrustedCannotGrant` (`:244`–`:247`): add a third case, `(s.label == "scheduleClick" and before.scheduleProposal > 0 and before.scheduleApproved == before.scheduleProposal)`.
- `scheduleFromCleanOwnerRun` (`:262`) becomes `scheduleFromOwnerAuthority`: `not(s.schedule) or s.scheduleAuthority == "clean" or (s.scheduleAuthority == "click" and (s.label != "scheduleClick" or (before.scheduleProposal > 0 and before.scheduleApproved == before.scheduleProposal)))`. Rename it in `safety` (`:270`) and in `agent-checks.mjs:21`.
- `execute` (near `:342`): add `"proposeSchedule"`, `"clickSchedule"`, and `"scheduleClick"` → `scheduleFromClick(bug != "scheduleClick")`.
- Random `input` (`:304`): add `proposeSchedule`, `clickSchedule`, `scheduleFromClick(true)`.
- New pair `clickedSchedule` (plan #27): `report, proposeSchedule, clickSchedule, proposeSchedule, scheduleClick`. The corrected run refuses the stale click and finishes with `not(s.schedule)`. Bug `scheduleClick` creates it and must violate `scheduleFromOwnerAuthority`. Add it to `suiteCommands` (`:487`) as case 42, widen `suiteInit` (`:486`) to `0.to(42)`, and add `['clickedSchedule', 'scheduleFromOwnerAuthority']` to `agent-checks.mjs`.
- New positive witness `clickedScheduleStep`, next to `clickedGrantStep` (`:531`): `report, proposeSchedule, clickSchedule, scheduleClick`, ending with `s.schedule and s.scheduleAuthority == "click"`.
- `reportSchedule` and `wakeSchedule` (`:411`–`:416`) stay. Their bug path now sets `scheduleAuthority: "none"`, which still violates the renamed property.

## G7. A stale owner: a stated limit, plus detection in a shared folder

Decision (§14.1): v1 guarantees one writer after a move, and after a restore whose attestation is true. It cannot stop a still-running old Mac that has not seen the new owner. Before each backup write, the old Mac reads the newest manifest in its folder; a manifest with a higher epoch from another device releases its ownership.

Spec changes:

- `agent-actions.qnt`: none. The comment at `:250`–`:251` stays. README actions entry 3 points to G7.
- `agent-recovery.qnt`:
  - State: add `observedNewer: bool`, initial `false`.
  - New action `observeOwner(guard)`: idle unless `s.actualOwner == 1 and s.active.contains(1)` (B owns and its manifest reached the shared folder). Sets `observedNewer: true` and, when `guard`, `active: s.active.exclude(Set(0))`. Label `"observeOwner"`.
  - New invariant `observedOwnerStops`: `s.authorizations.exclude(before.authorizations).forall(a => not(a.device == 0 and before.observedNewer))`. Add it to `safety` (`:255`).
  - `execute` (near `:333`): `"observe"` → `observeOwner(bug != "observe")`.
  - New pair `staleOwnerObserves` (plan #28): `attest, force, review, activate, observe, authorize(0)`. Corrected: `authorize` is idle, and the case ends with `s.actualOwner == 1 and not(s.active.contains(0)) and s.authorizations == Set()`. Bug `observe` must violate `observedOwnerStops`. Add as case 25, widen `suiteInit` (`:417`) to `0.to(25)`, and add the pair to `agent-checks.mjs`.
  - `partitionedOwner` and `epochReadRace` (`:398`–`:403`) stay as the documented counterexamples. They show the window before A sees B's manifest, which v1 does not close.
- `specs/README.md:238` and `:267`: mark both as a stated limit, closed by G7, and name `staleOwnerObserves`.

## G8. Journal ahead is normal

Decision (§3 step 4): compare `next_seq - 1` with the archive cursor. Ahead resumes and projects. Behind rotates.

The model is already right (`openJournal`, `:108`; `journalAheadStep`, `:446`; `journalRollback`, `:356`). No `.qnt` change. `specs/README.md:264`: mark closed by G8.

## G9. The lock is the S5 SQLite lock

Decision (§2.2, §14.1): `owner.lock` is an SQLite connection with `locking_mode = EXCLUSIVE`, held by a module-level reference until owned I/O stops.

The model is already right (`collect`, `:62`; `releaseLock`, `:65`; `lockHandle` and `lockLifetime`, `:341`–`:346`). No `.qnt` change. `specs/README.md:265`: mark closed by G9, and drop "The plan still says `flock`".

## G10. Release, then checkpoint, then publish

Decision (§14.2): the old Mac commits `released`, then captures the final checkpoint (which holds `released`), then publishes. After a release it authorizes and admits nothing, also after a restart, but it may still write the checkpoint and backup files.

Spec changes in `agent-recovery.qnt`:

- State: add `checkpointReleased: bool`, initial `false`.
- `releaseOwner` (`:126`–`:127`): replace the precondition `s.checkpoint < 0` with `not(s.transfer)` (idle until transfer has begun). Release no longer needs a checkpoint.
- `checkpoint` (`:120`–`:124`): add `not(s.released)` to the idle condition. Make that conjunct switchable by bug `release` only, not by bug `checkpoint`. Set `checkpointReleased: s.released`.
- `publishRelease` (`:128`–`:129`): with `guard`, also require `s.checkpoint >= 0 and s.checkpointReleased`.
- `installSuccessor` (`:132`–`:135`): with `guard`, also require `s.checkpointReleased`.
- `progress` (`:268`–`:272`): the transfer order becomes drain, `releaseOwner`, `checkpoint(true)`, `publishRelease(true)`, `installSuccessor(true)`.
- `transferCheckpointComplete` (`:232`–`:233`): add `and s.checkpointReleased`.
- New invariant `checkpointHoldsRelease`: `s.checkpoint < 0 or s.checkpointReleased`. Add it to `safety`.
- `incompleteCheckpoint` (`:365`): reorder to `inbox, reset, submit, transfer, releaseOwner, checkpoint, publishRelease, successor`. The bug still skips only the drain conditions and must still violate `transferCheckpointComplete`.
- `releaseCrash` (`:368`): keep the commands. Under the new order the corrected run idles at `checkpoint` and `publishRelease`, reboots A active, and refuses `successor`; the drain then completes the transfer. Bug `release` lets `checkpoint` and `publishRelease` skip the release, and now fails first on `checkpointHoldsRelease`. Update `agent-checks.mjs:57` to that property.
- New pair `checkpointReopen` (plan #29): `transfer, drain, releaseOwner, checkpoint, publishRelease, crash, reboot, successor`. Corrected: `rebootOld` (`:136`) stays idle because A is released, and the case ends with `s.successor and not(s.active.contains(0))`. Bug `reopen` lets `rebootOld` ignore `released` (opening the old record as active) and must violate `transferCheckpointComplete`. Add as case 26.
- `cooperativeTransferStep` (`:449`) needs no change; `progress` drives the new order.

## G11. Install rechecks the deletion record

Decision (§14.4): the install transaction compares the candidate's generation with the current record. An older candidate stays quarantined.

The model is already right (`install` guard, `:184`; `redactionDuringRestore`, `:380`). No `.qnt` change. `specs/README.md:268`: mark closed by G11.

## G12. Bookkeeping is never captured

Decision (§14.4): capture attaches only to replicated tables. `backup_progress` and other per-device rows are local.

Spec changes in `agent-recovery.qnt`:

- New invariant `exportNotCaptured`: `s.label != "export" or s.position == before.position`. Add it to `safety`.
- `exportFeedback` (`:410`–`:412`) keeps its commands. Its bug (`persistExportFeedback`, `:165`) now fails at once on `exportNotCaptured`, not only at the drain bound. Update `agent-checks.mjs:71` to `exportNotCaptured`.
- `specs/README.md:270`: mark closed by G12.

## G13. The deletion record on a fresh Mac

Decision (§14.3, §14.4):

- The keychain record is raised to `g+1` before the redaction commits, and "Removed" shows only after the commit. A record ahead of the data at startup starts generation `g+1`.
- A trusted record on a fresh Mac comes from this Mac's keychain, a move confirmed by its code, or the recovery phrase when "Rotate recovery phrase after removals" is on (older generations do not decrypt).
- Without one, Juno restores the newest authenticated generation in the folder and the Review page states the risk. This is a stated limit, kept as a documented counterexample like `staleOwnerCannotAuthorize`.

Spec changes in `agent-recovery.qnt`:

- State: add `strict: bool` (initial `false`), `moveConfirmed: bool` (initial `false`) and `staleDisclosed: bool` (initial `false`). `deletion` (`:24`) now stands for the keychain and manifest record. Define `trusted = s.deletionKnown or s.moveConfirmed or s.strict`.
- Record before removal:
  - New action `raiseDeletion`: `deletion: max(s.deletion, s.gen + 1)`, label `"raiseDeletion"`.
  - `redact` (`:195`) takes `guard`. With `guard`, it is idle unless `s.deletion >= s.gen + 1`. It no longer sets `deletion` itself. Bug `deletionOrder` passes `guard = false` and keeps the old assignment.
  - New invariant `deletionRecordedBeforeRemoved`: `s.label != "redact" or before.deletion >= s.gen`. Add it to `safety`.
  - `progress` (`:268`): before the snapshot branch, if `s.deletion > s.gen`, start the next generation: `gen: s.deletion`, then the existing `snapshot` branch runs because `s.manifest.gen != s.gen`. Without this, a crash between `raiseDeletion` and `redact` leaves no restorable generation and `backupCaughtUp` never holds.
  - New pair `deletionOrder` (plan #31): `inbox, snapshot, redact`. Corrected: `redact` is idle. Bug `deletionOrder` must violate `deletionRecordedBeforeRemoved`.
  - New positive witness `deletionAheadStep`: `inbox, snapshot, raiseDeletion, crash, acquire(0)`, ending with `s.manifest.gen == s.deletion` and `backupCaughtUp`.
- Fresh-Mac sources:
  - `execute` (near `:332`): `"strict"` sets `strict: true`. `"confirmMove"` sets `moveConfirmed: true, deletionKnown: true` and is valid only when `s.releasePublished` (otherwise idle).
  - `beginRestore` (`:166`–`:169`): when `s.strict`, treat a manifest with `gen < s.deletion` as not authenticated and stay idle. This stands for "an older backup key does not open with the current phrase".
  - `install` (`:182`–`:184`): replace `not(s.deletionKnown) or s.candidate.gen < s.deletion` with `(trusted and s.candidate.gen < s.deletion)`. An untrusted install is allowed; the model has one manifest, so the candidate is always the newest in the folder.
  - `review` (`:207`): set `staleDisclosed: not(trusted)`. The Review page shows the fixed line.
  - `activateWith` (`:208`–`:212`): replace `not(s.deletionKnown)` with `not(trusted) and not(s.staleDisclosed)`. Keep the `installedGen < s.deletion` check, but only when `trusted`.
  - `restoreRespectsDeletion` (`:239`–`:241`): apply the generation checks only when `trusted` (read from `s` for install and `before` for activate). An untrusted activation must instead have `before.staleDisclosed`.
  - New property `staleFolderCannotRestoreRemoved`: `s.label != "install" or s.installedGen >= s.deletion`. It is not in `safety`; it is in `cooperativeSafety` (`:266`), like `staleOwnerCannotAuthorize`.
- Pairs:
  - Replace `missingDeletion` (`:413`–`:416`, case 24, `agent-checks.mjs:72`) with `staleFolder` (plan #30): `inbox, snapshot, raiseDeletion, redact, missingDeletion, beginRestore, install, attest, review, activate`. The folder holds only generation 1 while the record is 2. `staleFolderBugStep` runs it as written (the v1 default) and must violate `staleFolderCannotRestoreRemoved`. It is kept as a documented counterexample. `staleFolderStep` puts `strict` first; `beginRestore` stays idle and the case ends with `not(s.installed)`.
  - New positive witness `moveCodeRestoreStep`: `transfer` through `publishRelease` as in `cooperativeTransferStep`, then `missingDeletion, confirmMove, beginRestore, install`, ending with `s.installed and s.installedGen >= s.deletion`.
- `specs/README.md:272`: mark entry 7 as closed by G13 for the three trusted sources and as a stated limit for the folder fallback. Name `staleFolder` next to `partitionedOwner` as the second documented counterexample.

## Totals and checks

- Actions: one new pair (`clickedSchedule`, 43 pairs) and one new witness.
- Recovery: four new pairs (`staleOwnerObserves`, `checkpointReopen`, `deletionOrder`; `staleFolder` replaces `missingDeletion`), 28 pairs, and two new witnesses. Two documented counterexamples: `staleOwnerCannotAuthorize` and `staleFolderCannotRestoreRemoved`.
- New safety properties: `scheduleFromOwnerAuthority` (renamed), `observedOwnerStops`, `checkpointHoldsRelease`, `exportNotCaptured`, `deletionRecordedBeforeRemoved`.
- Update the counts in `specs/README.md` ("The 42 pairs", "The 25 pairs", "The 25 corrected schedules") and the 12-minute budget note if the full run needs more time. Record the new full `pnpm specs:check` time.
