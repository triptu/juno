// Read-state delivery rules. Follow uses separate event and observation clocks.
// Assumptions: stamps are comparable change times, not message pointers.
// One command per topic is pending. Different topics remain concurrent.
// A reply, command acceptance, and official-client change are server writes.
// A final failure is definitive. Timeouts keep the same intent for retry.
// During drain, the network recovers and stops failing. No new input arrives.
module mirror {
  const followMode: bool
  const initial: int
  const mirrored: Set[int]
  const topics: Set[int]
  const eventLimit: int
  const fetchLimit: int
  type Event = { key: int, value: int, at: int }
  type Fetch = { key: int, value: int, at: int, epoch: int, kind: str }

  var s: {
    clock: int,
    local: int -> int, server: int -> int, serverAt: int -> int,
    seen: int -> int, seenAt: int -> int, epoch: int -> int,
    pending: Set[int], rejected: Set[int], intent: int -> int, intentUnread: int -> bool,
    unread: int -> bool, accepted: int -> int, ack: int -> int,
    unfollowAt: int -> int, unreadAt: int -> int,
    events: Set[Event], fetches: Set[Fetch],
    connected: bool, dirty: bool, scan: List[int], phase: str,
    listed: Set[int], pageDone: bool, sealed: bool,
    label: str, target: int, failedAt: int, marksQueued: int, marksSent: int
  }

