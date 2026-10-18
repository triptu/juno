// Counts markers select cached conversations; a repair covers all their
// cached topics before acknowledging the captured marker. Topics 1 and 2
// share a conversation; topic 2 is outside the fallback. Each topic holds
// one cached message. This abstracts paging within a bounded cached range.
module mutationRepair {
  val topics = Set(1, 2)
  type State = {
    version: int -> int, deleted: Set[int], cached: int -> int, gone: Set[int],
    updated: int, invalid: int, acknowledged: int, acknowledgedInvalid: int,
    captured: int, capturedInvalid: int, pending: Set[int], present: Set[int],
    unchanged: Set[int], answer: int -> int, requested: bool, running: bool,
    sealed: bool, label: str
  }
  var s: State
  var turn: int
  var remaining: int
  action init = all {
    s' = { version: topics.mapBy(_ => 0), deleted: Set(), cached: topics.mapBy(_ => 0), gone: Set(),
      updated: 0, invalid: 0, acknowledged: 0, acknowledgedInvalid: 0,
      captured: 0, capturedInvalid: 0, pending: Set(), present: Set(), unchanged: Set(), answer: topics.mapBy(_ => 0),
      requested: false, running: false, sealed: false, label: "init" },
    turn' = 0, remaining' = 32
  }
  // A version includes reactions: removing a reaction must change it too.
  action edit(k: int): bool = all {
    not(s.sealed), not(s.deleted.contains(k)),
    s' = { ...s, version: s.version.set(k, s.version.get(k) + 1), updated: s.updated + 1, label: "editOrReact" }
  }
  action remove(k: int): bool = all {
    not(s.sealed), not(s.deleted.contains(k)),
    s' = { ...s, deleted: s.deleted.union(Set(k)), invalid: s.invalid + 1, label: "delete" }
  }
  action countsWith(markers: bool): bool = all {
    not(s.running),
    s' = { ...s, running: true, captured: s.updated, capturedInvalid: s.invalid,
      pending: if (markers and (s.updated > s.acknowledged or s.invalid > s.acknowledgedInvalid)) topics else Set(1),
      label: "counts" }
  }
  action counts = countsWith(true)
  // Full snapshot presence is separate from bodies: unchanged messages
  // occupy page slots and are never inferred deleted.
  action request = all {
    s.running, not(s.requested), s.pending.size() > 0,
    s' = { ...s, requested: true, present: s.pending.exclude(s.deleted), answer: s.version,
      unchanged: s.pending.exclude(s.deleted).filter(k => s.cached.get(k) == s.version.get(k)), label: "request" }
  }
  action finishWith(includeUnchanged: bool): bool = {
    val bodies = s.present.exclude(s.unchanged)
    val seen = if (includeUnchanged) s.present else bodies
    all {
      s.requested,
      s' = { ...s, requested: false, pending: Set(),
        cached: topics.mapBy(k => if (bodies.contains(k)) s.answer.get(k) else s.cached.get(k)),
        gone: s.gone.union(s.pending.exclude(seen)), label: "finish" }
    }
  }
  action finish = finishWith(true)
  action acknowledge = all {
    s.running, not(s.requested), s.pending.size() == 0,
    s' = { ...s, running: false, acknowledged: s.captured, acknowledgedInvalid: s.capturedInvalid, label: "acknowledge" }
  }
  // A failed range leaves the old durable marker. Retry obtains new counts.
  action failWith(earlyAck: bool): bool = all {
    not(s.sealed), s.running,
    s' = { ...s, running: false, requested: false, pending: Set(),
      acknowledged: if (earlyAck) s.captured else s.acknowledged,
      acknowledgedInvalid: if (earlyAck) s.capturedInvalid else s.acknowledgedInvalid, label: "failure" }
  }
  action seal = all { not(s.sealed), s' = { ...s, sealed: true, label: "seal" } }
  val dirty = s.updated > s.acknowledged or s.invalid > s.acknowledgedInvalid
  val agreed = topics.forall(k => if (s.deleted.contains(k)) s.gone.contains(k) else not(s.gone.contains(k)) and s.cached.get(k) == s.version.get(k))
  val noFalseDelete = s.gone.subseteq(s.deleted)
  val quietAgreement = (s.sealed and not(s.running) and not(dirty)) implies agreed
  val reachedAgreement = s.sealed and not(s.running) and not(dirty) and agreed
  val drainBound = remaining > 0 or reachedAgreement
  val invariants = noFalseDelete and quietAgreement and drainBound
  action progress = any { all { dirty, counts }, request, finish, acknowledge,
    all { not(dirty), not(s.running), s' = s } }
  action tick(a: bool): bool = all { a, turn' = turn + 1, remaining' = if (s.sealed) remaining - 1 else remaining }
  action simulationStep = all { not(reachedAgreement), tick(if (s.sealed) progress else any {
    progress, edit(1), edit(2), remove(1), remove(2), failWith(false), seal
  }) }
  action outsideFallbackWith(markers: bool): bool = all { not(reachedAgreement), tick(
    if (turn == 0) edit(2) else
    if (turn == 1) countsWith(markers) else
    if (turn == 2) request else
    if (turn == 3) finish else
    if (turn == 4) acknowledge else
    if (turn == 5) seal else progress
  ) }
  action outsideFallbackStep = outsideFallbackWith(true)
  action outsideFallbackBugStep = outsideFallbackWith(false)
  action unchangedWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (turn == 0) edit(2) else
    if (turn == 1) counts else
    if (turn == 2) request else
    if (turn == 3) finishWith(guard) else
    if (turn == 4) acknowledge else
    if (turn == 5) seal else progress
  ) }
  action unchangedStep = unchangedWith(true)
  action unchangedBugStep = unchangedWith(false)
  action failedRepairWith(earlyAck: bool): bool = all { not(reachedAgreement), tick(
    if (turn == 0) edit(2) else
    if (turn == 1) counts else
    if (turn == 2) request else
    if (turn == 3) failWith(earlyAck) else
    if (turn == 4) seal else progress
  ) }
  action failedRepairStep = failedRepairWith(false)
  action failedRepairBugStep = failedRepairWith(true)
}
