// One persisted pending row per client_msg_id. Slack does not deduplicate
// requests in this model: each acceptance adds another message.
module outboxProtocol {
  const drafts: Set[int]
  const fetchLimit: int
  const drainLimit: int
  type Fetch = { key: int, found: bool, kind: str }

  type State = {
    created: Set[int], row: int -> str, stored: Set[int], discarded: Set[int],
    server: int -> int, request: int -> str, due: Set[int],
    events: Set[int], fetches: Set[Fetch], scan: Set[int],
    online: bool, connected: bool, catchup: bool, sealed: bool,
    label: str, target: int
  }
  var s: State
  var remaining: int
  var turn: int

  action init = all {
    s' = { created: Set(), row: drafts.mapBy(_ => "gone"), stored: Set(), discarded: Set(),
      server: drafts.mapBy(_ => 0), request: drafts.mapBy(_ => "idle"), due: Set(),
      events: Set(), fetches: Set(), scan: Set(),
      online: true, connected: true, catchup: false, sealed: false, label: "init", target: 0 },
    remaining' = drainLimit, turn' = 0
  }

  action send(k: int): bool = all {
    not(s.sealed), not(s.created.contains(k)),
    s' = { ...s, created: s.created.union(Set(k)), row: s.row.set(k, "queued"),
      due: s.due.union(Set(k)), label: "send", target: k }
  }

  // Persist sending before the single HTTP attempt leaves. There is no
  // transport retry action. A crash before the call leaves is a dropped call.
  action claim(k: int): bool = all {
    s.online, s.row.get(k) == "queued", s.due.contains(k), s.request.get(k) == "idle",
    s' = { ...s, row: s.row.set(k, "sending"), request: s.request.set(k, "transit"),
      due: s.due.exclude(Set(k)), label: "claim", target: k }
  }
  action accept(k: int, withEcho: bool): bool = all {
    s.request.get(k) == "transit",
    s' = { ...s, server: s.server.set(k, s.server.get(k) + 1),
      request: s.request.set(k, "accepted"),
      events: if (withEcho and s.connected) s.events.union(Set(k)) else s.events,
      label: "accept", target: k }
  }
  // A permanent refusal, 429, or signed-out answer means not posted.
  action refuse(k: int, retryLater: bool): bool = all {
    not(s.sealed), s.request.get(k) == "transit",
    s' = { ...s, request: s.request.set(k, if (retryLater) "later" else "refused"),
      label: "refuse", target: k }
  }
  // Slack can drop the request without an answer.
  action drop(k: int): bool = all {
    not(s.sealed), s.request.get(k) == "transit",
    s' = { ...s, request: s.request.set(k, "dropped"), label: "drop", target: k }
  }

  // All positive observations use this transaction. Deleting a missing row
  // is harmless, including when an echo has already reconciled the answer.
  def writeMessage(k: int): State = { ...s, stored: s.stored.union(Set(k)), row: s.row.set(k, "gone"),
    due: s.due.exclude(Set(k)), label: "writeMessage", target: k }
  action answerWith(k: int, guard: bool): bool = all {
    s.request.get(k) == "accepted",
    s' = { ...writeMessage(k), request: s.request.set(k, "idle"),
      row: s.row.set(k, if (guard) "gone" else "sending"), label: "answer", target: k }
  }
  action answer(k: int): bool = answerWith(k, true)
  action refused(k: int): bool = all {
    Set("refused", "later").contains(s.request.get(k)),
    s' = { ...s, request: s.request.set(k, "idle"),
      row: if (s.row.get(k) == "sending") s.row.set(k, if (s.request.get(k) == "later") "queued" else "failed") else s.row,
      label: "refused", target: k }
  }
  // An ambiguous failure is observable only after Slack has decided the
  // request. It cannot still be in transit when an absent lookup permits resend.
  action lostWith(k: int, guard: bool): bool = all {
    not(s.sealed) or s.request.get(k) == "dropped",
    Set("accepted", "dropped", "refused", "later").contains(s.request.get(k)),
    s' = { ...s, request: s.request.set(k, "idle"),
      row: if (s.row.get(k) == "sending") s.row.set(k, if (guard) "unknown" else "queued") else s.row,
      label: "lost", target: k }
  }
  action lost(k: int): bool = lostWith(k, true)

  // Restart loses all HTTP answers. For undecided calls Slack has either
  // accepted or dropped them before recovery can look up the ID. `accepted`
  // chooses which transit calls it accepted; previously accepted calls remain.
  action crashWith(accepted: Set[int], guard: bool): bool = all {
    not(s.sealed), accepted.subseteq(drafts.filter(k => s.request.get(k) == "transit")),
    s' = { ...s,
      server: drafts.mapBy(k => s.server.get(k) + (if (accepted.contains(k)) 1 else 0)),
      row: drafts.mapBy(k => if (s.row.get(k) == "sending") (if (guard) "unknown" else "queued") else s.row.get(k)),
      request: drafts.mapBy(_ => "idle"), fetches: Set(),
      // Interrupted lookups become due again; their rows persist.
      due: s.due.union(drafts.filter(k => s.row.get(k) == "unknown")),
      label: "crash", target: 0 }
  }
  action crash = {
    nondet accepted = drafts.filter(k => s.request.get(k) == "transit").powerset().oneOf()
    crashWith(accepted, true)
  }

  action echoWith(k: int, guard: bool): bool = {
    val observed = if (guard) writeMessage(k) else { ...s, stored: s.stored.union(Set(k)) }
    all {
      s.connected, s.events.contains(k),
      s' = { ...observed, events: s.events.exclude(Set(k)), label: "echo", target: k }
    }
  }
  action echo(k: int): bool = echoWith(k, true)

  // A page carries Slack's snapshot at request time. Absence changes nothing.
  // A lookup is complete for this ID, and only unknown rows can start one.
  action startFetch(k: int, kind: str): bool = all {
    s.online, s.created.contains(k), s.fetches.size() < fetchLimit,
    if (kind == "lookup") all {
      s.row.get(k) == "unknown", s.due.contains(k),
      not(s.fetches.exists(f => f.key == k and f.kind == "lookup"))
    } else if (kind == "catchup") s.scan.contains(k) else not(s.sealed),
    s' = { ...s, fetches: s.fetches.union(Set({ key: k, found: s.server.get(k) > 0, kind: kind })),
      due: if (kind == "lookup") s.due.exclude(Set(k)) else s.due,
      scan: if (kind == "catchup") s.scan.exclude(Set(k)) else s.scan,
      label: "startFetch", target: k }
  }
  action lookup(k: int): bool = startFetch(k, "lookup")
  action page(k: int): bool = startFetch(k, "page")
  action finishFetch(f: Fetch): bool = {
    val absent = f.kind == "lookup" and s.row.get(f.key) == "unknown"
    val observed = if (f.found) writeMessage(f.key) else { ...s,
      row: if (absent) s.row.set(f.key, "queued") else s.row,
      due: if (absent) s.due.union(Set(f.key)) else s.due }
    all {
      s.fetches.contains(f),
      s' = { ...observed, fetches: s.fetches.exclude(Set(f)), label: "finishFetch", target: f.key }
    }
  }
  action failLookup(f: Fetch): bool = all {
    not(s.sealed), f.kind == "lookup", s.fetches.contains(f),
    s' = { ...s, fetches: s.fetches.exclude(Set(f)), label: "failLookup", target: f.key }
  }
  action retry(k: int): bool = all {
    not(s.sealed), s.row.get(k) == "failed",
    s' = { ...s, row: s.row.set(k, "queued"), due: s.due.union(Set(k)), label: "retry", target: k }
  }
  action discard(k: int): bool = all {
    not(s.sealed), s.row.get(k) == "failed",
    s' = { ...s, row: s.row.set(k, "gone"), discarded: s.discarded.union(Set(k)), label: "discard", target: k }
  }
  // Time until the next due attempt is abstracted to one worker transition.
  action wake(k: int): bool = all {
    Set("queued", "unknown").contains(s.row.get(k)), not(s.due.contains(k)),
    not(s.fetches.exists(f => f.key == k and f.kind == "lookup")),
    s' = { ...s, due: s.due.union(Set(k)), label: "wake", target: k }
  }

  action disconnect = all {
    not(s.sealed), s.connected,
    s' = { ...s, connected: false, events: Set(), scan: Set(), catchup: false, label: "disconnect" }
  }
  action goOffline = all {
    not(s.sealed), s.online,
    s' = { ...s, online: false, connected: false, events: Set(), scan: Set(), catchup: false, label: "goOffline" }
  }
  action goOnline = all { not(s.online), s' = { ...s, online: true, label: "goOnline" } }
  action reconnect = all {
    s.online, not(s.connected),
    s' = { ...s, connected: true, catchup: true, scan: s.created, label: "reconnect" }
  }
  // End of catch-up, after all its pages: flush every queued or unknown row.
  action catchUp = all {
    s.catchup, s.scan.size() == 0, not(s.fetches.exists(f => f.kind == "catchup")),
    s' = { ...s, catchup: false,
      due: s.due.union(drafts.filter(k => Set("queued", "unknown").contains(s.row.get(k)))), label: "catchUp" }
  }
  action seal = all { not(s.sealed), s' = { ...s, sealed: true, label: "seal" } }

  val atMostOnce = drafts.forall(k => s.server.get(k) <= 1)
  val noDoubleShow = drafts.forall(k => s.stored.contains(k) implies s.row.get(k) == "gone")
  val noSilentLoss = s.created.forall(k => s.row.get(k) == "gone" implies
    (s.stored.contains(k) or s.discarded.contains(k)))
  val quiet = s.online and s.connected and not(s.catchup) and s.scan.size() == 0 and
    s.events.size() == 0 and s.fetches.size() == 0 and drafts.forall(k =>
      s.request.get(k) == "idle" and Set("gone", "failed").contains(s.row.get(k)))
  val agreed = s.created.forall(k => s.discarded.contains(k) or
    (s.row.get(k) == "gone" and s.stored.contains(k) and s.server.get(k) == 1) or
    (s.row.get(k) == "failed" and not(s.stored.contains(k)) and s.server.get(k) == 0))
  val quietAgreement = (s.sealed and quiet) implies agreed
  val reachedAgreement = s.sealed and quiet and agreed
  val drainBound = remaining > 0 or reachedAgreement
  val invariants = atMostOnce and noDoubleShow and noSilentLoss and quietAgreement and drainBound

  action work = any {
    goOnline, reconnect, catchUp,
    { nondet k = drafts.oneOf(); nondet withEcho = Set(true, false).oneOf(); any {
      claim(k), accept(k, withEcho), answer(k), refused(k), lookup(k), wake(k),
      all { s.request.get(k) == "dropped", lost(k) }
    } },
    { nondet k = s.events.oneOf(); echo(k) },
    { nondet k = s.scan.oneOf(); startFetch(k, "catchup") },
    { nondet f = s.fetches.oneOf(); finishFetch(f) }
  }
  action progress = any { work, all { quiet, s' = { ...s, label: "idle" } } }
  action input = {
    nondet k = drafts.oneOf()
    nondet later = Set(true, false).oneOf()
    any {
      send(k), refuse(k, later), drop(k), lost(k), crash, retry(k), discard(k),
      page(k), disconnect, goOffline, seal,
      { nondet f = s.fetches.oneOf(); failLookup(f) }
    }
  }
  action tick(a: bool): bool = all {
    a, turn' = turn + 1,
    remaining' = if (s.sealed and not(quiet)) remaining - 1 else remaining
  }
  action step = tick(if (s.sealed) progress else any { input, progress })
  action simulationStep = all { not(reachedAgreement), step }

  // Directed schedules stop at agreement, so the runner can require a
  // completion witness. The broken schedules use the same actions and inputs.
  action blindRetryWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, false) else
    if (turn == 3) lostWith(1, guard) else
    if (turn == 4) wake(1) else
    if (turn == 5) (if (guard) lookup(1) else claim(1)) else
    if (turn == 6) (if (guard) { nondet f = s.fetches.oneOf(); finishFetch(f) } else accept(1, false)) else
    seal
  ) }
  action blindRetryStep = blindRetryWith(true)
  action blindRetryBugStep = blindRetryWith(false)

  action crashResendWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, false) else
    if (turn == 3) crashWith(Set(), guard) else
    if (turn == 4) wake(1) else
    if (turn == 5) (if (guard) lookup(1) else claim(1)) else
    if (turn == 6) (if (guard) { nondet f = s.fetches.oneOf(); finishFetch(f) } else accept(1, false)) else
    seal
  ) }
  action crashResendStep = crashResendWith(true)
  action crashResendBugStep = crashResendWith(false)

  action echoBeforeAnswerWith(deleteRow: bool, keepGone: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, true) else
    if (turn == 3) echoWith(1, deleteRow) else
    if (turn == 4) answerWith(1, keepGone) else
    seal
  ) }
  action echoKeepsRowStep = echoBeforeAnswerWith(true, true)
  action echoKeepsRowBugStep = echoBeforeAnswerWith(false, true)
  action answerAfterEchoStep = echoBeforeAnswerWith(true, true)
  action answerAfterEchoBugStep = echoBeforeAnswerWith(true, false)

  action answerBeforeEchoStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, true) else
    if (turn == 3) answer(1) else
    if (turn == 4) echo(1) else
    seal
  ) }
  action lostLookupAbsentStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) drop(1) else
    if (turn == 3) lost(1) else
    if (turn == 4) wake(1) else
    if (turn == 5) lookup(1) else
    if (turn == 6) { nondet f = s.fetches.oneOf(); finishFetch(f) } else
    if (turn == 7) claim(1) else
    if (turn == 8) accept(1, false) else
    if (turn == 9) answer(1) else
    seal
  ) }
  action reconnectPageStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, true) else
    if (turn == 3) lost(1) else
    if (turn == 4) disconnect else
    if (turn == 5) reconnect else
    if (turn == 6) wake(1) else
    if (turn == 7) lookup(1) else
    if (turn == 8) startFetch(1, "catchup") else
    if (turn == 9) { nondet f = s.fetches.filter(f => f.kind == "catchup").oneOf(); finishFetch(f) } else
    if (turn == 10) catchUp else
    if (turn == 11) { nondet f = s.fetches.oneOf(); finishFetch(f) } else
    seal
  ) }
}

module outbox {
  import outboxProtocol(drafts = Set(1, 2), fetchLimit = 2, drainLimit = 48).*
}
