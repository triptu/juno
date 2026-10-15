// One persisted pending row per client_msg_id. Slack does not deduplicate
// requests in this model: each acceptance adds another message. The network
// can run an accepted post again (Chromium resends on a reused connection,
// ADR 0014); Juno deletes that copy.
module outboxProtocol {
  const drafts: Set[int]
  const fetchLimit: int
  const drainLimit: int
  type Fetch = { key: int, found: bool, kind: str }

  type State = {
    created: Set[int], row: int -> str, stored: Set[int], discarded: Set[int],
    server: int -> int, request: int -> str, due: Set[int],
    events: Set[int], fetches: Set[Fetch], scan: Set[int],
    online: bool, connected: bool, catchup: bool, sealed: bool,
    // A post claimed while Juno saw the socket down.
    claimedOffline: bool,
    label: str, target: int,
    // One action row per message (edit, delete or reaction toggle): none,
    // waiting, transit, accepted, done or dropped. Kind `change` stands for
    // an edit or a reaction toggle; `delete` replaces them. `stale` holds rows
    // whose intent changed while a call was out. `actSent` records every
    // action call that left Juno; `acted` every message Slack applied one to.
    act: int -> str, actKind: int -> str, stale: Set[int],
    actSent: Set[int], acted: Set[int],
    // Copies the network made of an accepted post (0 or 1) and copies Juno
    // deleted. `copyRow`: none, hidden (stored hidden, its delete row
    // waits), shown (the bug: listed as a second message) or kept (its
    // delete was cancelled, and it is shown as Slack holds it).
    dup: int -> int, deletes: int -> int, copyRow: int -> str,
    // Which message Juno keeps: the first it stored, or the copy once the
    // first was deleted elsewhere.
    kept: int -> str,
    // Changes other clients make that bear on a copy: `gone` (the user
    // deleted the kept message on another device) and `reply` (someone
    // replied to the copy). `slack` is what Slack has; `seen` what the
    // store has. `inStep` is false from a socket drop until the catch-up.
    slack: Set[Change], seen: Set[Change], inStep: bool
  }
  type Change = { key: int, what: str }
  var s: State
  var remaining: int
  var turn: int