  action baseInit = s' = {
    clock: 0, local: topics.mapBy(_ => initial), server: topics.mapBy(_ => initial),
    serverAt: topics.mapBy(_ => 0), seen: topics.mapBy(_ => initial),
    seenAt: topics.mapBy(_ => 0), epoch: topics.mapBy(_ => 0), pending: Set(), rejected: Set(),
    intent: topics.mapBy(_ => initial), intentUnread: topics.mapBy(_ => false),
    unread: topics.mapBy(_ => false), accepted: topics.mapBy(_ => 0),
    ack: topics.mapBy(_ => 0), unfollowAt: topics.mapBy(_ => 0), unreadAt: topics.mapBy(_ => 0),
    events: Set(), fetches: Set(), connected: true, dirty: false,
    scan: List(), phase: "idle", listed: Set(), pageDone: false, sealed: false,
    label: "init", target: 0, failedAt: 0, marksQueued: 0, marksSent: 0
  }

  // The local transaction precedes any network call.
  action localChange(k: int, value: int, unread: bool): bool = all {
    not(s.sealed), not(s.pending.contains(k)),
    s' = { ...s, clock: s.clock + 1, local: s.local.set(k, value),
      epoch: s.epoch.set(k, s.epoch.get(k) + 1),
      pending: if (mirrored.contains(k)) s.pending.union(Set(k)) else s.pending,
      intent: s.intent.set(k, value), intentUnread: s.intentUnread.set(k, unread),
      unread: s.unread.set(k, unread),
      marksQueued: s.marksQueued + (if (not(followMode) and mirrored.contains(k)) 1 else 0),
      label: "localChange", target: k }
  }

  action serverChange(k: int, value: int, source: str): bool = all {
    not(s.sealed), mirrored.contains(k), s.events.size() < eventLimit,
    s' = { ...s, clock: s.clock + 1, server: s.server.set(k, value),
      serverAt: s.serverAt.set(k, s.clock + 1),
      events: if (s.connected) s.events.union(Set({ key: k, value: value, at: s.clock + 1 })) else s.events,
      label: source, target: k }
  }

  // Success and its response are separate. An official write may fall between them.
  action accept(k: int): bool = all {
    s.connected, s.events.size() < eventLimit, s.pending.contains(k), s.accepted.get(k) == 0, not(s.rejected.contains(k)),
    s' = { ...s, clock: s.clock + 1,
      server: s.server.set(k, s.intent.get(k)), serverAt: s.serverAt.set(k, s.clock + 1),
      accepted: s.accepted.set(k, s.clock + 1),
      unfollowAt: if (followMode and s.intent.get(k) == 0) s.unfollowAt.set(k, s.clock + 1) else s.unfollowAt,
      unreadAt: if (s.intentUnread.get(k)) s.unreadAt.set(k, s.clock + 1) else s.unreadAt,
      events: s.events.union(Set({ key: k, value: s.intent.get(k), at: s.clock + 1 })),
      marksSent: s.marksSent + (if (followMode) 0 else 1), label: "accept", target: k }
  }

  action acknowledge(k: int): bool = {
    val at = s.accepted.get(k)
    val newer = s.seenAt.get(k) > at
    all {
      s.pending.contains(k), at > 0,
      s' = { ...s, pending: s.pending.exclude(Set(k)), accepted: s.accepted.set(k, 0),
        ack: s.ack.set(k, at),
        local: s.local.set(k, if (newer) s.seen.get(k) else s.intent.get(k)),
        unread: s.unread.set(k, if (newer) false else s.intentUnread.get(k)),
        seen: s.seen.set(k, if (newer) s.seen.get(k) else s.intent.get(k)),
        seenAt: s.seenAt.set(k, if (newer) s.seenAt.get(k) else at),
        label: "acknowledge", target: k }
    }
  }

  // A retry preserves the local transaction. It does not invent a rejection.
  action retry(k: int): bool = all {
    not(s.sealed), s.pending.contains(k), not(s.rejected.contains(k)),
    s' = { ...s, accepted: s.accepted.set(k, 0), label: "retry", target: k }
  }

  action startFetch(k: int, kind: str): bool = all {
    s.connected, s.fetches.size() < fetchLimit,
    s' = { ...s, clock: s.clock + 1,
      rejected: if (kind == "failure") s.rejected.union(Set(k)) else s.rejected,
      fetches: s.fetches.union(Set({ key: k, value: s.server.get(k), at: s.clock + 1,
        epoch: s.epoch.get(k), kind: kind })), label: "startFetch", target: k }
  }

  // Rejection starts a fresh root lookup. Restoring the old local value is unsafe.
  action reject(k: int): bool = all {
    not(s.sealed), s.pending.contains(k), s.accepted.get(k) == 0, not(s.rejected.contains(k)),
    not(s.fetches.exists(f => f.key == k and f.kind == "failure")),
    startFetch(k, "failure")
  }

  // Keep the newest observation while a command is pending, without changing its view.
  action deliver(e: Event, guard: bool): bool = {
    val newer = not(guard) or e.at > s.seenAt.get(e.key)
    all {
      s.connected, s.events.contains(e),
      s' = { ...s, events: s.events.exclude(Set(e)),
        seen: if (newer) s.seen.set(e.key, e.value) else s.seen,
        seenAt: if (newer) s.seenAt.set(e.key, e.at) else s.seenAt,
        local: if (newer and not(s.pending.contains(e.key))) s.local.set(e.key, e.value) else s.local,
        unread: if (newer and not(s.pending.contains(e.key))) s.unread.set(e.key, false) else s.unread,
        label: "deliver", target: e.key }
    }
  }

  // Bug variant: the visible pending mark survives, but a newer remote mark vanishes.
  action dropPendingEvent(e: Event): bool = all {
    s.connected, s.events.contains(e), s.pending.contains(e.key),
    s' = { ...s, events: s.events.exclude(Set(e)), label: "deliver", target: e.key }
  }

  action finishFetch(f: Fetch, guard: bool): bool = {
    val sameCommand = f.epoch == s.epoch.get(f.key)
    val newer = f.at > s.seenAt.get(f.key)
    val present = not(followMode) or f.kind != "view" or f.value == 1
    val applies = present and (not(guard) or (sameCommand and newer))
    val failed = f.kind == "failure" and sameCommand and s.pending.contains(f.key) and s.accepted.get(f.key) == 0
    val recovered = if (newer) f.value else s.seen.get(f.key)
    all {
      s.fetches.contains(f),
      s' = { ...s, fetches: s.fetches.exclude(Set(f)),
        seen: if (applies) s.seen.set(f.key, f.value) else s.seen,
        seenAt: if (applies) s.seenAt.set(f.key, f.at) else s.seenAt,
        local: if (failed) s.local.set(f.key, recovered)
          else if (applies and not(s.pending.contains(f.key))) s.local.set(f.key, f.value) else s.local,
        unread: if (failed or (applies and not(s.pending.contains(f.key)))) s.unread.set(f.key, false) else s.unread,
        pending: if (failed) s.pending.exclude(Set(f.key)) else s.pending,
        rejected: if (failed) s.rejected.exclude(Set(f.key)) else s.rejected,
        listed: if (f.kind == "view" and f.value == 1) s.listed.union(Set(f.key)) else s.listed,
        pageDone: s.pageDone or (s.phase != "idle" and (f.kind == "view" or f.kind == "root")),
        label: if (failed) "rollback" else "finishFetch", target: f.key,
        failedAt: if (failed) f.at else s.failedAt }
    }
  }

  action disconnect = all {
    not(s.sealed), s.connected,
    s' = { ...s, connected: false, dirty: true, events: Set(), scan: List(), phase: "idle", pageDone: false, label: "disconnect" }
  }

  action reconnect = all {
    not(s.connected),
    s' = { ...s, connected: true, dirty: true, label: "reconnect" }
  }

  // Three slots and a one-row page stand for a getView spanning more than ten rows.
  // Missing view rows say nothing. Roots of previously followed, absent threads decide false.
  action startScan = all {
    s.connected, s.phase == "idle", (s.fetches.size() == 0),
    s' = { ...s, phase: "view", scan: List(1, 2, 3).select(k => mirrored.contains(k)),
      listed: Set(), pageDone: false, dirty: true, label: "startScan" }
  }

  action requestPage = all {
    s.phase != "idle", s.scan.length() > 0, (s.fetches.size() == 0), not(s.pageDone),
    startFetch(s.scan.head(), s.phase)
  }

  action advancePage(singlePage: bool): bool = all {
    s.phase != "idle", s.scan.length() > 0, (s.fetches.size() == 0), s.pageDone,
    s' = { ...s, scan: if (singlePage and s.phase == "view") List() else s.scan.tail(), pageDone: false, label: "advancePage" }
  }

  action finishScan(recoverAbsent: bool): bool = all {
    s.phase != "idle", (s.scan.length() == 0), (s.fetches.size() == 0),
    s' = if (s.phase == "view" and followMode and recoverAbsent)
      { ...s, phase: "root", scan: List(1, 2, 3).select(k => s.local.get(k) == 1 and not(s.listed.contains(k))), label: "probeAbsent" }
      else { ...s, phase: "idle", dirty: false, label: "finishScan" }
  }

  action seal = all {
    not(s.sealed), s' = { ...s, sealed: true, label: "seal" }
  }

  val agreed = mirrored.forall(k => s.local.get(k) == s.server.get(k))
  val quiet = s.connected and not(s.dirty) and s.phase == "idle" and
    (s.pending.size() == 0) and (s.events.size() == 0) and (s.fetches.size() == 0)
  val quietAgreement = not(quiet) or agreed
  val acceptedUnfollow = topics.forall(k =>
    not(s.pending.contains(k)) and s.unfollowAt.get(k) > 0 and s.serverAt.get(k) == s.unfollowAt.get(k)
      implies s.local.get(k) == 0)
  val pendingIntentWins = topics.forall(k => s.pending.contains(k) implies s.local.get(k) == s.intent.get(k))
  val localUnreadProtected = topics.forall(k =>
    (s.pending.contains(k) and s.intentUnread.get(k)) implies (s.local.get(k) == s.intent.get(k) and s.unread.get(k)))
  val acceptedUnreadProtected = topics.forall(k =>
    not(s.pending.contains(k)) and s.unreadAt.get(k) > 0 and s.seenAt.get(k) <= s.unreadAt.get(k)
      implies (s.local.get(k) == 0 and s.unread.get(k)))
  val failedCallReverted = s.label == "rollback" and s.serverAt.get(s.target) < s.failedAt
    implies s.local.get(s.target) == s.server.get(s.target)
  val safety = pendingIntentWins and quietAgreement and acceptedUnfollow and localUnreadProtected and failedCallReverted
  val reachedAgreement = s.sealed and quiet and agreed

  // Drain uses every real protocol action, but excludes new input and retry failures.
  action progress(fetchGuard: bool, eventGuard: bool, singlePage: bool, recoverAbsent: bool): bool = any {
    reconnect,
    { nondet k = s.pending.oneOf(); accept(k) },
    { nondet k = s.pending.oneOf(); acknowledge(k) },
    { nondet e = s.events.oneOf(); deliver(e, eventGuard) },
    { nondet f = s.fetches.oneOf(); finishFetch(f, fetchGuard) },
    all { s.dirty, startScan },
    // Do not request the same page twice after its response.
    requestPage,
    advancePage(singlePage), finishScan(recoverAbsent),
    all { quiet, s' = { ...s, label: "idle" } }
  }

  // Keep the timer outside s so the selected action can update s once.
  var draining: bool
  var remaining: int
  action timedInit = all { baseInit, draining' = false, remaining' = 40 }
  action tick(a: bool): bool = all {
    a, draining' = s.sealed, remaining' = if (s.sealed and not(quiet)) remaining - 1 else remaining
  }
  val drainBound = not(draining) or remaining > 0 or (quiet and agreed)
  temporal eventualAgreement = progress(true, true, false, true).weakFair(s).implies(
    eventually(always(s.sealed)).implies(eventually(always(quiet and agreed))))
}
