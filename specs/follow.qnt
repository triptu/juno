// Follow sync as implemented by the command seam and window passes.
// -1 is Unknown (no stored row), 0 is unfollowed, 1 is followed.
// Slack event stamps order only events. Juno observations order only pages.
// No persisted retry worker is modelled. A failed call asks for the root,
// even when Slack accepted the call before its response was lost, and asks
// again while that lookup fails. Three guards keep an accepted Unsubscribe:
// a command's end stamps the observation clock (`acknowledge`, `reject`),
// an event that contradicts a commanded row asks for the root (`deliver`),
// and a failed lookup keeps the command's state (`failLookup`). Their
// switches exist only so the bug schedules can show what each one prevents.
module followProtocol {
  const threads: Set[int]
  const window: Set[int]
  const recent: Set[int]
  const eventLimit: int
  const fetchLimit: int
  const drainLimit: int
  type Event = { key: int, value: int, at: int, kind: str }
  type Fetch = { key: int, value: int, at: int, version: int, kind: str }

  var s: {
    clock: int, eventClock: int, localRoots: Set[int],
    local: int -> int, server: int -> int, serverAt: int -> int,
    observedAt: int -> int, updatedEvent: int -> int,
    intent: int -> int, previous: int -> int, wroteAt: int -> int,
    accepted: int -> int, unfollowAt: int -> int, commanded: Set[int],
    pending: Set[int], noted: Set[int], refresh: Set[int], failed: Set[int], success: Set[int],
    activity: Set[int], stale: Set[int], events: Set[Event], fetches: Set[Fetch],
    connected: bool, duePass: bool, catchup: bool,
    scan: List[int], phase: str, listed: Set[int], passAt: int, pageDone: bool,
    sealed: bool, label: str, target: int, failedVersion: int, before: int
  }
  var remaining: int

