// Messages changed while the socket was down: edits, deletes and reaction
// changes by other clients reach Juno through no event, and they do not move
// a conversation's `latest`. After a reconnect the catch-up reads the recent
// messages of the likely topics again (the recheck) and merges them by the
// rules of architecture 5.4. A message the recheck's page lacks is deleted,
// but only one the store held when the page was requested: a message stored
// later (its event raced the page) may be newer than Slack's answer. The
// recheck asks only once every fetch requested before it has landed, so no
// older answer can bring back what it found gone.
module catchupProtocol {
  const messages: Set[int]
  const fetchLimit: int
  const drainLimit: int

  // A page is Slack's state when it was requested. `requestedAt` is Juno's
  // request start on the shared stamp clock (the code compares Slack's event
  // ts with the request's ts in the same way). `known` is what the store held
  // at the request, for the recheck's deletions; other pages infer none.
  // A content version includes text, blocks, files and the message-owned bot
  // display name and icon. They follow the same edit ordering as other content;
  // omitted bot metadata preserves the stored value. User profiles are separate.
  type Page = { requestedAt: int, recheck: bool, present: Set[int], version: int -> int, react: int -> bool, known: Set[int] }
  type Event = { kind: str, key: int, stamp: int, version: int, react: bool }

  type State = {
    // Slack. A message is posted in ts order, so a later key is a later ts.
    posted: Set[int], sDeleted: Set[int], sVersion: int -> int, sReact: int -> bool,
    // Juno's store. `jStamp` is the message's `last_event_ts`.
    stored: Set[int], jDeleted: Set[int], jVersion: int -> int, jReact: int -> bool, jStamp: int -> int,
    events: Set[Event], pages: Set[Page], clock: int,
    connected: bool, recheckDue: bool, sealed: bool,
    label: str, target: int
  }
  var s: State
  var remaining: int
  var turn: int

