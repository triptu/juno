// The outbox protocol scheduled the way Juno runs it, for the conformance
// harness (packages/engine/test/conformance). Every step is an action of
// `outboxProtocol`, so every trace here is a trace of `outbox.qnt`, and
// `invariants` is checked on it. The schedules are narrowed in three ways.
//
// Juno's own steps go first. A step that needs nothing from Slack, the
// network or the user (a claim, a backoff ending, a lookup leaving, an
// action call leaving, a check that keeps a copy, the catch-up after a
// reconnect) is taken before any other step while one is enabled, as the
// engine takes it at once or after a timer. The harness cannot hold the
// engine back from these, so it waits for them instead.
//
// Juno's scheduling, which `outbox.qnt` leaves out (README, "Conformance"):
//
// - One Slack write at a time. Posts, edits, deletes and reactions share
//   the client's `send` lane, which runs one call at a time. `lane` lists
//   the calls that left their worker; only the first is at Slack, and the
//   others wait. The lane is not first come, first served: when a call
//   ends, the same worker's next call, if it follows at once, goes before a
//   call that was already waiting (`freed` names that worker until the next
//   step of the world or a timer).
// - Each worker settles one row at a time. The post worker waits for its
//   post or lookup before it claims or looks up another; the action worker
//   waits for its call before it runs, checks or drops another row.
// - The post worker takes due rows in the order they were sent
//   (`firstSent`: the draft sent first).
// - An action call that failed goes again after a backoff, so it is a
//   timed step and other calls can take the lane meanwhile (`retrying`).
// - A channel's action rows go in order. The user's change waits behind a
//   copy's delete queued before it, and the other way round (`actFirst`:
//   drafts whose own pending row came first).
//
// Differences the replay found are kept out of the schedules, so the
// random traces check the rest; each has a directed engine test
// (README, "Conformance", "Differences found"):
//
// - The user's delete of a message whose copy's delete waits brings the
//   copy back: the check before that delete finds the kept message
//   deleted and makes the copy the message. No user delete comes while a
//   copy Juno does not show is in Slack.
// - A reply to a copy Juno has not stored, made while the socket is down,
//   reaches the store with the copy itself, before the catch-up's recheck
//   finds the kept message deleted, so the copy is kept for the reply and
//   does not become the message. Replies to an unseen copy come only while
//   the socket is up here.
//
// - The post worker checks the socket once per pass, not per row: after a
//   lookup or post that outlasts a drop, it still claims the next queued
//   post. No drop comes while the post worker is busy and another post
//   waits.
//
// The model's pending edit or delete follows `kept` to the copy when the
// kept message is deleted elsewhere; the engine's targets the message the
// user acted on. No such deletion comes while the user's change waits.
//
// The user acts only on a message Juno shows: not on one deleted on
// another device (the model allows it; the engine answers NotFound).
// Two workers waking at the same reconnect race for the lane, and a due
// lookup races the catch-up, so no reconnect comes while both a post and an
// action wait, or while a post is unknown (except the start after a crash).
//
// Only steps the harness can drive are taken. Left out: `page`,
// `uploadFail` and `failLookup`, the catch-up deadline (`keepCopy` before
// the catch-up ends), a crash while the socket is up (the engine's restart
// also reads history, which `crash` does not), and user input while the
// app is closed after a crash.
//
// `copyFrame` lists the posts whose network copy has an echo waiting in
// the fake, so the harness can deliver it; `closed` is true from a crash to
// the next start; `by` says whether a step was Juno's own or the world's.
module outbox_conformance {
  // Room for a lookup and a catch-up page per draft, so the bound on
  // fetches, which the engine does not have, never holds a page back.
  import outboxProtocol(drafts = Set(1, 2), fetchLimit = 4, drainLimit = 48).* from "./outbox"

  var lane: List[str]
  var actFirst: Set[int]
  var copyFrame: Set[int]
  var closed: bool
  var by: str
  var freed: str
  var firstSent: int
  var retrying: Set[int]

  action conformanceInit = all { init, lane' = List(), actFirst' = Set(), copyFrame' = Set(), closed' = false, by' = "init", freed' = "", firstSent' = 0, retrying' = Set() }

