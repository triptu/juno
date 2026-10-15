// A search page is partial. Root counters can avoid a lookup, but search
// must never erase reactions or decide follow state. A root missing from
// the page still needs the normal lookup. Counts abstract monotone maxima.
module discovery {
  var rootKnown: bool
  var counters: int
  var reactions: bool
  var followed: bool
  var calls: int
  var finished: bool
  var pageHadRoot: bool

  action init = all {
    rootKnown' = false, counters' = 0, reactions' = true,
    followed' = true, calls' = 0, finished' = false, pageHadRoot' = false,
  }
  action page(hasRoot: bool, repliesFirst: bool) = all {
    not(finished),
    // Apply the root before its reply, even when search returns newest first.
    rootKnown' = true,
    counters' = 2,
    calls' = if (hasRoot and not(repliesFirst)) calls else calls + 1,
    reactions' = reactions,
    followed' = followed,
    pageHadRoot' = hasRoot,
    finished' = true,
  }
  action idle = all {
    finished, rootKnown' = rootKnown, counters' = counters,
    reactions' = reactions, followed' = followed, calls' = calls,
    finished' = finished, pageHadRoot' = pageHadRoot,
  }
  action simulationStep = any { page(true, false), page(false, false), idle }
  action rootsFirstStep = if (finished) idle else page(true, false)
  action rootsFirstBugStep = if (finished) idle else page(true, true)
  val noRedundantLookup = not(pageHadRoot) or calls == 0
  val invariants = reactions and followed and noRedundantLookup and (finished implies rootKnown and counters == 2)
  val reachedAgreement = finished
}
