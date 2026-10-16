// Read state as implemented: Juno's own pointer per topic, marks mirrored to
// Slack through one coalescing outbox row per topic, and marks from other
// clients arriving as events and pages.
//
// Pointers are 0, 1 or 2 (2 is the latest message). `unread` is the Mark as
// unread flag. Topics in `mirrored` are Main and followed threads with
// mirroring on; any other topic (an unfollowed thread, or any topic while the
// mirror setting is off) changes only locally.
//
// Slack event stamps (`eventClock`) order only events (`updatedEvent`).
// Juno's observation clock (`clock`) orders only fetches (`observedAt`). No
// rule compares the two clocks. Juno never learns when Slack accepted its own
// mark, so after Juno marked a topic (`commanded`) an event that contradicts
// its pointer is not applied: Slack is asked instead (a lookup). An
// observation that arrives while a mark is pending is noted and Slack is
// asked after the mark ends. A fetch applies only when it was requested after
// the topic was last observed or changed, and only when Slack's pointer
// differs from the one Juno last saw (`slackSeen`; -1 is unknown), so a
// local-only mark survives fetches that show an unchanged Slack. A fetch that
// is too old to apply and disagrees with Juno's pointer asks Slack again.
//
// Each switch below exists only so a bug schedule can show what one rule
// prevents.
module readProtocol {
  const topics: Set[int]
  const mirrored: Set[int]
  const eventLimit: int
  const fetchLimit: int
  const drainLimit: int
  type Event = { key: int, value: int, at: int }
  type Fetch = { key: int, value: int, at: int, kind: str }

  var s: {
    mirrorOn: bool, mirrorCaughtUp: bool, localOnly: bool, catchUpFloor: int -> int,
    clock: int, eventClock: int,
    local: int -> int, unread: int -> bool,
    server: int -> int, serverAt: int -> int,
    observedAt: int -> int, updatedEvent: int -> int, slackSeen: int -> int,
    commanded: Set[int], pending: Set[int],
    intent: int -> int, intentUnread: int -> bool, gen: int -> int,
    inflight: int -> int, sentGen: int -> int, accepted: int -> int,
    markAt: int -> int, markValue: int -> int, markUnread: int -> bool, markGen: int -> int,
    noted: Set[int], refresh: Set[int],
    events: Set[Event], fetches: Set[Fetch],
    connected: bool, catchup: bool, scan: Set[int], sealed: bool,
    label: str, target: int, marksQueued: int, marksSent: int
  }
  // The previous state's read view, for `peekNeverMarks`.
  var before: { local: int -> int, unread: int -> bool, pending: Set[int], marksQueued: int, marksSent: int }
  var remaining: int