  pure def postCall(k: int): str = if (k == 1) "post1" else "post2"
  pure def actCall(k: int): str = if (k == 1) "act1" else "act2"
  def without(call: str): List[str] = lane.select(c => c != call)
  def atSlack(call: str): bool = lane.length() > 0 and lane.head() == call
  // A call joins the lane at the back, or at the front when its worker's last call just ended.
  def join(call: str, worker: str): List[str] = if (freed == worker) List(call).concat(lane) else lane.append(call)

  def posting(k: int): bool = Set("transit", "accepted", "refused", "later", "dropped").contains(s.request.get(k))
  def hasLookup(k: int): bool = s.fetches.exists(f => f.key == k and f.kind == "lookup")
  val postWorkerFree = drafts.forall(j => not(posting(j)) and not(hasLookup(j)))
  val actionWorkerFree = drafts.forall(j => not(actInFlight(j)))
  // The post worker's next row: due rows go in send order.
  def postDue(j: int): bool = (s.row.get(j) == "queued" and s.due.contains(j)) or (s.row.get(j) == "unknown" and s.due.contains(j) and not(hasLookup(j)))
  def postTurn(k: int): bool = drafts.forall(j => j == k or firstSent != j or not(postDue(j)))
  // A message the user sees: a pending post, or a stored message not deleted elsewhere.
  def shown(k: int): bool = not(s.stored.contains(k)) or not(s.seen.contains({ key: k, what: "gone" })) or s.kept.get(k) == "copy" or
    Set("kept", "shown").contains(s.copyRow.get(k))
  // The copy's delete row waits behind the user's earlier row, or the other way round.
  def copyHeld(k: int): bool = actPending(k) and actFirst.contains(k)
  def actHeld(k: int): bool = s.copyRow.get(k) == "hidden" and not(actFirst.contains(k))

  // The guards of Juno's own steps, as the actions below state them, with Juno's scheduling.
  def canClaim(k: int): bool = postWorkerFree and postTurn(k) and s.online and s.connected and s.row.get(k) == "queued" and s.due.contains(k) and s.request.get(k) == "idle"
  def canWake(k: int): bool = Set("queued", "unknown").contains(s.row.get(k)) and not(s.due.contains(k)) and not(hasLookup(k))
  // After a reconnect the catch-up stores what it finds before a lookup goes.
  def canLookup(k: int): bool = postWorkerFree and postTurn(k) and not(s.catchup) and s.online and s.created.contains(k) and s.fetches.size() < fetchLimit and s.connected and
    s.row.get(k) == "unknown" and s.due.contains(k)
  def canRetryAction(k: int): bool = actionWorkerFree and not(actHeld(k)) and s.online and s.connected and s.act.get(k) == "waiting" and s.stored.contains(k)
  def canRunAction(k: int): bool = canRetryAction(k) and not(retrying.contains(k))
  // The action worker runs only while the socket is up, also for rows it ends with no call.
  def canDropAction(k: int): bool = actionWorkerFree and s.online and s.connected and s.act.get(k) == "waiting" and not(s.stored.contains(k)) and Set("failed", "gone").contains(s.row.get(k))
  // The check before a copy's delete finds a reason to keep it: at once
  // when a reply is stored on the copy, else at the worker's next try. Only
  // after the catch-up: the engine waits up to two minutes for it.
  def canKeepNow(k: int): bool = s.online and s.connected and s.copyRow.get(k) == "hidden" and s.inStep and s.seen.contains({ key: k, what: "reply" })
  def canKeepLater(k: int): bool = s.online and s.connected and s.copyRow.get(k) == "hidden" and s.inStep and
    actionWorkerFree and not(copyHeld(k)) and (keepReasonSeen(k) or unchecked(k))
  // Juno stores a copy it has not seen when the catch-up reads the post's
  // channel, or when a reply to the copy makes it fetch the thread's root.
  def canSeeCopy(k: int): bool = s.connected and s.stored.contains(k) and copyUnseen(k) and
    (s.catchup or s.seen.contains({ key: k, what: "reply" }))
  def canPage(k: int): bool = s.online and s.created.contains(k) and s.fetches.size() < fetchLimit and s.scan.contains(k)
  val canCatchUp = s.catchup and s.scan.size() == 0 and not(s.fetches.exists(f => f.kind == "catchup")) and not(drafts.exists(k => canSeeCopy(k)))
  // Juno's steps that wait for nothing, and those that wait for a timer
  // (a backoff, the 2 s before a lookup, the next try of a copy's delete).
  // The engine takes the first kind before a timer fires.
  val junoNow = canCatchUp or s.fetches.exists(f => f.kind == "catchup") or drafts.exists(k =>
    canClaim(k) or canLookup(k) or s.request.get(k) == "dropped" or canRunAction(k) or canDropAction(k) or
    canKeepNow(k) or canSeeCopy(k) or canPage(k))
  val junoLater = drafts.exists(k => canWake(k) or canKeepLater(k) or (retrying.contains(k) and canRetryAction(k)))

