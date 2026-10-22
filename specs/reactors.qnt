// One message's full reactor lookup. The stored snapshot is the reaction
// rows plus the message version; HTTP responses cannot overwrite a change
// observed while they were in flight. Partial pages replace old membership.
module reactors {
  var s: { server: Set[int], known: Set[int], count: int, version: int,
    pending: bool, answer: Set[int], beforeKnown: Set[int], beforeCount: int,
    beforeVersion: int, priorKnown: Set[int], priorCount: int,
    calls: int, priorCalls: int, label: str }
  var step: int
  action init = all {
    s' = { server: Set(1, 2, 3), known: Set(1, 2), count: 3, version: 0,
      pending: false, answer: Set(), beforeKnown: Set(), beforeCount: 0,
      beforeVersion: 0, priorKnown: Set(), priorCount: 0,
      calls: 0, priorCalls: 0, label: "init" },
    step' = 0,
  }
  action request = {
    if (s.pending) s' = { ...s, priorCalls: s.calls, label: "join" }
    else all {
      s.known.size() < s.count,
      s' = { ...s, pending: true, answer: s.server, beforeKnown: s.known,
        beforeCount: s.count, beforeVersion: s.version, calls: s.calls + 1,
        label: "request" }
    }
  }
  action finishWith(guard: bool): bool = {
    val unchanged = s.known == s.beforeKnown and s.count == s.beforeCount and s.version == s.beforeVersion
    all {
      s.pending,
      s' = { ...s, pending: false,
        known: if (unchanged or not(guard)) s.answer else s.known,
        count: if (unchanged or not(guard)) s.answer.size() else s.count,
        priorKnown: s.known, priorCount: s.count,
        label: if (unchanged) "stored" else "superseded" }
    }
  }
  action finish = finishWith(true)
  // A delivered reaction updates the existing full list as well as a partial one.
  action add = all {
    not(s.server.contains(4)),
    s' = { ...s, server: s.server.union(Set(4)), known: s.known.union(Set(4)),
      count: s.count + 1, version: s.version + 1, label: "add" }
  }
  action remove = all {
    s.server.contains(1), s.known.contains(1),
    s' = { ...s, server: s.server.exclude(Set(1)), known: s.known.exclude(Set(1)),
      count: s.count - 1, version: s.version + 1, label: "remove" }
  }
  // A missed remove/add beyond the truncated list leaves its count unchanged.
  action swapUnseen = all {
    s.server.contains(3), not(s.server.contains(4)),
    s' = { ...s, server: s.server.exclude(Set(3)).union(Set(4)), label: "swap" }
  }
  action pageWith(keepOld: bool): bool = {
    val listed = s.server.filter(p => p <= 2)
    val keep = keepOld and s.count == s.server.size() and listed.subseteq(s.known)
    s' = { ...s, known: if (keep) s.known else listed, count: s.server.size(), label: "page" }
  }
  action page = pageWith(false)
  val preservesConcurrentWrite = s.label == "superseded" implies s.known == s.priorKnown and s.count == s.priorCount
  val pageDropsUnprovenNames = s.label == "page" implies s.known.subseteq(s.server)
  val sharedRequest = s.label == "join" implies s.calls == s.priorCalls
  val reachedAgreement = not(s.pending) and s.known == s.server
  val invariants = preservesConcurrentWrite and pageDropsUnprovenNames and sharedRequest
  action simulationStep = all {
    any { request, finish, add, remove, swapUnseen, page },
    step' = step + 1,
  }
  action racedWith(guard: bool): bool = all {
    if (step == 0 or step == 1) request else
    if (step == 2) add else
    if (step == 3) finishWith(guard) else
    if (step == 4) request else
    if (step == 5) finish else
    if (step == 6) remove else all { assert(s.known == s.server), s' = s },
    step' = step + 1,
  }
  action racedStep = racedWith(true)
  action racedBugStep = racedWith(false)
  action sameCountWith(keepOld: bool): bool = all {
    if (step == 0) request else
    if (step == 1) finish else
    if (step == 2) swapUnseen else
    if (step == 3) pageWith(keepOld) else
    if (step == 4) request else
    if (step == 5) finish else all { assert(s.known == s.server), s' = s },
    step' = step + 1,
  }
  action sameCountStep = sameCountWith(false)
  action sameCountBugStep = sameCountWith(true)
}
