// Windowed history: each conversation has an activity age and pages covering
// successive days. The worker serializes with boot/catch-up, uses only the
// background lane, and commits each page with its coverage. Cached days are
// never deleted. The drain assumes connectivity and successful responses.
module quietWindowProtocol {
  const conversations: Set[int]
  const activityAge: int -> int
  const initialDays: int
  const raisedDays: int
  var s: { days: int, covered: int -> int, pending: Set[int], calls: int,
    priorCalls: int, priorCovered: int -> int, sealed: bool, raised: bool, label: str }

  def active(days: int): Set[int] = conversations.filter(c => activityAge.get(c) <= days)
  def missing(days: int): Set[int] = active(days).filter(c => s.covered.get(c) < days)
  action init = s' = { days: initialDays,
    covered: conversations.mapBy(c => if (active(initialDays).contains(c)) initialDays else 0),
    pending: Set(), calls: 0, priorCalls: 0, priorCovered: conversations.mapBy(_ => 0),
    sealed: false, raised: false, label: "init" }

  action choose(days: int): bool = all {
    not(s.sealed),
    s' = { ...s, days: days,
      pending: if (days > s.days) missing(days) else Set(),
      priorCalls: s.calls, priorCovered: s.covered,
      raised: s.raised or days > s.days,
      label: if (days > s.days) "raise" else "lower" }
  }
  action page = {
    nondet c = s.pending.oneOf()
    val coveredThrough = s.covered.get(c) + 1
    s' = { ...s, covered: s.covered.set(c, coveredThrough), calls: s.calls + 1,
      pending: if (coveredThrough >= s.days) s.pending.exclude(Set(c)) else s.pending,
      label: "backgroundPage" }
  }
  action seal = all { not(s.sealed), s' = { ...s, sealed: true, label: "seal" } }
  val reachedAgreement = s.sealed and s.pending.size() == 0 and missing(s.days).size() == 0
  val loweringDoesNoWork = s.label == "lower" implies s.calls == s.priorCalls and s.covered == s.priorCovered
  val completedCoverage = (s.sealed and s.pending.size() == 0) implies missing(s.days).size() == 0
  val invariants = loweringDoesNoWork and completedCoverage
  action simulationStep = all {
    not(reachedAgreement),
    if (s.sealed) page else any {
      page, choose(1), choose(3), choose(7), choose(14),
      all { missing(s.days).size() == 0 or s.pending == missing(s.days), seal }
    }
  }
  // A running 3-day session widens to 14. Every newly eligible conversation
  // must be covered by actual page steps before the run can finish.
  action raiseMidSessionStep = all {
    not(reachedAgreement),
    if (s.label == "init") choose(raisedDays) else
    if (s.label == "raise") seal else page
  }
}
module quietwindow {
  import quietWindowProtocol(conversations = Set(1, 2, 3), activityAge = Map(1 -> 2, 2 -> 5, 3 -> 10),
    initialDays = 3, raisedDays = 14).*
}