  action init = all {
    s' = { created: Set(), row: drafts.mapBy(_ => "gone"), stored: Set(), discarded: Set(),
      server: drafts.mapBy(_ => 0), request: drafts.mapBy(_ => "idle"), due: Set(),
      events: Set(), fetches: Set(), scan: Set(),
      online: true, connected: true, catchup: false, sealed: false, claimedOffline: false, label: "init", target: 0,
      act: drafts.mapBy(_ => "none"), actKind: drafts.mapBy(_ => "change"), stale: Set(),
      actSent: Set(), acted: Set(),
      dup: drafts.mapBy(_ => 0), deletes: drafts.mapBy(_ => 0), copyRow: drafts.mapBy(_ => "none"),
      kept: drafts.mapBy(_ => "first"), slack: Set(), seen: Set(), inStep: true },
    remaining' = drainLimit, turn' = 0
  }

  def actPending(k: int): bool = Set("waiting", "transit", "accepted").contains(s.act.get(k))
  def actInFlight(k: int): bool = Set("transit", "accepted").contains(s.act.get(k))
  def keptGone(k: int): bool = s.slack.contains({ key: k, what: "gone" })
  def copyReplied(k: int): bool = s.slack.contains({ key: k, what: "reply" })
  // Messages Slack holds for one client_msg_id.
  def held(k: int): int = s.server.get(k) + s.dup.get(k) - s.deletes.get(k) - (if (keptGone(k)) 1 else 0)
  def copyInSlack(k: int): bool = s.dup.get(k) > s.deletes.get(k)
  // What the store says against deleting the copy (`copyKeepReason`).
  // Reactions from others and an edit follow the reply's rule and are not
  // modelled apart.
  def keepReasonSeen(k: int): bool = s.seen.contains({ key: k, what: "gone" }) or s.seen.contains({ key: k, what: "reply" })
  // A copy in Slack that Juno has not stored yet.
  def copyUnseen(k: int): bool = s.dup.get(k) > s.deletes.get(k) and s.copyRow.get(k) == "none"

  action send(k: int): bool = all {
    not(s.sealed), not(s.created.contains(k)),
    s' = { ...s, created: s.created.union(Set(k)), row: s.row.set(k, "queued"),
      due: s.due.union(Set(k)), label: "send", target: k }
  }

  // Persist sending before the single HTTP attempt leaves. There is no
  // transport retry action. A crash before the call leaves is a dropped call.
  // The worker claims only while Juno sees the socket connected, so a send
  // made offline stays queued; with the guard off it claims whenever HTTP
  // happens to work.
  action claimWith(k: int, guard: bool): bool = all {
    s.online, not(guard) or s.connected,
    s.row.get(k) == "queued", s.due.contains(k), s.request.get(k) == "idle",
    s' = { ...s, row: s.row.set(k, "sending"), request: s.request.set(k, "transit"),
      due: s.due.exclude(Set(k)), claimedOffline: s.claimedOffline or not(s.connected),
      label: "claim", target: k }
  }
  action claim(k: int): bool = claimWith(k, true)
  action accept(k: int, withEcho: bool): bool = all {
    s.request.get(k) == "transit",
    s' = { ...s, server: s.server.set(k, s.server.get(k) + 1),
      request: s.request.set(k, "accepted"),
      events: if (withEcho and s.connected) s.events.union(Set(k)) else s.events,
      label: "accept", target: k }
  }
  // A permanent refusal, 429, or signed-out answer means not posted.
  action refuse(k: int, retryLater: bool): bool = all {
    not(s.sealed), s.request.get(k) == "transit",
    s' = { ...s, request: s.request.set(k, if (retryLater) "later" else "refused"),
      label: "refuse", target: k }
  }
  // A post with files uploads them before it is claimed. Uploading posts
  // nothing, so a refused upload fails the row with no message in Slack, and
  // Retry uploads only what is missing. A lost connection leaves it queued.
  action uploadFail(k: int): bool = all {
    not(s.sealed), s.row.get(k) == "queued", s.due.contains(k), s.request.get(k) == "idle",
    s' = { ...s, row: s.row.set(k, "failed"), due: s.due.exclude(Set(k)), label: "uploadFail", target: k }
  }
  // The network sends an accepted request again before its answer: the
  // connection closed with no answer and the stack resent it by itself.
  // Slack runs it again, so it holds a second message with the same ID.
  action resend(k: int): bool = all {
    not(s.sealed), s.request.get(k) == "accepted", s.dup.get(k) == 0,
    s' = { ...s, dup: s.dup.set(k, 1), label: "resend", target: k }
  }
  // Juno stores a second message with a sent post's ID (`sent.ts`): the
  // echo, the answer, a page or a lookup shows it. Whichever it stored
  // first is the message; this one is hidden in the same transaction and a
  // delete row is queued for it. With the guard off it is listed.
  // A copy that the store already says should stay is kept at once.
  action observeCopyWith(k: int, guard: bool): bool = all {
    s.connected, s.stored.contains(k), copyUnseen(k),
    s' = { ...s, copyRow: s.copyRow.set(k, if (not(guard)) "shown" else if (keepReasonSeen(k)) "kept" else "hidden"),
      kept: if (guard and s.seen.contains({ key: k, what: "gone" })) s.kept.set(k, "copy") else s.kept,
      label: "observeCopy", target: k }
  }
  action observeCopy(k: int): bool = observeCopyWith(k, true)
  // The delete row's `chat.delete`. A lost answer sends it again, and
  // `message_not_found` counts as done, so only its success is modelled.
  // With `byId` off, the bug takes a message with the same text for a copy:
  // every draft here has the same text, so another stored draft is enough.
  // `check`: "full" checks the store again in the transaction before the
  // call and goes only after the catch-up that follows a socket drop;
  // "noWait" checks but does not wait; "none" is the old code, which
  // decided once, when the copy was stored.
  action deleteCopyWith(k: int, byId: bool, check: str): bool = all {
    s.online, s.connected,
    if (byId) all {
      s.copyRow.get(k) == "hidden",
      check == "none" or not(keepReasonSeen(k)),
      check != "full" or s.inStep
    } else all {
      s.stored.contains(k), s.copyRow.get(k) == "none", held(k) > 0,
      drafts.exists(j => j != k and s.stored.contains(j))
    },
    s' = { ...s, deletes: s.deletes.set(k, s.deletes.get(k) + 1),
      copyRow: if (byId) s.copyRow.set(k, "none") else s.copyRow, label: "deleteCopy", target: k }
  }
  action deleteCopy(k: int): bool = deleteCopyWith(k, true, "full")
  // The check before the call fails: the delete row ends unsent and the
  // copy is shown. If the kept message was deleted, the copy is the
  // message now (`sent_posts.ts`).
  action keepCopy(k: int): bool = all {
    s.online, s.connected, s.inStep, s.copyRow.get(k) == "hidden", keepReasonSeen(k),
    s' = { ...s, copyRow: s.copyRow.set(k, "kept"),
      kept: if (s.seen.contains({ key: k, what: "gone" })) s.kept.set(k, "copy") else s.kept,
      label: "keepCopy", target: k }
  }
  // Another client changes Slack. The user sees two messages on another
  // device and deletes the one Juno kept; or someone replies to the copy.
  // While the socket is up its event is stored in the same step; otherwise
  // the catch-up's recheck finds it. **Assumption:** the time between Slack
  // applying the change and Juno storing its event, and between the check
  // and Slack applying Juno's delete, is not modelled. A change in that
  // window can still race the delete.
  action remoteChange(k: int, what: str): bool = {
    val c = { key: k, what: what }
    all {
      not(s.sealed), s.stored.contains(k), copyInSlack(k), not(s.slack.contains(c)),
      what != "gone" or s.kept.get(k) == "first",
      s' = { ...s, slack: s.slack.union(Set(c)), seen: if (s.connected) s.seen.union(Set(c)) else s.seen,
        label: "remoteChange", target: k }
    }
  }

  // Slack can drop the request without an answer.
  action drop(k: int): bool = all {
    not(s.sealed), s.request.get(k) == "transit",
    s' = { ...s, request: s.request.set(k, "dropped"), label: "drop", target: k }
  }

  // All positive observations use this transaction. Deleting a missing row
  // is harmless, including when an echo has already reconciled the answer.
  def writeMessage(k: int): State = { ...s, stored: s.stored.union(Set(k)), row: s.row.set(k, "gone"),
    due: s.due.exclude(Set(k)), label: "writeMessage", target: k }
  action answerWith(k: int, guard: bool): bool = all {
    s.request.get(k) == "accepted",
    s' = { ...writeMessage(k), request: s.request.set(k, "idle"),
      row: s.row.set(k, if (guard) "gone" else "sending"), label: "answer", target: k }
  }
  action answer(k: int): bool = answerWith(k, true)
  action refused(k: int): bool = all {
    Set("refused", "later").contains(s.request.get(k)),
    s' = { ...s, request: s.request.set(k, "idle"),
      row: if (s.row.get(k) == "sending") s.row.set(k, if (s.request.get(k) == "later") "queued" else "failed") else s.row,
      label: "refused", target: k }
  }
  // An ambiguous failure is observable only after Slack has decided the
  // request. It cannot still be in transit when an absent lookup permits resend.
  // An accepted `files.share` answers without the message, which is this
  // action from `accepted`: the row waits for the echo or a lookup.
  action lostWith(k: int, guard: bool): bool = all {
    not(s.sealed) or s.request.get(k) == "dropped",
    Set("accepted", "dropped", "refused", "later").contains(s.request.get(k)),
    s' = { ...s, request: s.request.set(k, "idle"),
      row: if (s.row.get(k) == "sending") s.row.set(k, if (guard) "unknown" else "queued") else s.row,
      label: "lost", target: k }
  }
  action lost(k: int): bool = lostWith(k, true)

  // Restart loses all HTTP answers. For undecided calls Slack has either
  // accepted or dropped them before recovery can look up the ID. `accepted`
  // chooses which transit calls it accepted; previously accepted calls remain.
  action crashWith(accepted: Set[int], guard: bool): bool = all {
    not(s.sealed), accepted.subseteq(drafts.filter(k => s.request.get(k) == "transit")),
    s' = { ...s,
      server: drafts.mapBy(k => s.server.get(k) + (if (accepted.contains(k)) 1 else 0)),
      row: drafts.mapBy(k => if (s.row.get(k) == "sending") (if (guard) "unknown" else "queued") else s.row.get(k)),
      request: drafts.mapBy(_ => "idle"), fetches: Set(),
      // Action rows persist; their calls go out again.
      act: drafts.mapBy(k => if (actInFlight(k)) "waiting" else s.act.get(k)),
      // Interrupted lookups become due again; their rows persist.
      due: s.due.union(drafts.filter(k => s.row.get(k) == "unknown")),
      label: "crash", target: 0 }
  }
  action crash = {
    nondet accepted = drafts.filter(k => s.request.get(k) == "transit").powerset().oneOf()
    crashWith(accepted, true)
  }

  action echoWith(k: int, guard: bool): bool = {
    val observed = if (guard) writeMessage(k) else { ...s, stored: s.stored.union(Set(k)) }
    all {
      s.connected, s.events.contains(k),
      s' = { ...observed, events: s.events.exclude(Set(k)), label: "echo", target: k }
    }
  }
  action echo(k: int): bool = echoWith(k, true)

  // A page carries Slack's snapshot at request time. Absence changes nothing.
  // A lookup is complete for this ID, and only unknown rows can start one.
  action startFetch(k: int, kind: str): bool = all {
    s.online, s.created.contains(k), s.fetches.size() < fetchLimit,
    if (kind == "lookup") all {
      s.connected, s.row.get(k) == "unknown", s.due.contains(k),
      not(s.fetches.exists(f => f.key == k and f.kind == "lookup"))
    } else if (kind == "catchup") s.scan.contains(k) else not(s.sealed),
    s' = { ...s, fetches: s.fetches.union(Set({ key: k, found: s.server.get(k) > 0, kind: kind })),
      due: if (kind == "lookup") s.due.exclude(Set(k)) else s.due,
      scan: if (kind == "catchup") s.scan.exclude(Set(k)) else s.scan,
      label: "startFetch", target: k }
  }
  action lookup(k: int): bool = startFetch(k, "lookup")
  action page(k: int): bool = startFetch(k, "page")
  action finishFetch(f: Fetch): bool = {
    val absent = f.kind == "lookup" and s.row.get(f.key) == "unknown"
    val observed = if (f.found) writeMessage(f.key) else { ...s,
      row: if (absent) s.row.set(f.key, "queued") else s.row,
      due: if (absent) s.due.union(Set(f.key)) else s.due }
    all {
      s.fetches.contains(f),
      s' = { ...observed, fetches: s.fetches.exclude(Set(f)), label: "finishFetch", target: f.key }
    }
  }
  action failLookup(f: Fetch): bool = all {
    not(s.sealed), f.kind == "lookup", s.fetches.contains(f),
    s' = { ...s, fetches: s.fetches.exclude(Set(f)), label: "failLookup", target: f.key }
  }
  action retry(k: int): bool = all {
    not(s.sealed), s.row.get(k) == "failed",
    s' = { ...s, row: s.row.set(k, "queued"), due: s.due.union(Set(k)), label: "retry", target: k }
  }
  action discard(k: int): bool = all {
    not(s.sealed), s.row.get(k) == "failed",
    s' = { ...s, row: s.row.set(k, "gone"), discarded: s.discarded.union(Set(k)), label: "discard", target: k }
  }
  // Time until the next due attempt is abstracted to one worker transition.
  action wake(k: int): bool = all {
    Set("queued", "unknown").contains(s.row.get(k)), not(s.due.contains(k)),
    not(s.fetches.exists(f => f.key == k and f.kind == "lookup")),
    s' = { ...s, due: s.due.union(Set(k)), label: "wake", target: k }
  }

  // Actions on an existing message: edit, delete and reaction toggles.
  def deleted(k: int): bool = s.actKind.get(k) == "delete" and s.act.get(k) == "done"
  // On a queued or failed post nothing goes to Slack: an edit rewrites the
  // row's text, a reaction on a failed post is refused, and a delete removes
  // the row like Delete draft.
  def localAction(k: int, kind: str): State =
    if (kind == "delete") { ...s, row: s.row.set(k, "gone"), due: s.due.exclude(Set(k)),
      discarded: s.discarded.union(Set(k)) } else s
  // On a sending or unknown post the row depends on the post (depends_on);
  // on a stored message it carries the ts. A newer intent replaces a waiting
  // row; a row with a call out sends again after its answer.
  action queueAction(k: int, kind: str): bool = {
    val local = Set("queued", "failed").contains(s.row.get(k)) and not(actPending(k))
    val queued = { ...s, actKind: s.actKind.set(k, kind),
      act: s.act.set(k, if (actInFlight(k)) s.act.get(k) else "waiting"),
      stale: if (actInFlight(k)) s.stale.union(Set(k)) else s.stale }
    val after = if (local) localAction(k, kind) else queued
    all {
      not(s.sealed), s.created.contains(k), not(s.discarded.contains(k)), not(deleted(k)),
      not(actPending(k) and s.actKind.get(k) == "delete"),
      s' = { ...after, label: "queueAction", target: k }
    }
  }
  // The worker resolves the ts from the stored message when it runs. With
  // the guard off it calls with a guessed ts before the post is stored.
  action runActionWith(k: int, guard: bool): bool = all {
    s.online, s.connected, s.act.get(k) == "waiting", not(guard) or s.stored.contains(k),
    s' = { ...s, act: s.act.set(k, "transit"), stale: s.stale.exclude(Set(k)),
      actSent: s.actSent.union(Set(k)), label: "runAction", target: k }
  }
  action runAction(k: int): bool = runActionWith(k, true)
  // Slack applies the call. A repeat is harmless: an edit sets the text, a
  // missing message counts as deleted, already_reacted and no_reaction count
  // as done.
  action actAccept(k: int): bool = all {
    s.act.get(k) == "transit",
    s' = { ...s, act: s.act.set(k, "accepted"), acted: s.acted.union(Set(k)), label: "actAccept", target: k }
  }
  // The answer is stored as the socket event would store it, and the row
  // ends in the same transaction unless its intent changed meanwhile.
  action actAnswer(k: int): bool = all {
    s.act.get(k) == "accepted",
    s' = { ...s, act: s.act.set(k, if (s.stale.contains(k)) "waiting" else "done"),
      label: "actAnswer", target: k }
  }
  // A lost answer, timeout or rate limit: the row waits and goes out again.
  action actFail(k: int): bool = all {
    not(s.sealed), actInFlight(k),
    s' = { ...s, act: s.act.set(k, "waiting"), label: "actFail", target: k }
  }
  // A refusal ends the row; the view shows the stored message again.
  action actRefuse(k: int): bool = all {
    not(s.sealed), s.act.get(k) == "transit",
    s' = { ...s, act: s.act.set(k, "dropped"), stale: s.stale.exclude(Set(k)),
      label: "actRefuse", target: k }
  }
  // A dependent action ends without a call when its post failed or was
  // discarded. On a failed post an edit goes into the row's text, a reaction
  // ends, and a delete discards the row.
  action dropAction(k: int): bool = {
    val discard = s.row.get(k) == "failed" and s.actKind.get(k) == "delete"
    all {
      s.act.get(k) == "waiting", not(s.stored.contains(k)),
      Set("failed", "gone").contains(s.row.get(k)),
      s' = { ...s, act: s.act.set(k, "dropped"), stale: s.stale.exclude(Set(k)),
        row: if (discard) s.row.set(k, "gone") else s.row,
        discarded: if (discard) s.discarded.union(Set(k)) else s.discarded,
        label: "dropAction", target: k }
    }
  }

  action disconnect = all {
    not(s.sealed), s.connected,
    s' = { ...s, connected: false, events: Set(), scan: Set(), catchup: false, inStep: false, label: "disconnect" }
  }
  action goOffline = all {
    not(s.sealed), s.online,
    s' = { ...s, online: false, connected: false, events: Set(), scan: Set(), catchup: false, inStep: false, label: "goOffline" }
  }
  action goOnline = all { not(s.online), s' = { ...s, online: true, label: "goOnline" } }
  action reconnect = all {
    s.online, not(s.connected),
    s' = { ...s, connected: true, catchup: true, scan: s.created, label: "reconnect" }
  }
  // End of catch-up, after all its pages: flush every queued or unknown row.
  // Its recheck has stored what other clients changed meanwhile.
  action catchUp = all {
    s.catchup, s.scan.size() == 0, not(s.fetches.exists(f => f.kind == "catchup")),
    s' = { ...s, catchup: false, inStep: true, seen: s.slack,
      due: s.due.union(drafts.filter(k => Set("queued", "unknown").contains(s.row.get(k)))), label: "catchUp" }
  }
  action seal = all { not(s.sealed), s' = { ...s, sealed: true, label: "seal" } }

  // Juno submits each ID at most once that Slack accepts; a network copy is
  // not Juno's submission and is deleted instead.
  val atMostOnce = drafts.forall(k => s.server.get(k) <= 1)
  val shownOnce = drafts.forall(k => s.copyRow.get(k) != "shown")
  // Slack always holds at least one copy of every real send: Juno never
  // deletes the last one, whether it took a real send for a copy or the
  // user deleted the kept message elsewhere while the copy's delete waited.
  val keepsRealSends = drafts.forall(k => s.stored.contains(k) implies held(k) >= 1)
  // A copy someone replied to is never deleted, so the replies keep their root.
  val repliesKeepRoot = drafts.forall(k => copyReplied(k) implies copyInSlack(k))
  // Once the copy replaced the deleted first message, Slack holds it.
  def keptHeld(k: int): bool = s.kept.get(k) == "copy" implies copyInSlack(k)
  // A kept copy stays beside the first message unless it replaced it.
  def expectedHeld(k: int): int = if (s.copyRow.get(k) == "kept" and not(keptGone(k))) 2 else 1
  val noDoubleShow = drafts.forall(k => s.stored.contains(k) implies s.row.get(k) == "gone")
  val noSilentLoss = s.created.forall(k => s.row.get(k) == "gone" implies
    (s.stored.contains(k) or s.discarded.contains(k)))
  val quiet = s.online and s.connected and not(s.catchup) and s.scan.size() == 0 and
    s.events.size() == 0 and s.fetches.size() == 0 and drafts.forall(k =>
      s.request.get(k) == "idle" and Set("gone", "failed").contains(s.row.get(k)) and not(actPending(k)) and
      s.copyRow.get(k) != "hidden" and not(copyUnseen(k)))
  val agreed = s.created.forall(k => s.discarded.contains(k) or
    (s.row.get(k) == "gone" and s.stored.contains(k) and s.server.get(k) == 1 and held(k) == expectedHeld(k) and keptHeld(k)) or
    (s.row.get(k) == "failed" and not(s.stored.contains(k)) and held(k) == 0)) and
    drafts.forall(k => s.act.get(k) == "done" implies s.acted.contains(k))
  val quietAgreement = (s.sealed and quiet) implies agreed
  val reachedAgreement = s.sealed and quiet and agreed
  val drainBound = remaining > 0 or reachedAgreement
  val actionNeedsMessage = s.actSent.subseteq(s.stored) and s.acted.subseteq(s.stored)
  val noActionOnDiscarded = s.actSent.intersect(s.discarded) == Set()
  val sendsWaitOffline = not(s.claimedOffline)
  val actionsDrain = remaining > 0 or drafts.forall(k => not(actPending(k)))
  val invariants = atMostOnce and noDoubleShow and noSilentLoss and quietAgreement and drainBound and
    actionNeedsMessage and noActionOnDiscarded and actionsDrain and sendsWaitOffline and shownOnce and keepsRealSends and repliesKeepRoot

  action work = any {
    goOnline, reconnect, catchUp,
    { nondet k = drafts.oneOf(); nondet withEcho = Set(true, false).oneOf(); any {
      claim(k), accept(k, withEcho), answer(k), refused(k), lookup(k), wake(k),
      runAction(k), actAccept(k), actAnswer(k), dropAction(k), observeCopy(k), deleteCopy(k), keepCopy(k),
      all { s.request.get(k) == "dropped", lost(k) }
    } },
    { nondet k = s.events.oneOf(); echo(k) },
    { nondet k = s.scan.oneOf(); startFetch(k, "catchup") },
    { nondet f = s.fetches.oneOf(); finishFetch(f) }
  }
  action progress = any { work, all { quiet, s' = { ...s, label: "idle" } } }
  action input = {
    nondet k = drafts.oneOf()
    nondet later = Set(true, false).oneOf()
    nondet kind = Set("change", "delete").oneOf()
    any {
      send(k), refuse(k, later), drop(k), resend(k), lost(k), crash, retry(k), discard(k), uploadFail(k),
      queueAction(k, kind), actFail(k), actRefuse(k), remoteChange(k, "gone"), remoteChange(k, "reply"),
      page(k), disconnect, goOffline, seal,
      { nondet f = s.fetches.oneOf(); failLookup(f) }
    }
  }
  action tick(a: bool): bool = all {
    a, turn' = turn + 1,
    remaining' = if (s.sealed and not(quiet)) remaining - 1 else remaining
  }
  action step = tick(if (s.sealed) progress else any { input, progress })
  action simulationStep = all { not(reachedAgreement), step }

  // Directed schedules stop at agreement, so the runner can require a
  // completion witness. The broken schedules use the same actions and inputs.
  action blindRetryWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, false) else
    if (turn == 3) lostWith(1, guard) else
    if (turn == 4) wake(1) else
    if (turn == 5) (if (guard) lookup(1) else claim(1)) else
    if (turn == 6) (if (guard) { nondet f = s.fetches.oneOf(); finishFetch(f) } else accept(1, false)) else
    seal
  ) }
  action blindRetryStep = blindRetryWith(true)
  action blindRetryBugStep = blindRetryWith(false)

  action crashResendWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, false) else
    if (turn == 3) crashWith(Set(), guard) else
    if (turn == 4) wake(1) else
    if (turn == 5) (if (guard) lookup(1) else claim(1)) else
    if (turn == 6) (if (guard) { nondet f = s.fetches.oneOf(); finishFetch(f) } else accept(1, false)) else
    seal
  ) }
  action crashResendStep = crashResendWith(true)
  action crashResendBugStep = crashResendWith(false)

  action echoBeforeAnswerWith(deleteRow: bool, keepGone: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, true) else
    if (turn == 3) echoWith(1, deleteRow) else
    if (turn == 4) answerWith(1, keepGone) else
    seal
  ) }
  action echoKeepsRowStep = echoBeforeAnswerWith(true, true)
  action echoKeepsRowBugStep = echoBeforeAnswerWith(false, true)
  action answerAfterEchoStep = echoBeforeAnswerWith(true, true)
  action answerAfterEchoBugStep = echoBeforeAnswerWith(true, false)

  action answerBeforeEchoStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, true) else
    if (turn == 3) answer(1) else
    if (turn == 4) echo(1) else
    seal
  ) }
  action lostLookupAbsentStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) drop(1) else
    if (turn == 3) lost(1) else
    if (turn == 4) wake(1) else
    if (turn == 5) lookup(1) else
    if (turn == 6) { nondet f = s.fetches.oneOf(); finishFetch(f) } else
    if (turn == 7) claim(1) else
    if (turn == 8) accept(1, false) else
    if (turn == 9) answer(1) else
    seal
  ) }
  action reconnectPageStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, true) else
    if (turn == 3) lost(1) else
    if (turn == 4) disconnect else
    if (turn == 5) reconnect else
    if (turn == 6) wake(1) else
    if (turn == 7) lookup(1) else
    if (turn == 8) startFetch(1, "catchup") else
    if (turn == 9) { nondet f = s.fetches.filter(f => f.kind == "catchup").oneOf(); finishFetch(f) } else
    if (turn == 10) catchUp else
    if (turn == 11) { nondet f = s.fetches.oneOf(); finishFetch(f) } else
    seal
  ) }

  // An upload is refused, the user retries, the files go and the post is
  // shared; its answer has no message, so the lookup stores it.
  action uploadRetryStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) uploadFail(1) else
    if (turn == 2) retry(1) else
    if (turn == 3) claim(1) else
    if (turn == 4) accept(1, false) else
    if (turn == 5) lost(1) else
    if (turn == 6) wake(1) else
    if (turn == 7) lookup(1) else
    if (turn == 8) { nondet f = s.fetches.oneOf(); finishFetch(f) } else
    seal
  ) }

  // A send made while the socket is down waits for the reconnect, then
  // posts once. The bug claims it while Juno knows it is offline.
  action offlineSendWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) disconnect else
    if (turn == 1) send(1) else
    if (turn == 2) (if (guard) reconnect else claimWith(1, false)) else
    if (turn == 3) claim(1) else
    if (turn == 4) accept(1, false) else
    if (turn == 5) answer(1) else
    seal
  ) }
  action offlineSendStep = offlineSendWith(true)
  action offlineSendBugStep = offlineSendWith(false)

  // An edit queued while the post is out waits for the stored message. The
  // bug calls with a guessed ts at once.
  action actionBeforeStoreWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) queueAction(1, "change") else
    if (turn == 3) (if (guard) accept(1, false) else runActionWith(1, false)) else
    if (turn == 4) answer(1) else
    if (turn == 5) runAction(1) else
    seal
  ) }
  action actionBeforeStoreStep = actionBeforeStoreWith(true)
  action actionBeforeStoreBugStep = actionBeforeStoreWith(false)

  // The post is refused and the user deletes the draft while an edit waits
  // on it. The edit ends without a call; the bug calls anyway.
  action actionOnDiscardedWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) queueAction(1, "change") else
    if (turn == 3) refuse(1, false) else
    if (turn == 4) refused(1) else
    if (turn == 5) discard(1) else
    if (turn == 6) (if (guard) dropAction(1) else runActionWith(1, false)) else
    seal
  ) }
  action actionOnDiscardedStep = actionOnDiscardedWith(true)
  action actionOnDiscardedBugStep = actionOnDiscardedWith(false)

  // A delete queued while the post is out, then the post is refused: the
  // delete discards the failed row and ends.
  action dependentDeleteStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) queueAction(1, "delete") else
    if (turn == 3) refuse(1, false) else
    if (turn == 4) refused(1) else
    if (turn == 5) dropAction(1) else
    seal
  ) }
  // An edit on a stored message: Slack applies it, a newer edit arrives while
  // the call is out, the answer is lost. The worker sends the newer text and
  // the row ends.
  action actionRetryStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, false) else
    if (turn == 3) answer(1) else
    if (turn == 4) queueAction(1, "change") else
    if (turn == 5) runAction(1) else
    if (turn == 6) actAccept(1) else
    if (turn == 7) queueAction(1, "change") else
    if (turn == 8) actFail(1) else
    seal
  ) }

  // The network resends an accepted post before its answer, so Slack holds
  // two messages with the ID. The answer stores one, the echo of the other
  // arrives, and Juno hides that copy and deletes it. The bug lists it.
  action networkCopyWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, true) else
    if (turn == 3) resend(1) else
    if (turn == 4) answer(1) else
    if (turn == 5) echo(1) else
    if (turn == 6) observeCopyWith(1, guard) else
    seal
  ) }
  action networkCopyStep = networkCopyWith(true)
  action networkCopyBugStep = networkCopyWith(false)

  // Two posts with the same text, each sent once. The guarded reconciler
  // matches by ID and deletes nothing. The bug matches by text and deletes
  // the second post, which the user sent on purpose.
  action sameTextWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) send(2) else
    if (turn == 2) claim(1) else
    if (turn == 3) accept(1, false) else
    if (turn == 4) answer(1) else
    if (turn == 5) claim(2) else
    if (turn == 6) accept(2, false) else
    if (turn == 7) answer(2) else
    if (turn == 8) (if (guard) seal else deleteCopyWith(2, false, "none")) else
    seal
  ) }
  action sameTextStep = sameTextWith(true)
  action sameTextBugStep = sameTextWith(false)

  // The first five turns of each schedule below: Slack holds the post and
  // its network copy, Juno keeps the first and hides the copy.
  def copyHidden(turn: int): bool = turn <= 5
  action copySetup = any {
    all { turn == 0, send(1) }, all { turn == 1, claim(1) }, all { turn == 2, accept(1, true) },
    all { turn == 3, resend(1) }, all { turn == 4, answer(1) }, all { turn == 5, echo(1) }
  }

  // S1: the copy's delete waits (backoff), and the user deletes the kept
  // message on another device. The check finds it deleted, keeps the copy
  // and makes it the message. The bug deletes the copy too.
  action keptDeletedWith(check: str): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (copyHidden(turn)) copySetup else
    if (turn == 6) observeCopy(1) else
    if (turn == 7) remoteChange(1, "gone") else
    if (turn == 8) (if (check == "full") keepCopy(1) else deleteCopyWith(1, true, check)) else
    seal
  ) }
  action keptDeletedStep = keptDeletedWith("full")
  action keptDeletedBugStep = keptDeletedWith("none")

  // S2: someone replies to the copy while its delete waits. The check
  // keeps the copy. The bug deletes it, leaving the replies under a
  // deleted root.
  action copyReplyWith(check: str): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (copyHidden(turn)) copySetup else
    if (turn == 6) observeCopy(1) else
    if (turn == 7) remoteChange(1, "reply") else
    if (turn == 8) (if (check == "full") keepCopy(1) else deleteCopyWith(1, true, check)) else
    seal
  ) }
  action copyReplyStep = copyReplyWith("full")
  action copyReplyBugStep = copyReplyWith("none")

  // The socket drops while the copy's delete waits, and the user deletes
  // the kept message meanwhile. The store learns it only from the
  // catch-up's recheck. The guarded delete waits for the catch-up, then
  // keeps the copy. The bug checks the store at once, on the reconnect,
  // finds nothing against the delete, and deletes the copy.
  action deletedOfflineWith(check: str): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (copyHidden(turn)) copySetup else
    if (turn == 6) observeCopy(1) else
    if (turn == 7) disconnect else
    if (turn == 8) remoteChange(1, "gone") else
    if (turn == 9) reconnect else
    if (turn == 10) (if (check == "full") startFetch(1, "catchup") else deleteCopyWith(1, true, check)) else
    if (turn == 11) { nondet f = s.fetches.oneOf(); finishFetch(f) } else
    if (turn == 12) catchUp else
    if (turn == 13) keepCopy(1) else
    seal
  ) }
  action deletedOfflineStep = deletedOfflineWith("full")
  action deletedOfflineBugStep = deletedOfflineWith("noWait")
}

module outbox {
  import outboxProtocol(drafts = Set(1, 2), fetchLimit = 2, drainLimit = 48).*
}
