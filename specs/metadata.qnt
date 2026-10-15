// Conversation columns: 1 = name version, 2 = membership, 3 = archive flag.
// Socket application and its observation are atomic with the store write.
// Reads are serialized by the sync work permit (the same ordering M7 needs
// for older pages). HTTP snapshots survive socket drops. No server clock
// is compared with a local clock: each read records the columns touched since
// it began. Boot and counts are separate reads with the same rule.
module metadata {
  val columns = Set(1, 2, 3)
  var server: int -> int
  var local: int -> int
  var page: int -> int
  var observed: Set[int]
  var eventValue: int -> int
  var inFlight: bool
  var connected: bool
  var due: bool
  var sealed: bool
  var turn: int
  var remaining: int

  action init = all {
    server' = columns.mapBy(_ => 0), local' = columns.mapBy(_ => 0),
    page' = columns.mapBy(_ => 0), eventValue' = columns.mapBy(_ => 0),
    observed' = Set(), inFlight' = false, connected' = true,
    due' = false, sealed' = false, turn' = 0, remaining' = 16
  }
  action change(f: int): bool = all {
    not(sealed),
    server' = server.set(f, 1 - server.get(f)),
    local' = if (connected) local.set(f, 1 - server.get(f)) else local,
    observed' = if (connected and inFlight) observed.union(Set(f)) else observed,
    eventValue' = if (connected) eventValue.set(f, 1 - server.get(f)) else eventValue,
    page' = page, inFlight' = inFlight, connected' = connected, due' = due, sealed' = sealed
  }
  action request = all {
    connected, not(inFlight),
    page' = server, observed' = Set(), inFlight' = true, due' = false,
    server' = server, local' = local, eventValue' = eventValue, connected' = connected, sealed' = sealed
  }
  action finishWith(fence: bool): bool = all {
    inFlight,
    local' = columns.mapBy(f => if (fence and observed.contains(f)) local.get(f) else page.get(f)),
    inFlight' = false, server' = server, page' = page, observed' = observed,
    eventValue' = eventValue, connected' = connected, due' = due, sealed' = sealed
  }
  action disconnect = all {
    connected, not(sealed), connected' = false,
    server' = server, local' = local, page' = page, observed' = observed,
    eventValue' = eventValue, inFlight' = inFlight, due' = due, sealed' = sealed
  }
  action reconnectWith(refresh: bool): bool = all {
    not(connected), connected' = true, due' = refresh,
    server' = server, local' = local, page' = page, observed' = observed,
    eventValue' = eventValue, inFlight' = inFlight, sealed' = sealed
  }
  action seal = all {
    not(sealed), sealed' = true,
    server' = server, local' = local, page' = page, observed' = observed,
    eventValue' = eventValue, inFlight' = inFlight, connected' = connected, due' = due
  }
  val eventWins = observed.forall(f => local.get(f) == eventValue.get(f))
  val quiet = connected and not(inFlight) and not(due)
  val quietAgreement = (sealed and quiet) implies local == server
  val reachedAgreement = sealed and quiet and local == server
  val invariants = eventWins and quietAgreement and (remaining > 0 or reachedAgreement)
  action progress = any { reconnectWith(true), all { due, request }, finishWith(true) }
  action tick(a: bool): bool = all {
    a, turn' = turn + 1, remaining' = if (sealed) remaining - 1 else remaining
  }
  action simulationStep = all {
    not(reachedAgreement),
    tick(if (sealed) progress else any {
      { nondet f = columns.oneOf(); change(f) }, request, finishWith(true),
      disconnect, reconnectWith(true), seal
    })
  }
  action staleWith(f: int, fence: bool): bool = all {
    not(reachedAgreement), tick(
      if (turn == 0) request else
      if (turn == 1) change(f) else
      if (turn == 2) finishWith(fence) else seal
    )
  }
  action staleRenameStep = staleWith(1, true)
  action staleRenameBugStep = staleWith(1, false)
  action staleMembershipStep = staleWith(2, true)
  action staleMembershipBugStep = staleWith(2, false)
  action staleArchiveStep = staleWith(3, true)
  action staleArchiveBugStep = staleWith(3, false)
  action missedRenameWith(refresh: bool): bool = all {
    not(reachedAgreement), tick(
      if (sealed) progress else
      if (turn == 0) disconnect else
      if (turn == 1) change(1) else
      if (turn == 2) reconnectWith(refresh) else seal
    )
  }
  action missedRenameStep = missedRenameWith(true)
  action missedRenameBugStep = missedRenameWith(false)
}