  action auxAll(step: str, l: List[str], a: Set[int], c: Set[int], d: bool, f: str, first: int, r: Set[int]): bool = all {
    by' = step, lane' = l, actFirst' = a, copyFrame' = c, closed' = d, freed' = f, firstSent' = first, retrying' = r
  }
  // No drop while the post worker is busy and another post waits (the per-pass socket check).
  // Nor while a call waits for the lane: whether it left its worker before the drop is not observable.
  val dropSafe = lane.length() <= 1 and (postWorkerFree or drafts.forall(j => not(Set("queued", "unknown").contains(s.row.get(j))) or posting(j) or hasLookup(j)))
  action aux(step: str, l: List[str], a: Set[int], c: Set[int], d: bool, f: str): bool = auxAll(step, l, a, c, d, f, firstSent, retrying)
  action juno(l: List[str], a: Set[int], c: Set[int]): bool = aux("juno", l, a, c, closed, freed)
  action timed(l: List[str], a: Set[int], c: Set[int]): bool = aux("juno", l, a, c, closed, "")
  action world(l: List[str], a: Set[int], c: Set[int], d: bool): bool = aux("world", l, a, c, d, "")
  // A world step that ends a call at Slack.
  action ended(worker: str, l: List[str], a: Set[int]): bool = aux("world", l, a, copyFrame, closed, worker)
  action same = world(lane, actFirst, copyFrame, closed)

  action timedStep = {
    nondet k = drafts.oneOf()
    any {
      all { canWake(k), wake(k), timed(lane, actFirst, copyFrame) },
      all { canKeepLater(k), keepCopy(k), timed(lane, actFirst, copyFrame) },
      all { retrying.contains(k), canRetryAction(k), runAction(k),
        auxAll("juno", lane.append(actCall(k)), actFirst, copyFrame, closed, "", firstSent, retrying.exclude(Set(k))) }
    }
  }

  action junoStep = any {
    { nondet k = drafts.oneOf(); any {
      all { canClaim(k), claim(k), juno(join(postCall(k), "post"), actFirst, copyFrame) },
      all { canLookup(k), lookup(k), juno(lane, actFirst, copyFrame) },
      all { s.request.get(k) == "dropped", lost(k), aux("juno", without(postCall(k)), actFirst, copyFrame, closed, "post") },
      all { canRunAction(k), runAction(k), juno(join(actCall(k), "act"), actFirst, copyFrame) },
      all { canDropAction(k), dropAction(k), juno(lane, actFirst.exclude(Set(k)), copyFrame) },
      all { canKeepNow(k), keepCopy(k), juno(lane, actFirst, copyFrame) },
      all { canSeeCopy(k), observeCopy(k), juno(lane, actFirst, copyFrame.exclude(Set(k))) },
      all { canPage(k), startFetch(k, "catchup"), juno(lane, actFirst, copyFrame) }
    } },
    { nondet f = s.fetches.filter(f => f.kind == "catchup").oneOf(); all { finishFetch(f), juno(lane, actFirst, copyFrame) } },
    all { canCatchUp, catchUp, juno(lane, actFirst, copyFrame) }
  }

