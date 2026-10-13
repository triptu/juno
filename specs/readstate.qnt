// Two Slack writers, with Main (1), a followed thread (2), and a local-only
// thread (3). Pointer 2 is the latest message. Pointer 0 marks unread.
// Assumptions: event stamps are change times, not read pointers. Pending local
// marks win. After acknowledgement, only newer server marks change the view.
// A fetch carries both its start time and the local generation at that time.
// The latest observation is retained while pending, so a newer official mark
// does not vanish before the acknowledgement. Stealth changes no read state.
// Reconnect refreshes every mirrored topic. Local-only topics do not converge
// with Slack. Marks on the same target are serialized; queued coalescing and
// changing channel/group watermarks are outside this model.
module readstate {
  import mirror(followMode = false, initial = 2, mirrored = Set(1, 2), topics = Set(1, 2, 3), eventLimit = 8, fetchLimit = 2).* from "./mirror"

  var stealthBefore: Set[int]
  var stealthReads: int -> int
  var stealthTraffic: (int, int)
  action init = all { timedInit, stealthBefore' = Set(), stealthReads' = topics.mapBy(_ => 2), stealthTraffic' = (0, 0) }
  action markRead(k: int): bool = localChange(k, 2, false)
  action markUnread(k: int): bool = localChange(k, 0, true)
  action officialMark(k: int, value: int): bool = serverChange(k, value, "officialMark")
  action stealth(k: int): bool = all {
    not(s.sealed), s' = { ...s, label: "stealth", target: k }
  }

  action input = {
    nondet k = topics.oneOf()
    nondet value = Set(0, 1, 2).oneOf()
    any {
      markRead(k), markUnread(k), officialMark(k, value), stealth(k),
      retry(k), reject(k), disconnect, seal,
      all { mirrored.contains(k), s.phase == "idle", startFetch(k, "background") }
    }
  }

  action readTick(a: bool): bool = all {
    tick(a), stealthBefore' = s.pending, stealthReads' = s.local, stealthTraffic' = (s.marksQueued, s.marksSent)
  }
  action stepWith(fetchGuard: bool, eventGuard: bool): bool = readTick(
    if (s.sealed) progress(fetchGuard, eventGuard, false, true)
    else any { input, progress(fetchGuard, eventGuard, false, true) }
  )
  action step = stepWith(true, true)
  action bugEventStep = stepWith(true, false)
  action simulationStep = all { not(s.sealed and quiet), step }
  action bugFetchStep = stepWith(false, true)

  val stealthNeverMarks = s.label != "stealth" or (s.pending == stealthBefore and s.local == stealthReads and
    (s.marksQueued, s.marksSent) == stealthTraffic)
  val invariants = safety and acceptedUnreadProtected and drainBound and stealthNeverMarks

  action lateMark(guard: bool): bool = readTick(
    if (s.label == "init") officialMark(1, 2) else
    if (s.label == "officialMark") markUnread(1) else
    if (s.label == "localChange") accept(1) else
    if (s.label == "accept") acknowledge(1) else
    if (s.label == "acknowledge") { nondet e = s.events.filter(e => e.at == 1).oneOf(); deliver(e, guard) } else
    progress(true, guard, false, true)
  )
  action lateMarkStep = lateMark(true)
  action lateMarkBugStep = lateMark(false)

  action latePage(guard: bool): bool = readTick(
    if (s.label == "init") startFetch(1, "background") else
    if (s.label == "startFetch") markUnread(1) else
    if (s.label == "localChange") accept(1) else
    if (s.label == "accept") acknowledge(1) else
    if (s.label == "acknowledge") { nondet f = s.fetches.oneOf(); finishFetch(f, guard) } else
    progress(guard, true, false, true)
  )
  action latePageStep = latePage(true)
  action latePageBugStep = latePage(false)

  // A newer official mark arrives while the local response is still in flight.
  action pendingMark(keep: bool): bool = readTick(
    if (s.label == "init") markUnread(1) else
    if (s.label == "localChange") accept(1) else
    if (s.label == "accept") officialMark(1, 2) else
    if (s.label == "officialMark") {
      nondet e = s.events.filter(e => e.at == 3).oneOf()
      if (keep) deliver(e, true) else dropPendingEvent(e)
    } else
    if (s.label == "deliver" and s.pending.contains(1)) acknowledge(1) else
    progress(true, true, false, true)
  )
  action pendingMarkStep = pendingMark(true)
  action pendingMarkBugStep = pendingMark(false)

  // Opening in stealth must not enqueue the ordinary open-and-mark command.
  action stealthBugStep = readTick(all {
    s.label == "init",
    s' = { ...s, local: s.local.set(1, 2), pending: Set(1), marksQueued: s.marksQueued + 1, label: "stealth", target: 1 }
  })
}
