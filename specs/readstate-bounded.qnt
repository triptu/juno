// One live Main topic, one event and one fetch. Use the real read rules.
// Scan recovery and stealth remain covered by the full simulator: Apalache
// 0.62.1 fails while translating the broader read step (key not found: $C$7).
module readstate_bounded {
  import mirror(followMode = false, initial = 2, mirrored = Set(1),
    topics = Set(1), eventLimit = 1, fetchLimit = 1).* from "./mirror"
  action init = timedInit
  action step = tick({
    nondet value = Set(0, 1, 2).oneOf()
    any {
      localChange(1, 2, false), localChange(1, 0, true),
      serverChange(1, value, "officialMark"), retry(1), reject(1),
      startFetch(1, "background"), accept(1), acknowledge(1),
      { nondet e = s.events.oneOf(); deliver(e, true) },
      { nondet f = s.fetches.oneOf(); finishFetch(f, true) }
    }
  })
  val boundedSafety = pendingIntentWins and localUnreadProtected and acceptedUnreadProtected
}