  // What Slack, the network, the user and other clients do. Slack decides
  // only the call at the front of the lane. Juno's echo of a network copy
  // is delivered only while it waits in the fake.
  action worldStep = {
    nondet k = drafts.oneOf()
    nondet later = Set(true, false).oneOf()
    nondet withEcho = Set(true, false).oneOf()
    nondet kind = Set("change", "delete").oneOf()
    // Drops, crashes and the seal are picked a quarter as often, so a short
    // trace reaches copies and changes from other clients.
    nondet rare = 0.to(3).oneOf()
    val open = not(closed)
    // A new row, or a delete that replaces a change, goes after a copy's delete queued before it.
    val first = if (kind == "delete" or not(actPending(k))) (if (s.copyRow.get(k) == "hidden") actFirst.exclude(Set(k)) else actFirst.union(Set(k))) else actFirst
    val atPost = atSlack(postCall(k))
    val atAct = atSlack(actCall(k))
    any {
      all { open, send(k), auxAll("world", lane, actFirst, copyFrame, closed, "", if (firstSent == 0) k else firstSent, retrying) }, all { open, retry(k), same }, all { open, discard(k), same },
      all { open, shown(k),
        not(kind == "delete" and copyInSlack(k) and s.copyRow.get(k) != "kept"), queueAction(k, kind), world(lane, first, copyFrame, closed) },
      all { atPost, accept(k, withEcho), same }, all { atPost, refuse(k, later), same }, all { atPost, drop(k), same },
      all { Set("accepted", "refused", "later").contains(s.request.get(k)), lost(k), ended("post", without(postCall(k)), actFirst) },
      all { answer(k), ended("post", without(postCall(k)), actFirst) },
      all { refused(k), ended("post", without(postCall(k)), actFirst) },
      all { resend(k), world(lane, actFirst, if (s.connected) copyFrame.union(Set(k)) else copyFrame, closed) },
      all { s.events.contains(k), echo(k), same },
      all { copyFrame.contains(k), observeCopy(k), world(lane, actFirst, copyFrame.exclude(Set(k)), closed) },
      all { actionWorkerFree, lane.length() == 0, not(copyHeld(k)), deleteCopy(k), same },
      all { not(actPending(k)), remoteChange(k, "gone"), same }, all { s.connected or not(copyUnseen(k)), remoteChange(k, "reply"), same },
      all { atAct, actAccept(k), same },
      all { actAnswer(k), ended("act", without(actCall(k)), if (s.stale.contains(k)) actFirst else actFirst.exclude(Set(k))) },
      // A lost answer to an edit that changed meanwhile: the client sends the old text again first (README).
      all { atAct, s.act.get(k) == "transit" or not(s.stale.contains(k)), actFail(k),
        auxAll("world", without(actCall(k)), actFirst, copyFrame, closed, "act", firstSent, retrying.union(Set(k))) },
      all { atAct, actRefuse(k), ended("act", without(actCall(k)), actFirst.exclude(Set(k))) },
      { nondet f = s.fetches.filter(f => f.kind == "lookup").oneOf(); all { finishFetch(f), same } },
      all { rare == 0, dropSafe, disconnect, world(lane, actFirst, Set(), closed) },
      // Calls waiting for the lane fail when HTTP goes; the model keeps them in transit.
      all { rare == 0, dropSafe, s.connected, lane.length() <= 1, goOffline, world(lane, actFirst, Set(), closed) },
      all { goOnline, same },
      // A lookup that is due races the catch-up after a reconnect, so none is due then.
      all { not(drafts.exists(j => s.row.get(j) == "queued") and drafts.exists(j => s.act.get(j) == "waiting")),
        closed or drafts.forall(j => s.row.get(j) != "unknown"), reconnect, world(lane, actFirst, copyFrame, false) },
      all { rare == 0, open, not(s.connected), crash, auxAll("world", List(), actFirst, Set(), true, "", firstSent, Set()) },
      all { rare == 0, open, seal, same },
      all { quiet, s' = { ...s, label: "idle" }, same }
    }
  }

  action conformanceStep = all { not(reachedAgreement), if (junoNow) tick(junoStep) else if (junoLater) tick(timedStep) else tick(worldStep) }

  // The same, from a post the network sent twice: Slack holds it and its
  // copy, Juno stored the first, and the copy's echo waits (`copySetup`).
  action copyStep =
    if (copyHidden(turn)) all {
      not(reachedAgreement),
      tick(all {
        copySetup,
        aux(if (turn == 1) "juno" else "world", if (turn == 1) List("post1") else if (turn == 4) List() else lane, actFirst,
          if (turn == 3) Set(1) else copyFrame, closed, if (turn == 4) "post" else "")
      })
    } else conformanceStep
}