  action init = all {
    s' = {
      mirrorOn: true, mirrorCaughtUp: false, localOnly: false, catchUpFloor: topics.mapBy(_ => -1),
      clock: 0, eventClock: 0,
      local: topics.mapBy(_ => 2), unread: topics.mapBy(_ => false),
      server: topics.mapBy(_ => 2), serverAt: topics.mapBy(_ => 0),
      observedAt: topics.mapBy(_ => 0), updatedEvent: topics.mapBy(_ => 0),
      slackSeen: topics.mapBy(k => if (mirrored.contains(k)) 2 else -1),
      commanded: Set(), pending: Set(),
      intent: topics.mapBy(_ => 2), intentUnread: topics.mapBy(_ => false), gen: topics.mapBy(_ => 0),
      inflight: topics.mapBy(_ => -1), sentGen: topics.mapBy(_ => 0), accepted: topics.mapBy(_ => 0),
      markAt: topics.mapBy(_ => 0), markValue: topics.mapBy(_ => 2), markUnread: topics.mapBy(_ => false),
      markGen: topics.mapBy(_ => 0), noted: Set(), refresh: Set(), events: Set(), fetches: Set(),
      connected: true, catchup: false, scan: Set(), sealed: false,
      label: "init", target: 0, marksQueued: 0, marksSent: 0
    },
    before' = { local: topics.mapBy(_ => 2), unread: topics.mapBy(_ => false), pending: Set(), marksQueued: 0, marksSent: 0 },
    remaining' = drainLimit
  }

  // Mark read or unread. The pointer and flag change at once and stamp the
  // observation clock. A mirrored topic gets (or keeps) its one pending row,
  // whose intent is replaced: marks coalesce to the last.
  action localChange(k: int, value: int, flag: bool): bool = {
    val mirrors = s.mirrorOn and mirrored.contains(k)
    all {
      not(s.sealed), s.local.get(k) != value or s.unread.get(k) != flag,
      s' = { ...s, clock: s.clock + 1,
        local: s.local.set(k, value), unread: s.unread.set(k, flag),
        observedAt: s.observedAt.set(k, s.clock + 1),
        pending: if (mirrors) s.pending.union(Set(k)) else s.pending,
        commanded: if (mirrors) s.commanded.union(Set(k)) else s.commanded,
        intent: s.intent.set(k, value), intentUnread: s.intentUnread.set(k, flag),
        catchUpFloor: s.catchUpFloor.set(k, -1),
        gen: s.gen.set(k, s.gen.get(k) + 1),
        marksQueued: s.marksQueued + (if (mirrors) 1 else 0),
        label: "localChange", target: k }
    }
  }
  // Mark read never moves the pointer back.
  action markRead(k: int, upTo: int): bool = localChange(k, if (upTo > s.local.get(k)) upTo else s.local.get(k), false)
  action markUnread(k: int, value: int): bool = localChange(k, value, true)

  // The preference changes future marks. The worker drops unsent rows when off.
  action mirrorSwitch(on: bool): bool = all {
    not(s.sealed), s.mirrorOn != on, s.pending.size() == 0,
    s' = { ...s, mirrorOn: on, localOnly: true, label: "mirrorSwitch" }
  }
  // One-time opt-in or default migration. Only known, forward pointers queue.
  action mirrorCatchUpWith(guard: bool): bool = {
    val ahead = mirrored.filter(k => s.slackSeen.get(k) >= 0 and
      (not(guard) or s.local.get(k) > s.slackSeen.get(k)) and not(s.unread.get(k)) and not(s.pending.contains(k)))
    all {
      not(s.sealed), s.mirrorOn, not(s.mirrorCaughtUp), ahead.size() > 0,
      s' = { ...s, mirrorCaughtUp: true, localOnly: false, clock: s.clock + 1,
        pending: s.pending.union(ahead), commanded: s.commanded.union(ahead),
        intent: topics.mapBy(k => if (ahead.contains(k)) s.local.get(k) else s.intent.get(k)),
        intentUnread: topics.mapBy(k => if (ahead.contains(k)) false else s.intentUnread.get(k)),
        gen: topics.mapBy(k => s.gen.get(k) + (if (ahead.contains(k)) 1 else 0)),
        observedAt: topics.mapBy(k => if (ahead.contains(k)) s.clock + 1 else s.observedAt.get(k)),
        catchUpFloor: topics.mapBy(k => if (ahead.contains(k)) s.slackSeen.get(k) else s.catchUpFloor.get(k)),
        marksQueued: s.marksQueued + ahead.size(), label: "mirrorCatchUp" }
    }
  }
  action mirrorCatchUp = mirrorCatchUpWith(true)
  // A catch-up's intent never goes backwards from Slack's known pointer.
  // Slack has no compare-and-set mark: unseen concurrent remote writes are outside this guarantee.
  val catchUpNeverBackwards = topics.forall(k => s.catchUpFloor.get(k) >= 0 implies
    s.intent.get(k) > s.catchUpFloor.get(k))

  // Peeking at a topic changes nothing.
  action peek(k: int): bool = all {
    not(s.sealed), s' = { ...s, label: "peek", target: k }
  }

  // The worker sends the row's current intent and Slack accepts it. Real Slack
  // may or may not echo the mark on this socket.
  action accept(k: int, echo: bool): bool = all {
    s.connected, s.pending.contains(k), s.accepted.get(k) == 0, s.events.size() < eventLimit,
    s' = { ...s, eventClock: s.eventClock + 1,
      inflight: s.inflight.set(k, s.intent.get(k)), sentGen: s.sentGen.set(k, s.gen.get(k)),
      server: s.server.set(k, s.intent.get(k)), serverAt: s.serverAt.set(k, s.eventClock + 1),
      accepted: s.accepted.set(k, s.eventClock + 1),
      markAt: s.markAt.set(k, s.eventClock + 1), markValue: s.markValue.set(k, s.intent.get(k)),
      markUnread: s.markUnread.set(k, s.intentUnread.get(k)), markGen: s.markGen.set(k, s.gen.get(k)),
      events: if (echo) s.events.union(Set({ key: k, value: s.intent.get(k), at: s.eventClock + 1 })) else s.events,
      marksSent: s.marksSent + 1, label: "accept", target: k }
  }

  // The success answer. The row ends unless a newer mark replaced its intent
  // meanwhile; then the worker sends again. The end stamps the observation
  // clock, so a fetch requested while the mark was pending cannot apply.
  action respondWith(k: int, restamp: bool): bool = {
    val done = s.sentGen.get(k) == s.gen.get(k)
    all {
      s.pending.contains(k), s.accepted.get(k) > 0,
      s' = { ...s, clock: s.clock + 1,
        accepted: s.accepted.set(k, 0), inflight: s.inflight.set(k, -1),
        slackSeen: s.slackSeen.set(k, s.inflight.get(k)),
        observedAt: if (restamp) s.observedAt.set(k, s.clock + 1) else s.observedAt,
        pending: if (done) s.pending.exclude(Set(k)) else s.pending,
        refresh: if (done and s.noted.contains(k)) s.refresh.union(Set(k)) else s.refresh,
        noted: if (done) s.noted.exclude(Set(k)) else s.noted,
        label: "respond", target: k }
    }
  }
  action respond(k: int): bool = respondWith(k, true)
  // The work loop's respond, with the restamp switch for `pendingPage`.
  action respondAny(restamp: bool): bool = { nondet k = s.pending.oneOf(); respondWith(k, restamp) }

  // A lost answer or a transient error after Slack accepted. The row keeps
  // its intent and is sent again.
  action retry(k: int): bool = all {
    not(s.sealed), s.pending.contains(k), s.accepted.get(k) > 0,
    s' = { ...s, accepted: s.accepted.set(k, 0), inflight: s.inflight.set(k, -1), label: "retry", target: k }
  }

  // Slack refused the mark. The row ends and Slack is asked; whatever it says
  // applies, since Juno no longer knows Slack's pointer.
  action reject(k: int): bool = all {
    not(s.sealed), s.pending.contains(k), s.accepted.get(k) == 0,
    s' = { ...s, clock: s.clock + 1, pending: s.pending.exclude(Set(k)),
      slackSeen: s.slackSeen.set(k, -1), observedAt: s.observedAt.set(k, s.clock + 1),
      refresh: s.refresh.union(Set(k)), noted: s.noted.exclude(Set(k)),
      label: "reject", target: k }
  }

  // The official client (or a phone) marks a mirrored topic.
  action officialMark(k: int, value: int): bool = all {
    not(s.sealed), mirrored.contains(k), s.events.size() < eventLimit,
    s' = { ...s, eventClock: s.eventClock + 1, server: s.server.set(k, value),
      serverAt: s.serverAt.set(k, s.eventClock + 1),
      events: if (s.connected) s.events.union(Set({ key: k, value: value, at: s.eventClock + 1 })) else s.events,
      label: "officialMark", target: k }
  }

  // An event applies in stamp order. While a mark is pending it is only noted
  // (`keep`). After Juno marked the topic, one that contradicts the pointer is
  // looked up instead (`verify`). Its arrival is an observation: a fetch
  // requested before it cannot apply.
  action deliverWith(e: Event, guard: bool, verify: bool, keep: bool): bool = {
    val k = e.key
    val newer = not(guard) or e.at > s.updatedEvent.get(k)
    val busy = s.pending.contains(k)
    val same = e.value == s.local.get(k)
    val conflict = verify and s.commanded.contains(k) and not(same)
    val applies = newer and not(busy) and not(conflict)
    all {
      s.connected, s.events.contains(e),
      s' = { ...s, clock: s.clock + 1, events: s.events.exclude(Set(e)),
        noted: if (newer and busy and keep and e.value != s.intent.get(k)) s.noted.union(Set(k)) else s.noted,
        refresh: if (newer and not(busy) and conflict) s.refresh.union(Set(k)) else s.refresh,
        local: if (applies) s.local.set(k, e.value) else s.local,
        unread: if (applies and not(same)) s.unread.set(k, false) else s.unread,
        updatedEvent: if (applies) s.updatedEvent.set(k, e.at) else s.updatedEvent,
        observedAt: if (applies) s.observedAt.set(k, s.clock + 1) else s.observedAt,
        slackSeen: if (applies) s.slackSeen.set(k, e.value) else s.slackSeen,
        label: "deliver", target: k }
    }
  }
  action deliver(e: Event): bool = deliverWith(e, true, true, true)

  // A fetch carries Slack's pointer when it was requested: `page` (counts,
  // getView, a root on a page), `scan` (the reconnect refresh) and `lookup`
  // (Juno asking after a mark or a contradicting event).
  action startFetch(k: int, kind: str): bool = all {
    s.connected, mirrored.contains(k), s.fetches.size() < fetchLimit,
    s' = { ...s, clock: s.clock + 1,
      fetches: s.fetches.union(Set({ key: k, value: s.server.get(k), at: s.clock + 1, kind: kind })),
      refresh: if (kind == "lookup") s.refresh.exclude(Set(k)) else s.refresh,
      scan: if (kind == "scan") s.scan.exclude(Set(k)) else s.scan,
      label: "startFetch", target: k }
  }

  action finishFetch(f: Fetch, guard: bool): bool = {
    val k = f.key
    val newer = not(guard) or f.at > s.observedAt.get(k)
    val busy = s.pending.contains(k)
    val changed = f.value != s.slackSeen.get(k)
    val applies = newer and not(busy) and changed
    val same = f.value == s.local.get(k)
    // Too old to apply, yet it disagrees: Slack may have changed after Juno's
    // last observation, or before it. Ask again.
    val stale = guard and not(newer) and not(busy) and not(same)
    all {
      s.fetches.contains(f),
      s' = { ...s, fetches: s.fetches.exclude(Set(f)),
        noted: if (newer and busy and f.value != s.intent.get(k)) s.noted.union(Set(k)) else s.noted,
        refresh: if (stale) s.refresh.union(Set(k)) else s.refresh,
        local: if (applies) s.local.set(k, f.value) else s.local,
        unread: if (applies and not(same)) s.unread.set(k, false) else s.unread,
        observedAt: if (applies) s.observedAt.set(k, f.at) else s.observedAt,
        slackSeen: if (applies) s.slackSeen.set(k, f.value) else s.slackSeen,
        label: "finishFetch", target: k }
    }
  }

  // Events sent while the socket is down never arrive. HTTP answers can.
  action disconnect = all {
    not(s.sealed), s.connected,
    s' = { ...s, connected: false, events: Set(), scan: Set(), catchup: false, label: "disconnect" }
  }
  // A reconnect refreshes every mirrored topic: counts for Main, getView for threads.
  action reconnect = all {
    not(s.connected),
    s' = { ...s, connected: true, catchup: true, scan: mirrored, label: "reconnect" }
  }
  action finishCatchup = all {
    s.catchup, s.scan.size() == 0, not(s.fetches.exists(f => f.kind == "scan")),
    s' = { ...s, catchup: false, label: "finishCatchup" }
  }
  // Stop new input and failures. Queued work still completes.
  action seal = all {
    not(s.sealed), s' = { ...s, sealed: true, label: "seal" }
  }

  val settledWork = s.pending.size() == 0 and s.events.size() == 0 and s.fetches.size() == 0 and s.refresh.size() == 0
  val quiet = s.connected and settledWork and not(s.catchup) and s.scan.size() == 0
  val agreed = mirrored.forall(k => s.local.get(k) == s.server.get(k))
  val quietAgreement = (quiet and s.mirrorOn and not(s.localOnly)) implies agreed
  // A pending mark keeps its pointer and flag visible.
  val pendingIntentWins = topics.forall(k => s.pending.contains(k) implies
    (s.local.get(k) == s.intent.get(k) and s.unread.get(k) == s.intentUnread.get(k)))
  val localUnreadProtected = topics.forall(k => (s.pending.contains(k) and s.intentUnread.get(k)) implies
    (s.local.get(k) == s.intent.get(k) and s.unread.get(k)))
  // While Slack's latest write is Juno's accepted mark and the user has not
  // marked since, older information cannot undo it. A newer Slack write, or
  // the user's next mark, can.
  val acceptedMarkKept = mirrored.forall(k => (not(s.pending.contains(k)) and s.markAt.get(k) > 0 and
    s.serverAt.get(k) == s.markAt.get(k) and s.gen.get(k) == s.markGen.get(k)) implies
    (s.local.get(k) == s.markValue.get(k) and s.unread.get(k) == s.markUnread.get(k)))
  val acceptedUnreadProtected = mirrored.forall(k => (not(s.pending.contains(k)) and s.markAt.get(k) > 0 and
    s.serverAt.get(k) == s.markAt.get(k) and s.gen.get(k) == s.markGen.get(k) and s.markUnread.get(k)) implies
    (s.local.get(k) == s.markValue.get(k) and s.unread.get(k)))
  val peekNeverMarks = s.label == "peek" implies (s.local == before.local and s.unread == before.unread and
    s.pending == before.pending and s.marksQueued == before.marksQueued and s.marksSent == before.marksSent)
  val reachedAgreement = s.sealed and quiet and agreed
  val drainBound = remaining > 0 or reachedAgreement
  val invariants = pendingIntentWins and localUnreadProtected and acceptedMarkKept and acceptedUnreadProtected and
    quietAgreement and peekNeverMarks and drainBound and catchUpNeverBackwards

  action work(fetchGuard: bool, eventGuard: bool): bool = any {
    reconnect, finishCatchup,
    { nondet k = s.pending.oneOf(); nondet echo = Set(true, false).oneOf(); accept(k, echo) },
    respondAny(true),
    { nondet e = s.events.oneOf(); deliverWith(e, eventGuard, true, true) },
    { nondet f = s.fetches.oneOf(); finishFetch(f, fetchGuard) },
    { nondet k = s.refresh.oneOf(); startFetch(k, "lookup") },
    { nondet k = s.scan.oneOf(); startFetch(k, "scan") }
  }
  action progress(fetchGuard: bool, eventGuard: bool): bool =
    any { work(fetchGuard, eventGuard), all { quiet, s' = { ...s, label: "idle" } } }
  action input = {
    nondet k = topics.oneOf()
    nondet value = Set(0, 1, 2).oneOf()
    any {
      markRead(k, value), markUnread(k, if (value == 2) 1 else value), officialMark(k, value), peek(k),
      retry(k), reject(k), disconnect, seal,
      startFetch(k, "page")
    }
  }
  action tick(a: bool): bool = all {
    a,
    before' = { local: s.local, unread: s.unread, pending: s.pending, marksQueued: s.marksQueued, marksSent: s.marksSent },
    remaining' = if (s.sealed and not(quiet)) remaining - 1 else remaining
  }
  action stepWith(fetchGuard: bool, eventGuard: bool): bool = tick(
    if (s.sealed) progress(fetchGuard, eventGuard)
    else any { input, progress(fetchGuard, eventGuard) }
  )
  action step = stepWith(true, true)
  action simulationStep = all { not(reachedAgreement), step }
  temporal eventualAgreement = progress(true, true).weakFair(s).implies(
    eventually(always(s.sealed)).implies(eventually(always(quiet and agreed))))

  // Directed schedules. Each seals after its last scripted step and then
  // drains with the real rules; the sealed branch comes first so a later
  // label never re-enters the script.
  action finish = seal

  action mirrorCatchUpSchedule(guard: bool): bool = tick(
    if (s.sealed) progress(true, true) else
    if (s.label == "init") officialMark(1, 0) else
    if (s.label == "officialMark") { nondet e = s.events.oneOf(); deliver(e) } else
    if (s.label == "deliver") mirrorSwitch(false) else
    if (s.label == "mirrorSwitch" and not(s.mirrorOn)) markRead(1, 2) else
    if (s.label == "localChange") mirrorSwitch(true) else
    if (s.label == "mirrorSwitch") mirrorCatchUpWith(guard) else
    if (s.label == "mirrorCatchUp") accept(1, false) else
    if (s.label == "accept") respond(1) else
    finish
  )

  action mirrorCatchUpStep = mirrorCatchUpSchedule(true)
  action mirrorCatchUpBugStep = mirrorCatchUpSchedule(false)

  // Five marks before the worker sends make one call; a mark while one is in
  // flight makes one more, with the newest intent.
  val coalesced = s.marksSent <= 2
  val coalescingSafety = invariants and coalesced
  action coalesceStep = tick(
    if (s.sealed) progress(true, true) else
    if (s.label == "init") markUnread(1, 0) else
    if (s.label == "localChange" and s.gen.get(1) == 1) markRead(1, 1) else
    if (s.label == "localChange" and s.gen.get(1) == 2) markUnread(1, 0) else
    if (s.label == "localChange" and s.gen.get(1) == 3) markRead(1, 2) else
    if (s.label == "localChange" and s.gen.get(1) == 4) markUnread(1, 1) else
    if (s.label == "localChange" and s.gen.get(1) == 5) accept(1, true) else
    if (s.label == "accept" and s.marksSent == 1) markRead(1, 2) else
    if (s.label == "localChange" and s.gen.get(1) == 6) respond(1) else
    finish
  )

  // Slack accepts, the answer is lost, the worker sends the same intent again.
  action retryAfterAcceptStep = tick(
    if (s.sealed) progress(true, true) else
    if (s.label == "init") markUnread(1, 0) else
    if (s.label == "localChange") accept(1, false) else
    if (s.label == "accept" and s.marksSent == 1) retry(1) else
    if (s.label == "retry") accept(1, true) else
    if (s.label == "accept") respond(1) else
    finish
  )

  // Another client marks Main unread; a peek shows it and marks nothing;
  // opening the topic afterwards marks as usual.
  action peekThenMarkStep = tick(
    if (s.sealed) progress(true, true) else
    if (s.label == "init") officialMark(1, 0) else
    if (s.label == "officialMark") { nondet e = s.events.oneOf(); deliver(e) } else
    if (s.label == "deliver" and s.marksQueued == 0) peek(1) else
    if (s.label == "peek") markRead(1, 2) else
    if (s.label == "localChange") accept(1, true) else
    if (s.label == "accept") respond(1) else
    finish
  )

  // Bug: a peek that queued the ordinary open-and-mark.
  action peekBugStep = tick(all {
    s.label == "init",
    s' = { ...s, local: s.local.set(1, 2), pending: Set(1), marksQueued: s.marksQueued + 1, label: "peek", target: 1 }
  })

  // An official mark from before Juno's mark arrives after Juno's answer. It
  // is newer than the event watermark. Without `verify` it undoes the mark.
  action lateMark(verify: bool): bool = tick(
    if (s.sealed) progress(true, true) else
    if (s.label == "init") officialMark(1, 2) else
    if (s.label == "officialMark") markUnread(1, 0) else
    if (s.label == "localChange") accept(1, false) else
    if (s.label == "accept") respond(1) else
    if (s.label == "respond") { nondet e = s.events.oneOf(); deliverWith(e, true, verify, true) } else
    finish
  )
  action lateMarkStep = lateMark(true)
  action lateMarkBugStep = lateMark(false)

  // A page requested before Juno's mark answers after it. Without the
  // observation guard it puts the old pointer back.
  action latePage(guard: bool): bool = tick(
    if (s.sealed) progress(true, true) else
    if (s.label == "init") startFetch(1, "page") else
    if (s.label == "startFetch") markUnread(1, 0) else
    if (s.label == "localChange") accept(1, false) else
    if (s.label == "accept") respond(1) else
    if (s.label == "respond") { nondet f = s.fetches.oneOf(); finishFetch(f, guard) } else
    finish
  )
  action latePageStep = latePage(true)
  action latePageBugStep = latePage(false)

  // A newer official mark lands while Juno's mark is pending. The old rule
  // dropped it, so Juno kept its own pointer while Slack moved on.
  action pendingMark(keep: bool): bool = tick(
    if (s.sealed) progress(true, true) else
    if (s.label == "init") markUnread(1, 0) else
    if (s.label == "localChange") accept(1, false) else
    if (s.label == "accept") officialMark(1, 2) else
    if (s.label == "officialMark") { nondet e = s.events.oneOf(); deliverWith(e, true, true, keep) } else
    if (s.label == "deliver" and s.pending.contains(1)) respond(1) else
    finish
  )
  action pendingMarkStep = pendingMark(true)
  action pendingMarkBugStep = pendingMark(false)

  // A page requested while Juno's mark is pending, before Slack accepted it,
  // answers after the mark ends. Without the stamp at the end it applies.
  action pendingPage(restamp: bool): bool = tick(
    if (s.sealed) progress(true, true) else
    if (s.label == "init") markUnread(1, 0) else
    if (s.label == "localChange") startFetch(1, "page") else
    if (s.label == "startFetch") accept(1, false) else
    if (s.label == "accept") respondWith(1, restamp) else
    if (s.label == "respond") { nondet f = s.fetches.oneOf(); finishFetch(f, true) } else
    finish
  )
  action pendingPageStep = pendingPage(true)
  action pendingPageBugStep = pendingPage(false)
}

module readstate {
  // Main (1) and a followed thread (2) mirror; thread 3 is not followed and stays local.
  import readProtocol(topics = Set(1, 2, 3), mirrored = Set(1, 2), eventLimit = 8, fetchLimit = 2, drainLimit = 48).*
}