  action init = all {
    s' = { posted: Set(), sDeleted: Set(), sVersion: messages.mapBy(_ => 0), sReact: messages.mapBy(_ => false),
      stored: Set(), jDeleted: Set(), jVersion: messages.mapBy(_ => 0), jReact: messages.mapBy(_ => false),
      jStamp: messages.mapBy(_ => 0),
      events: Set(), pages: Set(), clock: 1, connected: true, recheckDue: false, sealed: false,
      label: "init", target: 0 },
    remaining' = drainLimit, turn' = 0
  }

  def live(k: int): bool = s.posted.contains(k) and not(s.sDeleted.contains(k))
  def emit(e: Event): Set[Event] = if (s.connected) s.events.union(Set(e)) else s.events

  // Another client posts, edits, deletes or toggles a reaction. Each change
  // is stamped and sent as an event, which a dropped socket never delivers.
  action post(k: int): bool = all {
    not(s.sealed), not(s.posted.contains(k)), messages.forall(j => j < k implies s.posted.contains(j)),
    s' = { ...s, posted: s.posted.union(Set(k)), clock: s.clock + 1,
      events: emit({ kind: "post", key: k, stamp: s.clock, version: 0, react: false }),
      label: "post", target: k }
  }
  action edit(k: int): bool = all {
    not(s.sealed), live(k),
    s' = { ...s, sVersion: s.sVersion.set(k, s.sVersion.get(k) + 1), clock: s.clock + 1,
      events: emit({ kind: "edit", key: k, stamp: s.clock, version: s.sVersion.get(k) + 1, react: false }),
      label: "edit", target: k }
  }
  action remove(k: int): bool = all {
    not(s.sealed), live(k),
    s' = { ...s, sDeleted: s.sDeleted.union(Set(k)), clock: s.clock + 1,
      events: emit({ kind: "delete", key: k, stamp: s.clock, version: 0, react: false }),
      label: "remove", target: k }
  }
  action react(k: int): bool = all {
    not(s.sealed), live(k),
    s' = { ...s, sReact: s.sReact.set(k, not(s.sReact.get(k))), clock: s.clock + 1,
      events: emit({ kind: "react", key: k, stamp: s.clock, version: 0, react: not(s.sReact.get(k)) }),
      label: "react", target: k }
  }

  // Event application, as `events.ts` does it: a post stores the message, an
  // edit takes the newer version, a delete is a tombstone that always wins,
  // a reaction change applies and stamps `last_event_ts`.
  action deliver(e: Event): bool = {
    val k = e.key
    all {
      s.connected, s.events.contains(e),
      s' = { ...s, events: s.events.exclude(Set(e)),
        stored: s.stored.union(Set(k)),
        jVersion: s.jVersion.set(k, if (e.kind == "edit" and e.version > s.jVersion.get(k)) e.version else s.jVersion.get(k)),
        jDeleted: if (e.kind == "delete") s.jDeleted.union(Set(k)) else s.jDeleted,
        jReact: if (e.kind == "react" and e.stamp > s.jStamp.get(k)) s.jReact.set(k, e.react) else s.jReact,
        jStamp: if (e.kind == "react" and e.stamp > s.jStamp.get(k)) s.jStamp.set(k, e.stamp) else s.jStamp,
        label: "deliver", target: k }
    }
  }

  // Any fetch of the conversation's recent history: an opened topic, or the
  // recheck. HTTP answers survive a socket drop.
  def snapshot(recheck: bool): Page = { requestedAt: s.clock, recheck: recheck, present: s.posted.exclude(s.sDeleted),
    version: s.sVersion, react: s.sReact, known: if (recheck) s.stored else Set() }
  // With `waitGuard` the recheck waits until no other fetch is in flight
  // (an earlier recheck included: the code runs them one at a time); without
  // it, a fetch from before the drop can land after the recheck.
  action requestPageWith(recheck: bool, waitGuard: bool): bool = all {
    s.connected, s.pages.size() < fetchLimit, if (recheck) s.recheckDue else not(s.sealed),
    not(recheck and waitGuard) or s.pages.size() == 0,
    s' = { ...s, pages: s.pages.union(Set(snapshot(recheck))), clock: s.clock + 1,
      recheckDue: if (recheck) false else s.recheckDue, label: "requestPage", target: 0 }
  }
  action requestPage(recheck: bool): bool = requestPageWith(recheck, true)

  // The merge of a page (`applyPage`), then the deletions a recheck page
  // shows. With `knownGuard` only a message the store held at the request
  // can be missing; without it, a message posted after the request and
  // stored by its event before the page landed is deleted too. A page's
  // reactions apply only when no reaction event newer than the request was
  // applied.
  action finishPageWith(p: Page, knownGuard: bool): bool = {
    val missing = (if (knownGuard) p.known else if (p.known.size() > 0) s.stored else Set()).exclude(p.present)
    val reacts = p.present.filter(k => s.jStamp.get(k) < p.requestedAt)
    all {
      s.pages.contains(p),
      s' = { ...s, pages: s.pages.exclude(Set(p)),
        stored: s.stored.union(p.present),
        jVersion: messages.mapBy(k => if (p.present.contains(k) and p.version.get(k) > s.jVersion.get(k)) p.version.get(k) else s.jVersion.get(k)),
        jReact: messages.mapBy(k => if (reacts.contains(k)) p.react.get(k) else s.jReact.get(k)),
        jDeleted: s.jDeleted.union(missing),
        label: "finishPage", target: 0 }
    }
  }
  action finishPage(p: Page): bool = finishPageWith(p, true)

  action disconnect = all {
    not(s.sealed), s.connected,
    s' = { ...s, connected: false, events: Set(), label: "disconnect", target: 0 }
  }
  // The catch-up after `hello`. With `recheck` off it reads only what is
  // newer than the stored messages, which is the gap this protocol closes.
  action reconnectWith(recheck: bool): bool = all {
    not(s.connected),
    s' = { ...s, connected: true, recheckDue: recheck, label: "reconnect", target: 0 }
  }
  action reconnect = reconnectWith(true)
  action seal = all { not(s.sealed), s' = { ...s, sealed: true, label: "seal", target: 0 } }

  // Juno shows a message as deleted only when Slack deleted it.
  val noFalseDelete = s.jDeleted.subseteq(s.sDeleted)
  val quiet = s.connected and not(s.recheckDue) and s.events.size() == 0 and s.pages.size() == 0
  // Every message Juno holds agrees with Slack: deleted, or the same version
  // and reaction. A message posted and deleted while the socket was down may
  // never be stored.
  val agreed = s.posted.forall(k =>
    if (s.sDeleted.contains(k)) not(s.stored.contains(k)) or s.jDeleted.contains(k)
    else s.stored.contains(k) and not(s.jDeleted.contains(k)) and
      s.jVersion.get(k) == s.sVersion.get(k) and s.jReact.get(k) == s.sReact.get(k))
  val quietAgreement = (s.sealed and quiet) implies agreed
  val reachedAgreement = s.sealed and quiet and agreed
  val drainBound = remaining > 0 or reachedAgreement
  val invariants = noFalseDelete and quietAgreement and drainBound

  action work = any {
    reconnect, requestPage(true),
    { nondet e = s.events.oneOf(); deliver(e) },
    { nondet p = s.pages.oneOf(); finishPage(p) }
  }
  action progress = any { work, all { quiet, s' = { ...s, label: "idle", target: 0 } } }
  action input = {
    nondet k = messages.oneOf()
    any { post(k), edit(k), remove(k), react(k), requestPage(false), disconnect, seal }
  }
  action tick(a: bool): bool = all {
    a, turn' = turn + 1,
    remaining' = if (s.sealed and not(quiet)) remaining - 1 else remaining
  }
  action step = tick(if (s.sealed) progress else any { input, progress })
  action simulationStep = all { not(reachedAgreement), step }

  // The recheck's page is requested, a newer message is posted and its
  // event lands, then the page lands without it. The guard keeps the new
  // message; the bug deletes it.
  action newerThanPageWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) post(1) else
    if (turn == 1) { nondet e = s.events.oneOf(); deliver(e) } else
    if (turn == 2) disconnect else
    if (turn == 3) reconnect else
    if (turn == 4) requestPage(true) else
    if (turn == 5) post(2) else
    if (turn == 6) { nondet e = s.events.oneOf(); deliver(e) } else
    if (turn == 7) { nondet p = s.pages.oneOf(); finishPageWith(p, guard) } else
    seal
  ) }
  action newerThanPageStep = newerThanPageWith(true)
  action newerThanPageBugStep = newerThanPageWith(false)

  // An edit, a delete and a reaction while the socket is down. The recheck
  // brings all three; without it Juno keeps the old text, the deleted
  // message and the old reaction.
  action dropChangesWith(recheck: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) post(1) else
    if (turn == 1) post(2) else
    if (turn == 2) { nondet e = s.events.oneOf(); deliver(e) } else
    if (turn == 3) { nondet e = s.events.oneOf(); deliver(e) } else
    if (turn == 4) disconnect else
    if (turn == 5) edit(1) else
    if (turn == 6) react(1) else
    if (turn == 7) remove(2) else
    if (turn == 8) reconnectWith(recheck) else
    seal
  ) }
  action dropChangesStep = dropChangesWith(true)
  action dropChangesBugStep = dropChangesWith(false)

  // An opened topic's page is requested, then the socket drops and the
  // message is deleted. The guarded recheck waits for that page, so its
  // answer lands first and the recheck then finds the message gone. The bug
  // asks at once; the older page lands last and brings the message back.
  action olderPageWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) post(1) else
    if (turn == 1) requestPage(false) else
    if (turn == 2) disconnect else
    if (turn == 3) remove(1) else
    if (turn == 4) reconnect else
    if (turn == 5) (if (guard) { nondet p = s.pages.oneOf(); finishPage(p) } else requestPageWith(true, false)) else
    if (turn == 6) (if (guard) requestPage(true) else { nondet p = s.pages.filter(p => p.recheck).oneOf(); finishPage(p) }) else
    if (turn == 7) { nondet p = s.pages.oneOf(); finishPage(p) } else
    seal
  ) }
  action olderPageStep = olderPageWith(true)
  action olderPageBugStep = olderPageWith(false)
}

module catchup {
  import catchupProtocol(messages = Set(1, 2, 3), fetchLimit = 2, drainLimit = 32).*
}