  action init = all {
    s' = {
      clock: 0, eventClock: 0, localRoots: Set(),
      local: threads.mapBy(k => if (window.contains(k)) 1 else -1),
      server: threads.mapBy(k => if (window.contains(k)) 1 else 0),
      serverAt: threads.mapBy(_ => 0), observedAt: threads.mapBy(_ => 0),
      updatedEvent: threads.mapBy(_ => 0), intent: threads.mapBy(_ => 1),
      previous: threads.mapBy(_ => -1), wroteAt: threads.mapBy(_ => 0),
      accepted: threads.mapBy(_ => 0), unfollowAt: threads.mapBy(_ => 0), commanded: Set(),
      pending: Set(), noted: Set(), refresh: Set(), failed: Set(), success: Set(), activity: Set(),
      stale: threads.exclude(window), events: Set(), fetches: Set(), connected: true, duePass: true, catchup: false,
      scan: List(), phase: "idle", listed: Set(), passAt: 0, pageDone: false,
      sealed: false, label: "init", target: 0, failedVersion: 0, before: -1
    },
    remaining' = drainLimit
  }

  // A New chat root is followed locally before Slack follows its author on a reply.
  action authoredRoot(k: int): bool = all {
    not(s.sealed), s.local.get(k) == -1,
    s' = { ...s, localRoots: s.localRoots.union(Set(k)), local: s.local.set(k, 1),
      server: s.server.set(k, 0), activity: s.activity.union(Set(k)), stale: s.stale.exclude(Set(k)), label: "authoredRoot", target: k }
  }

  action authoredRootStep = tick(
    if (s.sealed) progress(true, true, false, true) else
    if (s.label == "init") authoredRoot(3) else
    if (s.label == "authoredRoot") startFetch(3, "root") else
    if (s.label == "startFetch") { nondet f = s.fetches.oneOf(); finishFetch(f, true) } else
    if (s.label == "finishFetch") seal else progress(true, true, false, true)
  )

  action localChange(k: int, value: int): bool = all {
    not(s.sealed), not(s.pending.contains(k)), not(s.refresh.contains(k)),
    s.local.get(k) != value, not(s.local.get(k) == -1 and value == 0),
    s' = { ...s, clock: s.clock + 1, local: s.local.set(k, value),
      observedAt: s.observedAt.set(k, s.clock + 1), wroteAt: s.wroteAt.set(k, s.clock + 1),
      previous: s.previous.set(k, s.local.get(k)), intent: s.intent.set(k, value),
      stale: s.stale.exclude(Set(k)), commanded: s.commanded.union(Set(k)),
      // A new command supersedes an earlier accepted Unsubscribe.
      unfollowAt: s.unfollowAt.set(k, 0),
      pending: s.pending.union(Set(k)), label: "localChange", target: k }
  }
  action subscribe(k: int): bool = localChange(k, 1)
  action unsubscribe(k: int): bool = localChange(k, 0)

  // Server acceptance is separate from the HTTP response. The event is optional:
  // real Slack need not echo a subscription command on this socket.
  action accept(k: int): bool = all {
    s.connected, s.pending.contains(k), s.accepted.get(k) == 0,
    s' = { ...s, eventClock: s.eventClock + 1, server: s.server.set(k, s.intent.get(k)),
      serverAt: s.serverAt.set(k, s.eventClock + 1), accepted: s.accepted.set(k, s.eventClock + 1),
      unfollowAt: if (s.intent.get(k) == 0) s.unfollowAt.set(k, s.eventClock + 1) else s.unfollowAt,
      label: "accept", target: k }
  }
  // The end of a command stamps the observation clock again (`restamp`), so a
  // page requested while the command was pending cannot apply afterwards.
  action acknowledgeWith(k: int, restamp: bool): bool = all {
    s.pending.contains(k), s.accepted.get(k) > 0,
    s' = { ...s, pending: s.pending.exclude(Set(k)), accepted: s.accepted.set(k, 0),
      clock: if (restamp) s.clock + 1 else s.clock,
      observedAt: if (restamp) s.observedAt.set(k, s.clock + 1) else s.observedAt,
      refresh: if (s.noted.contains(k)) s.refresh.union(Set(k)) else s.refresh,
      success: if (s.noted.contains(k)) s.success.union(Set(k)) else s.success,
      noted: s.noted.exclude(Set(k)), label: "acknowledge", target: k }
  }
  action acknowledge(k: int): bool = acknowledgeWith(k, true)
  // Every error ends the pending row and schedules one lookup, not another send.
  action rejectWith(k: int, restamp: bool): bool = all {
    not(s.sealed), s.pending.contains(k),
    s' = { ...s, pending: s.pending.exclude(Set(k)), accepted: s.accepted.set(k, 0),
      clock: if (restamp) s.clock + 1 else s.clock,
      observedAt: if (restamp) s.observedAt.set(k, s.clock + 1) else s.observedAt,
      refresh: s.refresh.union(Set(k)), failed: s.failed.union(Set(k)),
      success: s.success.exclude(Set(k)),
      noted: s.noted.exclude(Set(k)), label: "reject", target: k }
  }
  action reject(k: int): bool = rejectWith(k, true)

  action serverChange(k: int, value: int, source: str): bool = all {
    not(s.sealed), s.events.size() < eventLimit,
    s' = { ...s, eventClock: s.eventClock + 1, server: s.server.set(k, value),
      serverAt: s.serverAt.set(k, s.eventClock + 1),
      localRoots: if (source == "reply" or source == "officialFollow") s.localRoots.exclude(Set(k)) else s.localRoots,
      activity: if (source == "reply") s.activity.union(Set(k)) else s.activity,
      events: if (s.connected) s.events.union(Set({ key: k, value: value, at: s.eventClock + 1, kind: source })) else s.events,
      label: source, target: k }
  }
  action officialFollow(k: int, value: int): bool = serverChange(k, value, "officialFollow")
  action reply(k: int): bool = serverChange(k, 1, "reply")
  action threadMarked(k: int): bool = serverChange(k, s.server.get(k), "threadMarked")

  // An event stamp cannot be ordered against a command. With `verify`, an
  // event that contradicts a row a command wrote asks for the root instead.
  action deliverWith(e: Event, guard: bool, verify: bool): bool = {
    // Own replies do not rewrite a row that already says followed.
    val ownAlreadyFollowed = e.kind == "reply" and s.local.get(e.key) == 1
    val newer = not(ownAlreadyFollowed) and (not(guard) or e.at >= s.updatedEvent.get(e.key))
    val unordered = verify and s.commanded.contains(e.key) and e.value != s.local.get(e.key)
    val free = newer and not(s.pending.contains(e.key))
    val applies = free and not(unordered)
    all {
      s.connected, s.events.contains(e),
      s' = { ...s, clock: s.clock + 1, events: s.events.exclude(Set(e)),
        refresh: if (free and unordered) s.refresh.union(Set(e.key)) else s.refresh,
        local: if (applies) s.local.set(e.key, e.value) else s.local,
        updatedEvent: if (applies) s.updatedEvent.set(e.key, e.at) else s.updatedEvent,
        observedAt: if (applies) s.observedAt.set(e.key, s.clock + 1) else s.observedAt,
        stale: if (applies) s.stale.exclude(Set(e.key)) else s.stale,
        noted: if (newer and s.pending.contains(e.key)) s.noted.union(Set(e.key)) else s.noted,
        label: "deliver", target: e.key }
    }
  }
  action deliver(e: Event, guard: bool): bool = deliverWith(e, guard, true)

  action startFetch(k: int, kind: str): bool = all {
    s.connected, s.fetches.size() < fetchLimit,
    s' = { ...s, clock: s.clock + 1,
      passAt: if (s.passAt == 0 and kind == "view" and s.phase != "idle") s.clock + 1 else s.passAt,
      fetches: s.fetches.union(Set({ key: k, value: s.server.get(k), at: s.clock + 1,
        version: s.serverAt.get(k), kind: kind })), label: "startFetch", target: k }
  }
  // A root without subscribed is explicit Unknown input, not false.
  action missingRoot(k: int): bool = all {
    not(s.sealed), s.connected, s.fetches.size() < fetchLimit,
    s' = { ...s, clock: s.clock + 1,
      fetches: s.fetches.union(Set({ key: k, value: -1, at: s.clock + 1,
        version: s.serverAt.get(k), kind: "root" })), label: "missingRoot", target: k }
  }
  action finishFetch(f: Fetch, guard: bool): bool = {
    val present = f.value != -1 and (f.kind != "view" or f.value == 1)
    val newer = not(guard) or f.at > s.observedAt.get(f.key)
    val ownRoot = s.localRoots.contains(f.key) and not(s.commanded.contains(f.key)) and f.value == 0
    val applies = present and newer and not(s.pending.contains(f.key)) and not(ownRoot)
    val forget = f.kind == "failure" and f.value == 0 and s.previous.get(f.key) == -1
    val keepUnknown = s.local.get(f.key) == -1 and f.value == 0 and (f.kind == "root" or f.kind == "lookup")
    val value = if (forget or keepUnknown) -1 else f.value
    all {
      s.fetches.contains(f),
      s' = { ...s, fetches: s.fetches.exclude(Set(f)),
        local: if (applies) s.local.set(f.key, value) else s.local,
        observedAt: if (applies and not(keepUnknown)) s.observedAt.set(f.key, if (forget) 0 else f.at) else s.observedAt,
        updatedEvent: if (applies and forget) s.updatedEvent.set(f.key, 0) else s.updatedEvent,
        commanded: if (applies and forget) s.commanded.exclude(Set(f.key)) else s.commanded,
        stale: if (applies and not(keepUnknown)) s.stale.exclude(Set(f.key)) else s.stale,
        noted: if (present and newer and s.pending.contains(f.key)) s.noted.union(Set(f.key)) else s.noted,
        refresh: if (Set("success", "failure", "lookup").contains(f.kind)) s.refresh.exclude(Set(f.key)) else s.refresh,
        failed: if (f.kind == "failure") s.failed.exclude(Set(f.key)) else s.failed,
        success: if (f.kind == "success") s.success.exclude(Set(f.key)) else s.success,
        listed: if (f.kind == "view" and f.value == 1) s.listed.union(Set(f.key)) else s.listed,
        pageDone: s.pageDone or (s.scan.length() > 0 and f.key == s.scan.head() and
          ((s.phase == "roots" and f.kind == "root") or
            (Set("window", "recent").contains(s.phase) and f.kind == "view"))),
        label: if (not(present)) "missingIgnored" else if (applies and keepUnknown) "unknownPreserved"
          else if (f.kind == "failure" and applies) "failureRecovered" else "finishFetch",
        target: f.key, failedVersion: f.version, before: s.local.get(f.key) }
    }
  }
  // The failure lookup failed too. Slack may have accepted the call, so the
  // row keeps the command's state and the lookup stays queued ("retry").
  // The old fallbacks restore the previous row: "restore" only while the row
  // still equals the command's own write, "blind" always. They exist for the
  // bug schedules.
  action failLookupWith(k: int, mode: str): bool = {
    val restores = mode == "blind" or
      (mode == "restore" and s.local.get(k) == s.intent.get(k) and s.observedAt.get(k) == s.wroteAt.get(k))
    val forgets = restores and s.previous.get(k) == -1
    all {
      not(s.sealed), s.refresh.contains(k), s.failed.contains(k),
      not(s.fetches.exists(f => f.key == k)),
      s' = { ...s,
        refresh: if (mode == "retry") s.refresh else s.refresh.exclude(Set(k)),
        failed: if (mode == "retry") s.failed else s.failed.exclude(Set(k)),
        local: if (restores) s.local.set(k, s.previous.get(k)) else s.local,
        observedAt: if (forgets) s.observedAt.set(k, 0) else s.observedAt,
        updatedEvent: if (forgets) s.updatedEvent.set(k, 0) else s.updatedEvent,
        commanded: if (forgets) s.commanded.exclude(Set(k)) else s.commanded,
        label: "lookupFailed", target: k, before: s.local.get(k) }
    }
  }
  action failLookup(k: int): bool = failLookupWith(k, "retry")

  // Passage of the quiet window can make an old observation stale.
  action age(k: int): bool = all {
    not(s.sealed), not(window.contains(k)),
    s' = { ...s, activity: s.activity.exclude(Set(k)), stale: s.stale.union(Set(k)), label: "age", target: k }
  }
  // Thread 3 starts outside the window. A reply makes it active; a stale
  // stored follow also gets an immediate root lookup. Unknown stays Unknown.
  action otherReply(k: int): bool = all {
    not(s.sealed), s.connected,
    s' = { ...s, activity: s.activity.union(Set(k)),
      refresh: if (s.stale.contains(k) and s.local.get(k) == 1) s.refresh.union(Set(k)) else s.refresh,
      label: "otherReply", target: k }
  }
  action undatedEvent(k: int): bool = all {
    not(s.sealed), s.connected, s' = { ...s, refresh: s.refresh.union(Set(k)), label: "undatedEvent", target: k }
  }
  action disconnect = all {
    not(s.sealed), s.connected,
    s' = { ...s, connected: false, events: Set(), scan: List(), phase: "idle", pageDone: false, label: "disconnect" }
  }
  action reconnect = all {
    not(s.connected), s' = { ...s, connected: true, catchup: true, label: "reconnect" }
  }
  action hourlyPass = all {
    not(s.sealed), not(s.duePass), s' = { ...s, duePass: true, label: "hourlyPass" }
  }
  val covered = window.union(s.activity)
  pure def ordered(selected: Set[int]): List[int] = List(1, 2, 3).select(k => selected.contains(k))
  // A reconnect reads only recent activity, and never probes missing rows.
  action startScan = all {
    s.connected, s.phase == "idle", s.fetches.size() == 0, s.duePass or s.catchup,
    s' = { ...s, passAt: 0,
      phase: if (s.duePass) "window" else "recent",
      scan: ordered(if (s.duePass) covered else recent), listed: Set(), pageDone: false, label: "startScan" }
  }
  action requestPage = all {
    s.phase != "idle", s.scan.length() > 0, s.fetches.size() == 0, not(s.pageDone),
    startFetch(s.scan.head(), if (s.phase == "roots") "root" else "view")
  }
  action advancePage(singlePage: bool): bool = all {
    s.phase != "idle", s.scan.length() > 0, s.fetches.size() == 0, s.pageDone,
    s' = { ...s, scan: if (singlePage and s.phase != "roots") List() else s.scan.tail(),
      pageDone: false, label: "advancePage" }
  }
  action finishScan(recoverAbsent: bool): bool = all {
    s.phase != "idle", s.scan.length() == 0, s.fetches.size() == 0,
    s' = if (s.phase == "window" and recoverAbsent)
      { ...s, phase: "roots", scan: ordered(covered.filter(k => s.local.get(k) == 1 and
          not(s.listed.contains(k)) and s.observedAt.get(k) < s.passAt)), label: "probeAbsent" }
      else { ...s, phase: "idle", duePass: if (s.phase == "recent") s.duePass else false,
        catchup: false, label: "finishScan" }
  }
  // Stop input and let the next due hourly pass run after delivery settles.
  // This is a fairness assumption, not a full-list pass on reconnect. Ignore
  // an unfinished pass's cursor; queued responses still complete before a
  // new pass starts, as they would before the next hourly pass once quiet.
  action seal = all {
    not(s.sealed), s' = { ...s, sealed: true, duePass: true,
      scan: List(), phase: "idle", listed: Set(), pageDone: false, label: "seal" }
  }

  val settledWork = s.pending.size() == 0 and s.events.size() == 0 and s.fetches.size() == 0 and s.refresh.size() == 0
  val quiet = s.connected and settledWork and s.phase == "idle" and not(s.duePass) and not(s.catchup)
  // Unknown is retained for an unfollowed root that never had a row. This
  // predicate describes storage agreement; it is not the sidebar's read rule.
  val agreed = covered.forall(k => s.local.get(k) == s.server.get(k) or (s.local.get(k) == -1 and s.server.get(k) == 0) or (s.localRoots.contains(k) and not(s.commanded.contains(k)) and s.local.get(k) == 1 and s.server.get(k) == 0))
  val quietAgreement = s.sealed and quiet implies agreed
  val pendingIntentWins = threads.forall(k => s.pending.contains(k) implies s.local.get(k) == s.intent.get(k))
  // The strong property the three guards exist for; its bug schedules show each one.
  // It holds until the user's next command on the thread, or a newer Slack write.
  val acceptedUnfollow = threads.forall(k => not(s.pending.contains(k)) and s.unfollowAt.get(k) > 0 and
    s.serverAt.get(k) == s.unfollowAt.get(k) implies s.local.get(k) == 0)
  val failedCallReverted = s.label == "failureRecovered" and s.serverAt.get(s.target) == s.failedVersion implies
    (s.local.get(s.target) == s.server.get(s.target) or (s.local.get(s.target) == -1 and s.server.get(s.target) == 0))
  val missingChangesNothing = s.label == "missingIgnored" implies s.local.get(s.target) == s.before
  val unknownStaysUnknown = s.label == "unknownPreserved" implies s.local.get(s.target) == -1
  // A failed lookup that changes the row must not replace a newer applied event.
  val fallbackKeepsLatestEvent = s.label == "lookupFailed" and s.local.get(s.target) != s.before and
    s.updatedEvent.get(s.target) > 0 and s.updatedEvent.get(s.target) == s.serverAt.get(s.target)
    implies s.local.get(s.target) == s.server.get(s.target)
  val reachedAgreement = s.sealed and quiet and agreed
  val drainBound = remaining > 0 or reachedAgreement
  val authorFollowSurvivesPage = s.label == "finishFetch" and s.localRoots.contains(s.target) and not(s.commanded.contains(s.target)) implies s.local.get(s.target) == 1
  val invariants = authorFollowSurvivesPage and pendingIntentWins and acceptedUnfollow and quietAgreement and failedCallReverted and
    missingChangesNothing and unknownStaysUnknown and fallbackKeepsLatestEvent and drainBound

  action work(fetchGuard: bool, eventGuard: bool): bool = any {
    reconnect,
    { nondet k = s.pending.oneOf(); accept(k) },
    { nondet k = s.pending.oneOf(); acknowledge(k) },
    { nondet e = s.events.oneOf(); deliver(e, eventGuard) },
    { nondet f = s.fetches.oneOf(); finishFetch(f, fetchGuard) },
    { nondet k = s.refresh.filter(k => not(s.fetches.exists(f => f.key == k))).oneOf()
      startFetch(k, if (s.failed.contains(k)) "failure" else if (s.success.contains(k)) "success" else "lookup") }
  }
  action progress(fetchGuard: bool, eventGuard: bool, singlePage: bool, recoverAbsent: bool): bool =
    if (s.sealed and not(settledWork)) work(fetchGuard, eventGuard)
    else any {
      work(fetchGuard, eventGuard), startScan, requestPage,
      advancePage(singlePage), finishScan(recoverAbsent),
      all { quiet, s' = { ...s, label: "idle" } }
    }
  action input = {
    nondet k = threads.oneOf()
    nondet value = Set(0, 1).oneOf()
    any {
      subscribe(k), unsubscribe(k), officialFollow(k, value), reply(k), threadMarked(k),
      otherReply(k), age(k), undatedEvent(k), reject(k), failLookup(k), missingRoot(k), disconnect, hourlyPass, seal,
      all { s.phase == "idle", startFetch(k, "root") }
    }
  }
  action tick(a: bool): bool = all {
    a, remaining' = if (s.sealed and not(quiet)) remaining - 1 else remaining
  }
  action stepWith(fetchGuard: bool, eventGuard: bool, singlePage: bool, recoverAbsent: bool): bool = tick(
    if (s.sealed) progress(fetchGuard, eventGuard, singlePage, recoverAbsent)
    else any { input, progress(fetchGuard, eventGuard, singlePage, recoverAbsent) }
  )
  action step = stepWith(true, true, false, true)
  action simulationStep = all { not(reachedAgreement), step }
  temporal eventualAgreement = progress(true, true, false, true).weakFair(s).implies(
    eventually(always(s.sealed)).implies(eventually(always(quiet and agreed))))

  action stalePage(guard: bool): bool = tick(
    if (s.sealed) progress(guard, true, false, true) else
    if (s.label == "init") startFetch(1, "view") else
    if (s.label == "startFetch") unsubscribe(1) else
    if (s.label == "localChange") accept(1) else
    if (s.label == "accept") acknowledge(1) else
    if (s.label == "acknowledge") { nondet f = s.fetches.oneOf(); finishFetch(f, guard) } else
    if (s.label == "finishFetch" and not(s.sealed)) seal else progress(guard, true, false, true)
  )
  action stalePageStep = stalePage(true)
  action stalePageBugStep = stalePage(false)

  action missedUnfollow(recoverAbsent: bool): bool = tick(
    if (s.sealed) progress(true, true, false, recoverAbsent) else
    if (s.label == "init") disconnect else
    if (s.label == "disconnect") officialFollow(2, 0) else
    if (s.label == "officialFollow") seal else progress(true, true, false, recoverAbsent)
  )
  action missedUnfollowStep = missedUnfollow(true)
  action missedUnfollowBugStep = missedUnfollow(false)
  action missedFollow(singlePage: bool): bool = tick(
    if (s.sealed) progress(true, true, singlePage, true) else
    if (s.label == "init") unsubscribe(2) else
    if (s.label == "localChange") accept(2) else
    if (s.label == "accept") acknowledge(2) else
    if (s.label == "acknowledge") disconnect else
    if (s.label == "disconnect") officialFollow(2, 1) else
    if (s.label == "officialFollow") seal else progress(true, true, singlePage, true)
  )
  action missedFollowStep = missedFollow(false)
  action missedFollowBugStep = missedFollow(true)

  // A pre-command event arrives after the response. It passes the
  // event-only watermark; without `verify` it restores the follow.
  action lateEvent(verify: bool): bool = tick(
    if (s.sealed) progress(true, true, false, true) else
    if (s.label == "init") officialFollow(1, 1) else
    if (s.label == "officialFollow") unsubscribe(1) else
    if (s.label == "localChange") accept(1) else
    if (s.label == "accept") acknowledge(1) else
    if (s.label == "acknowledge") { nondet e = s.events.oneOf(); deliverWith(e, true, verify) } else
    if (s.label == "deliver") seal else progress(true, true, false, true)
  )
  action lateEventStep = lateEvent(true)
  action lateEventBugStep = lateEvent(false)

  action reorderedEvents(guard: bool): bool = tick(
    if (s.sealed) progress(true, guard, false, true) else
    if (s.label == "init") officialFollow(1, 1) else
    if (s.label == "officialFollow" and s.eventClock == 1) officialFollow(1, 0) else
    if (s.label == "officialFollow") { nondet e = s.events.filter(e => e.at == 2).oneOf(); deliver(e, guard) } else
    if (s.label == "deliver" and s.events.size() > 0) { nondet e = s.events.oneOf(); deliver(e, guard) } else
    if (s.label == "deliver") seal else progress(true, guard, false, true)
  )
  val latestEventWins = s.label == "deliver" and s.events.size() == 0 implies s.local.get(1) == s.server.get(1)
  val eventOrderSafety = invariants and latestEventWins
  action reorderedEventsStep = reorderedEvents(true)
  action reorderedEventsBugStep = reorderedEvents(false)

  action ambiguousFailureStep = tick(
    if (s.sealed) progress(true, true, false, true) else
    if (s.label == "init") unsubscribe(1) else
    if (s.label == "localChange") accept(1) else
    if (s.label == "accept") reject(1) else
    if (s.label == "reject") seal else progress(true, true, false, true)
  )
  action pendingObservationStep = tick(
    if (s.sealed) progress(true, true, false, true) else
    if (s.label == "init") unsubscribe(1) else
    if (s.label == "localChange") accept(1) else
    if (s.label == "accept") officialFollow(1, 1) else
    if (s.label == "officialFollow") { nondet e = s.events.oneOf(); deliver(e, true) } else
    if (s.label == "deliver") acknowledge(1) else
    if (s.label == "acknowledge") seal else progress(true, true, false, true)
  )
  action fallbackObservation(guard: bool): bool = tick(
    if (s.sealed) progress(true, true, false, true) else
    if (s.label == "init") unsubscribe(1) else
    if (s.label == "localChange") accept(1) else
    if (s.label == "accept") reject(1) else
    if (s.label == "reject") officialFollow(1, 0) else
    if (s.label == "officialFollow") { nondet e = s.events.oneOf(); deliver(e, true) } else
    if (s.label == "deliver") failLookupWith(1, if (guard) "retry" else "blind") else
    if (s.label == "lookupFailed") seal else progress(true, true, false, true)
  )
  action fallbackObservationStep = fallbackObservation(true)
  action fallbackObservationBugStep = fallbackObservation(false)
  action failedFirstSubscribeStep = tick(
    if (s.sealed) progress(true, true, false, true) else
    if (s.label == "init") subscribe(3) else
    if (s.label == "localChange") reject(3) else
    if (s.label == "reject") seal else progress(true, true, false, true)
  )
  // Slack accepts, the response is lost and the lookup fails too. The old
  // fallback restored the previous follow; the fix keeps the unfollow and
  // looks up again.
  action failedLookup(retry: bool): bool = tick(
    if (s.sealed) progress(true, true, false, true) else
    if (s.label == "init") unsubscribe(1) else
    if (s.label == "localChange") accept(1) else
    if (s.label == "accept") rejectWith(1, retry) else
    if (s.label == "reject") failLookupWith(1, if (retry) "retry" else "restore") else
    if (s.label == "lookupFailed") seal else progress(true, true, false, true)
  )
  action failedLookupStep = failedLookup(true)
  action failedLookupBugStep = failedLookup(false)
  // A page requested after the local write but before Slack acceptance is
  // also stale. Without `restamp` the command does not stamp observedAt at
  // its end, and the page applies after the acknowledgement.
  action pendingPage(restamp: bool): bool = tick(
    if (s.sealed) progress(true, true, false, true) else
    if (s.label == "init") unsubscribe(1) else
    if (s.label == "localChange") startFetch(1, "view") else
    if (s.label == "startFetch") accept(1) else
    if (s.label == "accept") acknowledgeWith(1, restamp) else
    if (s.label == "acknowledge") { nondet f = s.fetches.oneOf(); finishFetch(f, true) } else
    if (s.label == "finishFetch" and not(s.sealed)) seal else progress(true, true, false, true)
  )
  action pendingPageStep = pendingPage(true)
  action pendingPageBugStep = pendingPage(false)
  action unknownRootStep = tick(
    if (s.sealed) progress(true, true, false, true) else
    if (s.label == "init") startFetch(3, "root") else
    if (s.label == "startFetch") { nondet f = s.fetches.oneOf(); finishFetch(f, true) } else
    if (s.label == "unknownPreserved") missingRoot(3) else
    if (s.label == "missingRoot") { nondet f = s.fetches.oneOf(); finishFetch(f, true) } else
    if (s.label == "missingIgnored") seal else progress(true, true, false, true)
  )
  action oldFollow(activity: bool): bool = tick(
    if (s.sealed) progress(true, true, false, true) else
    if (s.label == "init") officialFollow(3, 1) else
    if (s.label == "officialFollow" and s.connected) { nondet e = s.events.oneOf(); deliver(e, true) } else
    if (s.label == "deliver") age(3) else
    if (s.label == "age") disconnect else
    if (s.label == "disconnect") officialFollow(3, 0) else
    if (s.label == "officialFollow") reconnect else
    if (s.label == "reconnect" and activity) otherReply(3) else
    if (s.label == "reconnect" or s.label == "otherReply") seal else progress(true, true, false, true)
  )
  action oldFollowActivityStep = oldFollow(true)
  action oldFollowQuietStep = oldFollow(false)
}

module follow {
  import followProtocol(threads = Set(1, 2, 3), window = Set(1, 2), recent = Set(1),
    eventLimit = 8, fetchLimit = 2, drainLimit = 64).*
}
