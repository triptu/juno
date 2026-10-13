// Small instance for exhaustive bounded checking: one mirrored Main topic,
// one queued event and one HTTP response, with the real read rules. The
// reconnect refresh, stealth and the local-only thread are covered by the
// simulator.
module readstate_bounded {
  import readProtocol(topics = Set(1), mirrored = Set(1), eventLimit = 1, fetchLimit = 1, drainLimit = 48).* from "./readstate"
  action boundedStep = tick({
    nondet value = Set(0, 1, 2).oneOf()
    nondet echo = Set(true, false).oneOf()
    any {
      markRead(1, value), markUnread(1, if (value == 2) 1 else value), officialMark(1, value),
      accept(1, echo), respond(1), retry(1), reject(1), startFetch(1, "page"),
      { nondet k = s.refresh.oneOf(); startFetch(k, "lookup") },
      { nondet e = s.events.oneOf(); deliver(e) },
      { nondet f = s.fetches.oneOf(); finishFetch(f, true) }
    }
  })
  // Local safety only. Convergence needs the longer simulator drain.
  val boundedSafety = pendingIntentWins and localUnreadProtected and acceptedMarkKept and acceptedUnreadProtected
}
