// Two recent cached topics share a conversation. Topic 1 is in the ten-page
// unconditional fallback, topic 2 is not. One page per background pass models
// the finite cap; the durable queue survives refusal and the next catch-up.
module mutationRepair {
  val topics = Set(1, 2)
  type State = {
    content: int -> int, version: int -> int, cached: int -> int, cachedVersion: int -> int,
    deleted: Set[int], gone: Set[int], required: Set[int], marker: int, observed: int,
    pending: Set[int], fallback: bool, fresh: bool, running: bool, requested: bool,
    target: int, present: bool, unchanged: bool, answer: int, answerVersion: int,
    now: int, gap: int, messageAt: int -> int, queuedAt: int -> int, threadMissing: bool, notFound: bool,
    socketAlive: bool, candidate: int, candidateValid: bool, confirmed: bool, frameFailed: bool, rootDeleted: bool,
    sealed: bool, label: str
  }
  var s: State
  var turn: int
  var remaining: int
  action init = all {
    s' = { content: topics.mapBy(_ => 0), version: topics.mapBy(_ => 0), cached: topics.mapBy(_ => 0), cachedVersion: topics.mapBy(_ => 0),
      deleted: Set(), gone: Set(), required: Set(1), marker: 0, observed: 0, pending: Set(), fallback: false, fresh: false,
      running: false, requested: false, target: 1, present: true, unchanged: false, answer: 0, answerVersion: 0, now: 24, gap: 24, messageAt: topics.mapBy(_ => 23), queuedAt: topics.mapBy(_ => 24), threadMissing: false, notFound: false, socketAlive: true, candidate: 0, candidateValid: false, confirmed: false, frameFailed: false, rootDeleted: false, sealed: false, label: "init" },
    turn' = 0, remaining' = 48
  }
  action change(k: int, markers: bool, versions: bool): bool = all {
    not(s.sealed), not(s.deleted.contains(k)),
    s' = { ...s, content: s.content.set(k, s.content.get(k) + 1),
      version: if (versions) s.version.set(k, s.version.get(k) + 1) else s.version,
      marker: if (markers) s.marker + 1 else s.marker,
      required: s.required.exclude(Set(k)).union(Set(1)),
      fresh: false, label: "change" }
  }
  action remove(k: int): bool = all { not(s.sealed), not(s.deleted.contains(k)),
    s' = { ...s, deleted: s.deleted.union(Set(k)), marker: s.marker + 1, required: s.required.exclude(Set(k)).union(Set(1)), fresh: false, label: "delete" } }
  action backwards = all { not(s.sealed), s' = { ...s, marker: s.marker - 1, label: "backwards" } }
  action countsWindow(markers: bool, forwardsOnly: bool, fromNow: bool): bool = {
    val eligible = topics.filter(k => s.messageAt.get(k) >= (if (fromNow) s.now else s.gap) - 24)
    all {
    not(s.running),
    s' = { ...s, running: true, fallback: true, fresh: false,
      pending: if (markers and (if (forwardsOnly) s.marker > s.observed else s.marker != s.observed)) s.pending.union(eligible) else s.pending,
      queuedAt: if (markers and s.marker != s.observed) topics.mapBy(k => if (eligible.contains(k)) s.now else s.queuedAt.get(k)) else s.queuedAt,
      required: if (markers and (if (forwardsOnly) s.marker > s.observed else s.marker != s.observed)) s.required.union(eligible.filter(k => s.deleted.contains(k) or s.version.get(k) != s.cachedVersion.get(k) or s.content.get(k) == s.cached.get(k))) else s.required,
      observed: if (markers) s.marker else s.observed, label: "counts" }
    }
  }
  action countsCompared(markers: bool, forwardsOnly: bool): bool = countsWindow(markers, forwardsOnly, false)
  action countsWith(markers: bool): bool = countsCompared(markers, false)
  action requestWith(skipFallback: bool): bool = {
    nondet k = (if (s.fallback) Set(1) else s.pending).oneOf()
    all { s.running, not(s.requested), s.fallback or s.pending.size() > 0,
      s' = { ...s, requested: true, target: k, notFound: not(s.fallback) and k == 2 and s.threadMissing, present: not(s.deleted.contains(k)),
        unchanged: (not(s.fallback) or skipFallback) and s.cachedVersion.get(k) == s.version.get(k),
        answer: s.content.get(k), answerVersion: s.version.get(k), label: "request" }
    }
  }
  action finishWith(includeUnchanged: bool): bool = all {
    s.requested, not(s.notFound),
    s' = { ...s, requested: false,
      cached: if (s.present and not(s.unchanged)) s.cached.set(s.target, s.answer) else s.cached,
      cachedVersion: if (s.present and not(s.unchanged)) s.cachedVersion.set(s.target, s.answerVersion) else s.cachedVersion,
      gone: if (not(s.present) or (s.unchanged and not(includeUnchanged))) s.gone.union(Set(s.target)) else s.gone,
      pending: if (s.fallback) s.pending else s.pending.exclude(Set(s.target)),
      fresh: s.fresh or s.fallback, fallback: false,
      running: s.fallback, label: "finish" }
  }
  // Failure must not discard queued work, even though markers were observed already.
  action failWith(dropQueue: bool): bool = all { not(s.sealed), s.running,
    s' = { ...s, running: false, requested: false, pending: if (dropQueue) Set() else s.pending, label: "failure" } }
  action finishEmpty = all { s.running, not(s.requested), not(s.fallback), s.pending.size() == 0,
    s' = { ...s, running: false, label: "empty" } }
  action seal = all { not(s.sealed), not(s.running), s' = { ...s, sealed: true, fresh: false, label: "seal" } }
  val dirty = s.marker != s.observed
  val agreed = s.required.forall(k => if (s.deleted.contains(k)) s.gone.contains(k) else not(s.gone.contains(k)) and s.cached.get(k) == s.content.get(k))
  val drained = s.sealed and not(s.running) and not(dirty) and s.pending.size() == 0 and s.fresh
  val noFalseDelete = s.gone.subseteq(s.deleted)
  val quietAgreement = drained implies agreed
  val reachedAgreement = drained and agreed
  val drainBound = remaining > 0 or reachedAgreement
  val invariants = noFalseDelete and quietAgreement and drainBound
  action rootGone = all { not(s.sealed), s.deleted.contains(2),
    s' = { ...s, threadMissing: true, rootDeleted: true, marker: s.marker + 1, label: "rootGone" } }
  action missingWith(drop: bool): bool = all { s.requested, s.notFound,
    s' = { ...s, requested: false, running: false, notFound: false,
      pending: if (drop) s.pending.exclude(Set(2)) else s.pending,
      gone: if (drop and s.rootDeleted) s.gone.union(Set(2)) else s.gone,
      required: if (drop and not(s.rootDeleted)) s.required.exclude(Set(2)) else s.required, label: "thread_not_found" } }
  action advance(hours: int): bool = all { not(s.sealed), not(s.running),
    s' = { ...s, now: s.now + hours, label: "time" } }
  // Expiry is queue age, never the age of the cached message. Expired work is outside the liveness promise.
  action expire = {
    val expired = s.pending.filter(k => s.now - s.queuedAt.get(k) >= 24)
    all { not(s.sealed), not(s.running), expired.size() > 0,
      s' = { ...s, pending: s.pending.exclude(expired), required: s.required.exclude(expired).union(Set(1)), label: "expire" } }
  }
  action progressWith(drop: bool): bool = any { countsWith(true), requestWith(false), finishWith(true), missingWith(drop), finishEmpty }
  action progress = progressWith(true)
  action tick(a: bool): bool = all { a, turn' = turn + 1, remaining' = if (s.sealed) remaining - 1 else remaining }
  action simulationStep = all { not(reachedAgreement), tick(if (s.sealed) progress else any {
    progress, countsWith(false), change(1, false, false), change(2, false, false), change(2, true, false),
    change(1, true, true), change(2, true, true), backwards, remove(1), remove(2), rootGone, advance(24), expire, failWith(false), seal
  }) }
  action fallbackVersionWith(skip: bool): bool = all { not(reachedAgreement), tick(
    if (turn == 0) change(1, false, false) else if (turn == 1) seal else
    if (turn == 2) countsWith(false) else if (turn == 3) requestWith(skip) else
    if (turn == 4) finishWith(true) else if (turn == 5) finishEmpty else progress
  ) }
  action fallbackVersionStep = fallbackVersionWith(false)
  action fallbackVersionBugStep = fallbackVersionWith(true)
  action unchangedWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (turn == 0) backwards else if (turn == 1) countsWith(true) else
    if (turn == 2) requestWith(false) else if (turn == 3) finishWith(true) else
    if (turn == 4) requestWith(false) else if (turn == 5) finishWith(guard) else
    if (turn == 6) seal else progress
  ) }
  action unchangedStep = unchangedWith(true)
  action unchangedBugStep = unchangedWith(false)
  action failedRepairWith(drop: bool): bool = all { not(reachedAgreement), tick(
    if (turn == 0) change(2, true, true) else if (turn == 1) countsWith(true) else
    if (turn == 2) failWith(drop) else if (turn == 3) seal else progress
  ) }
  action failedRepairStep = failedRepairWith(false)
  action failedRepairBugStep = failedRepairWith(true)
  action backwardsChange = all { not(s.sealed),
    s' = { ...s, marker: -1, content: s.content.set(2, 1), version: s.version.set(2, 1), required: topics, label: "backwardsChange" } }
  action backwardsMarkerWith(forwardsOnly: bool): bool = all { not(reachedAgreement), tick(
    if (turn == 0) backwardsChange else if (turn == 1) seal else
    if (turn == 2) countsCompared(true, forwardsOnly) else progress
  ) }
  action backwardsMarkerStep = backwardsMarkerWith(false)
  action backwardsMarkerBugStep = backwardsMarkerWith(true)

  action fridayEdit = all { not(s.sealed),
    s' = { ...s, content: s.content.set(2, 1), version: s.version.set(2, 1), marker: 1, required: topics, label: "SaturdayEdit" } }
  action longGapWith(fromNow: bool): bool = all { not(reachedAgreement), tick(
    if (turn == 0) fridayEdit else if (turn == 1) advance(72) else if (turn == 2) seal else
    if (turn == 3) countsWindow(true, false, fromNow) else progress
  ) }
  action longGapStep = longGapWith(false)
  action longGapBugStep = longGapWith(true)
  action missingThreadWith(drop: bool): bool = all { not(reachedAgreement), tick(
    if (turn == 0) remove(2) else if (turn == 1) rootGone else if (turn == 2) seal else progressWith(drop)
  ) }
  action missingThreadStep = missingThreadWith(true)
  action missingThreadBugStep = missingThreadWith(false)

  // A half-open connection still looks connected to sync. A snapshot needs a later pong.
  action loseSocket = all { not(s.sealed), s' = { ...s, socketAlive: false, label: "halfOpen" } }
  action failedFrame = all { not(s.sealed), s' = { ...s, frameFailed: true, candidateValid: false, label: "failedFrame" } }
  action pong = all { s.socketAlive, s.candidateValid, s' = { ...s, confirmed: true, label: "pong" } }
  action sweepRefreshWith(unsafe: bool): bool = all { not(s.sealed), not(s.running),
    s' = { ...s,
      observed: if (unsafe) s.marker else if (s.candidateValid and s.confirmed and not(s.frameFailed)) s.candidate else s.observed,
      candidate: s.marker, candidateValid: not(s.frameFailed), confirmed: false, label: "sweepRefresh" } }
  action sweepRefresh = sweepRefreshWith(false)
  action halfOpenWith(unsafe: bool): bool = all { not(reachedAgreement), tick(
    if (turn == 0) loseSocket else if (turn == 1) fridayEdit else
    if (turn == 2 or turn == 3) sweepRefreshWith(unsafe) else if (turn == 4) seal else progress
  ) }
  action halfOpenStep = halfOpenWith(false)
  action halfOpenBugStep = halfOpenWith(true)
  action failedFrameWith(unsafe: bool): bool = all { not(reachedAgreement), tick(
    if (turn == 0) fridayEdit else if (turn == 1) sweepRefresh else if (turn == 2) failedFrame else
    if (turn == 3) sweepRefreshWith(unsafe) else if (turn == 4) seal else progress
  ) }
  action failedFrameStep = failedFrameWith(false)
  action failedFrameBugStep = failedFrameWith(true)

}
