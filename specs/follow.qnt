// Follow state for three threads. 0 means unfollowed. 1 means followed.
// Assumptions: change stamps share an order with fetch start times. A local
// generation changes on every command. An undated event needs a fresh lookup.
// One command per thread is pending, matching the current command seam.
// getView omits unfollowed threads. Catch-up pages to the end and then checks
// roots of cached follows absent from the list. It never infers false from a
// partial page. Thread order is fixed here. A moving real cursor needs another
// complete pass once quiet. Reply auto-follow is an authoritative server write.
module follow {
  import mirror(followMode = true, initial = 1, mirrored = Set(1, 2, 3)).* from "./mirror"

  action init = timedInit
  action subscribe(k: int): bool = localChange(k, 1, false)
  action unsubscribe(k: int): bool = localChange(k, 0, false)
  action reply(k: int): bool = serverChange(k, 1, "reply")
  action officialFollow(k: int, value: int): bool = serverChange(k, value, "officialFollow")

  action threadMarked(k: int): bool = serverChange(k, s.server.get(k), "threadMarked")

  action input = {
    nondet k = topics.oneOf()
    nondet value = Set(0, 1).oneOf()
    any {
      subscribe(k), unsubscribe(k), reply(k), officialFollow(k, value), threadMarked(k),
      retry(k), reject(k), disconnect, seal,
      all { s.phase == "idle", startFetch(k, "view") },
      all { s.phase == "idle", startFetch(k, "root") }
    }
  }

  action stepWith(fetchGuard: bool, eventGuard: bool, singlePage: bool, recoverAbsent: bool): bool = tick(
    if (s.sealed) progress(fetchGuard, eventGuard, singlePage, recoverAbsent)
    else any { input, progress(fetchGuard, eventGuard, singlePage, recoverAbsent) }
  )
  action step = stepWith(true, true, false, true)
  action simulationStep = all { not(s.sealed and quiet), step }
  action bugFetchStep = stepWith(false, true, false, true)
  action bugEventStep = stepWith(true, false, false, true)
  action bugPagingStep = stepWith(true, true, true, true)
  action bugAbsentStep = stepWith(true, true, false, false)

  val invariants = safety and drainBound

  // A deterministic regression schedule changes only the fetch guard.
  action stalePage(guard: bool): bool = tick(
    if (s.label == "init") startFetch(1, "view") else
    if (s.label == "startFetch") unsubscribe(1) else
    if (s.label == "localChange") accept(1) else
    if (s.label == "accept") acknowledge(1) else
    if (s.label == "acknowledge") { nondet f = s.fetches.oneOf(); finishFetch(f, guard) } else
    progress(guard, true, false, true)
  )
  action stalePageStep = stalePage(true)
  action stalePageBugStep = stalePage(false)

  // Changes to thread three happen while offline, beyond the first page.
  action missedUnfollow(recoverAbsent: bool): bool = tick(
    if (s.label == "init") disconnect else
    if (s.label == "disconnect") officialFollow(3, 0) else
    if (s.label == "officialFollow") seal else
    progress(true, true, false, recoverAbsent)
  )
  action missedUnfollowStep = missedUnfollow(true)
  action missedUnfollowBugStep = missedUnfollow(false)

  action missedFollow(singlePage: bool): bool = tick(
    if (s.label == "init") unsubscribe(3) else
    if (s.label == "localChange") accept(3) else
    if (s.label == "accept") acknowledge(3) else
    if (s.label == "acknowledge") disconnect else
    if (s.label == "disconnect") officialFollow(3, 1) else
    if (s.label == "officialFollow") seal else
    progress(true, true, singlePage, true)
  )
  action missedFollowStep = missedFollow(false)
  action missedFollowBugStep = missedFollow(true)
}
