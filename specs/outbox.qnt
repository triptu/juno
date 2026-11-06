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
    parent: int -> int,
    created: Set[int], row: int -> str, stored: Set[int], discarded: Set[int],
    server: int -> int, request: int -> str, due: Set[int],
    events: Set[int], fetches: Set[Fetch], scan: Set[int],
    online: bool, connected: bool, catchup: bool, sealed: bool,
    // A post claimed while Juno saw the socket down.
    claimedOffline: bool,
    label: str, target: int,
    // One action row per message (edit, delete or reaction toggle): none,
    // waiting, transit, accepted, done, dropped, or failed (a defect, exhausted
    // retries, or a refused reaction, with Retry and Dismiss). Kind
    // `change` is an edit, `react` a reaction toggle; `delete` replaces them.
    // Separate edit/broadcast rows are modelled by broadcastOutbox below.
    // `stale` holds rows whose intent changed while a call was out.
    // `actSent` records every action call that left Juno; `acted` every
    // message Slack applied one to.
    actAttempts: int -> int, actChannel: int -> int,
    act: int -> str, actKind: int -> str, stale: Set[int],
    actSent: Set[int], acted: Set[int],
    // Messages another client deleted, as far as Slack's answers to action
    // calls go (the copy rules use `slack` instead). `phantom`: reactions
    // Juno counted as made on a message Slack no longer had (the bug).
    missing: Set[int], phantom: Set[int],
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
    // `gapped`: posts sent before the last drop. `rechecked`: posts whose
    // topic the catch-up after that drop read again.
    slack: Set[Change], seen: Set[Change], inStep: bool, gapped: Set[int], rechecked: Set[int],
    // Posts whose thread or channel Slack can no longer read or take posts
    // for: the root was deleted, or the user left the channel.
    unreachable: Set[int]
  }
  type Change = { key: int, what: str }
  var s: State
  var remaining: int
  var turn: int

  action init = all {
    s' = { parent: drafts.mapBy(_ => 0), created: Set(), row: drafts.mapBy(_ => "gone"), stored: Set(), discarded: Set(),
      server: drafts.mapBy(_ => 0), request: drafts.mapBy(_ => "idle"), due: Set(),
      events: Set(), fetches: Set(), scan: Set(),
      online: true, connected: true, catchup: false, sealed: false, claimedOffline: false, label: "init", target: 0,
      actAttempts: drafts.mapBy(_ => 0), actChannel: drafts.mapBy(k => k),
      act: drafts.mapBy(_ => "none"), actKind: drafts.mapBy(_ => "change"), stale: Set(),
      actSent: Set(), acted: Set(), missing: Set(), phantom: Set(),
      dup: drafts.mapBy(_ => 0), deletes: drafts.mapBy(_ => 0), copyRow: drafts.mapBy(_ => "none"),
      kept: drafts.mapBy(_ => "first"), slack: Set(), seen: Set(), inStep: true,
      gapped: Set(), rechecked: Set(), unreachable: Set() },
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
  // The store may have missed a change to the post during the last gap.
  def unchecked(k: int): bool = s.gapped.contains(k) and not(s.rechecked.contains(k))
  // A copy in Slack that Juno has not stored yet.
  def copyUnseen(k: int): bool = s.dup.get(k) > s.deletes.get(k) and s.copyRow.get(k) == "none"

  action send(k: int): bool = all {
    not(s.sealed), not(s.created.contains(k)),
    s' = { ...s, created: s.created.union(Set(k)), row: s.row.set(k, "queued"),
      due: s.due.union(Set(k)), label: "send", target: k }
  }

  // New chat opens the root's local topic at send, including a failed root.
  // A reply queued from that view keeps the root's outbox identity until
  // writeMessage acknowledges it. No provisional timestamp goes to Slack.
  action sendReply(k: int, root: int): bool = all {
    not(s.sealed), not(s.created.contains(k)), s.created.contains(root), k != root, not(s.discarded.contains(root)),
    s' = { ...s, created: s.created.union(Set(k)), parent: s.parent.set(k, root),
      row: s.row.set(k, "queued"), due: s.due.union(Set(k)), label: "sendReply", target: k }
  }

  // Persist sending before the single HTTP attempt leaves. There is no
  // transport retry action. A crash before the call leaves is a dropped call.
  // The worker claims only while Juno sees the socket connected, so a send
  // made offline stays queued; with the guard off it claims whenever HTTP
  // happens to work.
  action claimWith(k: int, guard: bool): bool = all {
    s.online, not(guard) or s.connected,
    s.parent.get(k) == 0 or s.stored.contains(s.parent.get(k)),
    s.row.get(k) == "queued", s.due.contains(k), s.request.get(k) == "idle",
    s' = { ...s, row: s.row.set(k, "sending"), request: s.request.set(k, "transit"),
      due: s.due.exclude(Set(k)), claimedOffline: s.claimedOffline or not(s.connected),
      label: "claim", target: k }
  }
  action claim(k: int): bool = claimWith(k, true)
  action accept(k: int, withEcho: bool): bool = all {
    s.request.get(k) == "transit", not(s.unreachable.contains(k)),
    s' = { ...s, server: s.server.set(k, s.server.get(k) + 1),
      request: s.request.set(k, "accepted"),
      events: if (withEcho and s.connected) s.events.union(Set(k)) else s.events,
      label: "accept", target: k }
  }
  // A permanent refusal, 429, or signed-out answer means not posted. A post
  // to an unreachable thread or channel is refused for good, after the seal too.
  action refuse(k: int, retryLater: bool): bool = all {
    not(s.sealed) or (s.unreachable.contains(k) and not(retryLater)), s.request.get(k) == "transit",
    s' = { ...s, request: s.request.set(k, if (retryLater) "later" else "refused"),
      label: "refuse", target: k }
  }
  // A post with files uploads them before it is claimed. Uploading posts
  // nothing, so a refused upload fails the row with no message in Slack, and
  // Retry uploads only what is missing. A lost connection leaves it queued.
  // A file the composer was still staging at the send is waited for before
  // the uploads, which is a queued row not yet claimed; one whose bytes will
  // not come fails the row here too.
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
  // The user's own delete in Juno (`deleted`) is not a reason to keep it:
  // the engine records it on `sent_posts`, so the copy is deleted too.
  // With `ownAsGone` on, the bug takes it for a delete made elsewhere and
  // makes the copy the message.
  action observeCopyAs(k: int, guard: bool, ownAsGone: bool): bool = {
    val gone = s.seen.contains({ key: k, what: "gone" }) or (ownAsGone and deleted(k))
    all {
      s.connected, s.stored.contains(k), copyUnseen(k),
      s' = { ...s, copyRow: s.copyRow.set(k, if (not(guard)) "shown" else if (gone or keepReasonSeen(k)) "kept" else "hidden"),
        kept: if (guard and gone) s.kept.set(k, "copy") else s.kept,
        label: "observeCopy", target: k }
    }
  }
  action observeCopyWith(k: int, guard: bool): bool = observeCopyAs(k, guard, false)
  action observeCopy(k: int): bool = observeCopyWith(k, true)
  // The delete row's `chat.delete`. A lost answer sends it again, and
  // `message_not_found` counts as done, so only its success is modelled.
  // With `byId` off, the bug takes a message with the same text for a copy:
  // every draft here has the same text, so another stored draft is enough.
  // `check`: "full" checks the store again in the transaction before the
  // call, goes only after the catch-up that follows a socket drop, and,
  // for a post sent before the drop, only once that catch-up read the
  // post's topic; "noRecheck" waits for the catch-up but does not ask
  // whether it read the topic; "noWait" checks but does not wait; "none"
  // is the old code, which decided once, when the copy was stored.
  action deleteCopyWith(k: int, byId: bool, check: str): bool = all {
    s.online, s.connected,
    if (byId) all {
      s.copyRow.get(k) == "hidden",
      check == "none" or not(keepReasonSeen(k)),
      check == "none" or check == "noWait" or s.inStep,
      check != "full" or not(unchecked(k))
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
  // message now (`sent_posts.ts`). It fails when the store has a reason
  // to keep the copy, when the catch-up did not read the topic of a post
  // sent before the drop, and when the catch-up does not end in time (the
  // deadline is abstracted: any step while it has not ended).
  action keepCopy(k: int): bool = all {
    s.online, s.connected, s.copyRow.get(k) == "hidden",
    not(s.inStep) or keepReasonSeen(k) or unchecked(k),
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
  // window can still race the delete. The check runs holding the send
  // lane, just before the request leaves, so the second window is one
  // request's flight, not a wait behind other writes.
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
  action refusedWith(k: int, guard: bool): bool = {
    val settled = if (s.row.get(k) != "sending") s
      else if (s.request.get(k) == "later") requeueWith(k, guard)
      else { ...s, row: s.row.set(k, "failed") }
    all {
      Set("refused", "later").contains(s.request.get(k)),
      s' = { ...settled, request: s.request.set(k, "idle"), label: "refused", target: k }
    }
  }
  action refused(k: int): bool = refusedWith(k, true)
  // An ambiguous failure is observable only after Slack has decided the
  // request. It cannot still be in transit when an absent lookup permits resend.
  // An accepted `files.share` or `chat.shareMessage` (a forward) answers without the message, which is this
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
  action finishFetchWith(f: Fetch, guard: bool): bool = {
    val absent = f.kind == "lookup" and s.row.get(f.key) == "unknown"
    val observed = if (f.found) writeMessage(f.key) else if (absent) requeueWith(f.key, guard) else s
    all {
      s.fetches.contains(f), not(s.unreachable.contains(f.key)),
      s' = { ...observed, fetches: s.fetches.exclude(Set(f)), label: "finishFetch", target: f.key }
    }
  }
  action finishFetch(f: Fetch): bool = finishFetchWith(f, true)
  // Slack can no longer read or take posts for the message's thread or
  // channel: the root was deleted, or the user left the channel.
  action loseThread(k: int): bool = all {
    not(s.sealed), s.created.contains(k), not(s.unreachable.contains(k)),
    s' = { ...s, unreachable: s.unreachable.union(Set(k)), label: "loseThread", target: k }
  }
  // Slack refuses a read of an unreachable thread or channel for good
  // (thread_not_found, channel_not_found). A page changes nothing. A lookup
  // can never be answered, so its row is failed: the user chooses Retry or
  // Delete draft, and the channel's later posts go. With the guard off the
  // row stays unknown and is asked about again, and again.
  action refuseFetchWith(f: Fetch, guard: bool): bool = {
    val lookup = f.kind == "lookup" and s.row.get(f.key) == "unknown"
    all {
      s.fetches.contains(f), s.unreachable.contains(f.key),
      s' = { ...s, fetches: s.fetches.exclude(Set(f)),
        row: if (guard and lookup) s.row.set(f.key, "failed") else s.row,
        due: if (not(guard) and lookup) s.due.union(Set(f.key)) else s.due,
        label: "refuseFetch", target: f.key }
    }
  }
  action refuseFetch(f: Fetch): bool = refuseFetchWith(f, true)
  action failLookup(f: Fetch): bool = all {
    not(s.sealed), f.kind == "lookup", s.fetches.contains(f),
    s' = { ...s, fetches: s.fetches.exclude(Set(f)), label: "failLookup", target: f.key }
  }
  // The list hides a message whose delete waits, so Retry is not offered on it.
  action retry(k: int): bool = all {
    not(s.sealed), s.row.get(k) == "failed", not(actPending(k) and s.actKind.get(k) == "delete"),
    s' = { ...s, row: s.row.set(k, "queued"), due: s.due.union(Set(k)), label: "retry", target: k }
  }
  // The user removes a row Slack has not got (Delete draft, or a delete of
  // a queued post). A root started from Home takes the replies that waited
  // on it: the thread never existed, so they can never go. With the guard
  // off they stay queued, and nothing can ever claim or fail them.
  def discardedWith(k: int, guard: bool): State = {
    val gone = Set(k).union(if (guard) drafts.filter(j => s.parent.get(j) == k and s.row.get(j) != "gone") else Set())
    { ...s, row: drafts.mapBy(j => if (gone.contains(j)) "gone" else s.row.get(j)),
      due: s.due.exclude(gone), discarded: s.discarded.union(gone) }
  }
  action discardWith(k: int, guard: bool): bool = all {
    not(s.sealed), s.row.get(k) == "failed",
    s' = { ...discardedWith(k, guard), label: "discard", target: k }
  }
  action discard(k: int): bool = discardWith(k, true)
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
  // Either also ends an edit row still waiting on the post, queued while
  // the post was out (it came back: a 429, or a lookup did not find it).
  // Its text is older, so the newest edit wins.
  def localAction(k: int, kind: str): State = {
    val ended = { ...s, act: if (actPending(k)) s.act.set(k, "dropped") else s.act, stale: s.stale.exclude(Set(k)) }
    if (kind == "delete") { ...discardedWith(k, true), act: ended.act, stale: ended.stale } else ended
  }
  // A post back in the queue (a 429, a signed-out answer, a lookup that found
  // it absent) is not in Slack: an edit or delete the user queued while it
  // was out applies to the row now, as on a queued row, so the edit's text
  // goes with the post and the worker never sends a post the user deleted.
  // A reaction waits for the stored message. With the guard off the row is
  // queued as it was, with the delete waiting on it.
  def requeueWith(k: int, guard: bool): State = {
    val applied = if (guard and actPending(k) and s.actKind.get(k) != "react") localAction(k, s.actKind.get(k)) else s
    if (applied.row.get(k) == "gone") applied else { ...applied, row: applied.row.set(k, "queued"), due: applied.due.union(Set(k)) }
  }
  // On a sending or unknown post the row depends on the post (depends_on);
  // on a stored message it carries the ts. A newer intent replaces a waiting
  // row; a row with a call out sends again after its answer.
  action queueAction(k: int, kind: str): bool = {
    val local = Set("queued", "failed").contains(s.row.get(k))
    val queued = { ...s, actAttempts: s.actAttempts.set(k, 0), actKind: s.actKind.set(k, kind),
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
  // Each k is one message and has at most one action row. Its replacements
  // wait for the in-flight intent. Reactions on other messages are independent;
  // edits and deletes retain channel order, including duplicate cleanup.
  def actionHead(k: int): bool = drafts.forall(j =>
    (j < k and s.actChannel.get(j) == s.actChannel.get(k) and
      s.actKind.get(j) != "react" and s.actKind.get(k) != "react") implies not(actPending(j)))
  action runActionWith(k: int, guard: bool): bool = all {
    actionHead(k),
    s.online, s.connected, s.act.get(k) == "waiting", not(guard) or s.stored.contains(k),
    s' = { ...s, act: s.act.set(k, "transit"), stale: s.stale.exclude(Set(k)),
      actSent: s.actSent.union(Set(k)), label: "runAction", target: k }
  }
  action runAction(k: int): bool = runActionWith(k, true)
  // Slack applies the call. A repeat is harmless: an edit sets the text, a
  // missing message counts as deleted, already_reacted and no_reaction count
  // as done. A reaction on a message Slack does not have is refused
  // (`message_not_found`); with the guard off Juno counts it as made.
  action actAcceptWith(k: int, guard: bool): bool = {
    val gone = s.actKind.get(k) == "react" and s.missing.contains(k)
    all {
      s.act.get(k) == "transit", not(guard and gone),
      s' = { ...s, act: s.act.set(k, "accepted"), acted: s.acted.union(Set(k)),
        phantom: if (gone) s.phantom.union(Set(k)) else s.phantom, label: "actAccept", target: k }
    }
  }
  action actAccept(k: int): bool = actAcceptWith(k, true)
  // The answer is stored as the socket event would store it, and the row
  // ends in the same transaction unless its intent changed meanwhile.
  action actAnswer(k: int): bool = all {
    s.act.get(k) == "accepted",
    s' = { ...s, act: s.act.set(k, if (s.stale.contains(k)) "waiting" else "done"),
      label: "actAnswer", target: k }
  }
  // Five failed exchanges end an intent. A newer intent has its own budget.
  action actFail(k: int): bool = all {
    not(s.sealed), actInFlight(k),
    s' = { ...s, actAttempts: s.actAttempts.set(k, if (s.stale.contains(k)) 0 else s.actAttempts.get(k) + 1),
      act: s.act.set(k, if (not(s.stale.contains(k)) and s.actAttempts.get(k) >= 4) "failed" else "waiting"),
      label: "actFail", target: k }
  }
  // A defect, or a legacy row already beyond its budget, stops before another call.
  action actDefect(k: int): bool = all {
    actPending(k), s' = { ...s, act: s.act.set(k, if (s.stale.contains(k)) "waiting" else "failed"), label: "actDefect", target: k }
  }
  // A refusal ends an edit or delete row; the view shows the stored message
  // again. A refused reaction stays as `failed`: the chip shows what Slack
  // has, and the message offers Retry (a new `queueAction`) and Dismiss.
  action actRefuse(k: int): bool = all {
    not(s.sealed), s.act.get(k) == "transit",
    s' = { ...s, act: s.act.set(k, if (s.actKind.get(k) == "react") "failed" else "dropped"), stale: s.stale.exclude(Set(k)),
      label: "actRefuse", target: k }
  }
  // The elapsed retry window can end a waiting reaction even offline.
  // Time is abstracted as expiry; in-flight requests settle before this transition.
  action expireReaction(k: int): bool = all {
    s.actKind.get(k) == "react", s.act.get(k) == "waiting",
    s' = { ...s, act: s.act.set(k, "failed"), label: "expireReaction", target: k }
  }
  // Dismiss on a refused reaction: the row ends without a call.
  action dismissAction(k: int): bool = all {
    s.act.get(k) == "failed",
    s' = { ...s, act: s.act.set(k, "dropped"), label: "dismissAction", target: k }
  }
  // Another client deletes the stored message; only action answers see it.
  action deleteElsewhere(k: int): bool = all {
    not(s.sealed), s.stored.contains(k), not(s.missing.contains(k)),
    s' = { ...s, missing: s.missing.union(Set(k)), label: "deleteElsewhere", target: k }
  }
  // A dependent action ends without a call when its post failed or was
  // discarded. On a failed post an edit goes into the row's text, a reaction
  // ends, and a delete discards the row.
  action dropAction(k: int): bool = {
    val discard = s.row.get(k) == "failed" and s.actKind.get(k) == "delete"
    val after = if (discard) discardedWith(k, true) else s
    all {
      s.act.get(k) == "waiting", not(s.stored.contains(k)),
      Set("failed", "gone").contains(s.row.get(k)),
      s' = { ...after, act: s.act.set(k, "dropped"), stale: s.stale.exclude(Set(k)), label: "dropAction", target: k }
    }
  }

  action disconnect = all {
    not(s.sealed), s.connected,
    s' = { ...s, connected: false, events: Set(), scan: Set(), catchup: false, inStep: false,
      gapped: s.created, rechecked: Set(), label: "disconnect" }
  }
  action goOffline = all {
    not(s.sealed), s.online,
    s' = { ...s, online: false, connected: false, events: Set(), scan: Set(), catchup: false, inStep: false,
      gapped: s.created, rechecked: Set(), label: "goOffline" }
  }
  action goOnline = all { not(s.online), s' = { ...s, online: true, label: "goOnline" } }
  action reconnect = all {
    s.online, not(s.connected),
    s' = { ...s, connected: true, catchup: true, scan: s.created, label: "reconnect" }
  }
  // End of catch-up, after all its pages: flush every queued or unknown row.
  // Its recheck reads only the likely topics (`covered`) and stores what
  // other clients changed there meanwhile.
  action catchUpWith(covered: Set[int]): bool = all {
    s.catchup, s.scan.size() == 0, not(s.fetches.exists(f => f.kind == "catchup")),
    s' = { ...s, catchup: false, inStep: true, rechecked: covered,
      seen: s.seen.union(s.slack.filter(c => covered.contains(c.key))),
      due: s.due.union(drafts.filter(k => Set("queued", "unknown").contains(s.row.get(k)))), label: "catchUp" }
  }
  action catchUp = catchUpWith(drafts)
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
  // The copy replaces the message only when the user deleted it on another
  // device, never when they deleted it in Juno: that delete stays.
  val ownDeleteHolds = drafts.forall(k => s.kept.get(k) == "copy" implies keptGone(k))
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
    (s.row.get(k) == "failed" and not(s.stored.contains(k)) and held(k) == 0) or
    // What Slack holds for an unreachable thread cannot be read: the row is decided, failed or gone.
    (s.unreachable.contains(k) and Set("failed", "gone").contains(s.row.get(k)))) and
    drafts.forall(k => s.act.get(k) == "done" implies s.acted.contains(k))
  val quietAgreement = (s.sealed and quiet) implies agreed
  val reachedAgreement = s.sealed and quiet and agreed
  val drainBound = remaining > 0 or reachedAgreement
  val actionNeedsMessage = s.actSent.subseteq(s.stored) and s.acted.subseteq(s.stored)
  val noActionOnDiscarded = s.actSent.intersect(s.discarded) == Set()
  val sendsWaitOffline = not(s.claimedOffline)
  // A post the user deleted is never back in the queue, so the worker never sends it after the delete.
  val deletedNeverQueued = drafts.forall(k => (actPending(k) and s.actKind.get(k) == "delete") implies s.row.get(k) != "queued")
  // A reply that waited on a root the user removed went with it: nothing could ever send or fail it.
  val repliesFollowRoot = drafts.forall(k => (s.parent.get(k) != 0 and s.discarded.contains(s.parent.get(k))) implies s.row.get(k) == "gone")
  val actionsDrain = remaining > 0 or drafts.forall(k => not(actPending(k)))
  // Juno never shows a reaction as made that Slack refused.
  val reactionsLand = s.phantom == Set()
  // Defects and exhausted retries can fail every action kind.
  val actionRetryBound = drafts.forall(k => s.actAttempts.get(k) <= 5 and
    (s.actAttempts.get(k) == 5 implies s.act.get(k) == "failed" or s.act.get(k) == "dropped"))
  val repliesWaitForRoot = drafts.forall(k =>
    s.parent.get(k) != 0 and (s.server.get(k) > 0 or s.row.get(k) == "sending") implies s.stored.contains(s.parent.get(k)))
  val invariants = repliesWaitForRoot and atMostOnce and noDoubleShow and noSilentLoss and quietAgreement and drainBound and
    actionNeedsMessage and noActionOnDiscarded and actionsDrain and sendsWaitOffline and shownOnce and keepsRealSends and repliesKeepRoot and
    ownDeleteHolds and reactionsLand and actionRetryBound and deletedNeverQueued and repliesFollowRoot

  action work = any {
    goOnline, reconnect, { nondet covered = drafts.powerset().oneOf(); catchUpWith(covered) },
    { nondet k = drafts.oneOf(); nondet withEcho = Set(true, false).oneOf(); any {
      claim(k), accept(k, withEcho), answer(k), refused(k), lookup(k), wake(k),
      runAction(k), actAccept(k), actAnswer(k), dropAction(k), observeCopy(k), deleteCopy(k), keepCopy(k),
      all { s.request.get(k) == "dropped", lost(k) },
      all { s.unreachable.contains(k), refuse(k, false) }
    } },
    { nondet k = s.events.oneOf(); echo(k) },
    { nondet k = s.scan.oneOf(); startFetch(k, "catchup") },
    { nondet f = s.fetches.oneOf(); any { finishFetch(f), refuseFetch(f) } }
  }
  action progress = any { work, all { quiet, s' = { ...s, label: "idle" } } }
  action input = {
    nondet k = drafts.oneOf()
    nondet later = Set(true, false).oneOf()
    nondet kind = Set("change", "react", "delete").oneOf()
    any {
      send(k), refuse(k, later), drop(k), resend(k), lost(k), crash, retry(k), discard(k), uploadFail(k), loseThread(k),
      queueAction(k, kind), actFail(k), actRefuse(k), dismissAction(k), deleteElsewhere(k), remoteChange(k, "gone"), remoteChange(k, "reply"),
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
  action failedRootStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) sendReply(2, 1) else
    if (turn == 3) refuse(1, false) else
    if (turn == 4) refused(1) else
    if (turn == 5) retry(1) else
    if (turn == 6) claim(1) else
    if (turn == 7) accept(1, false) else
    if (turn == 8) answer(1) else
    if (turn == 9) claim(2) else
    if (turn == 10) accept(2, true) else
    seal
  ) }

  action pendingRootStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) sendReply(2, 1) else
    if (turn == 3) accept(1, true) else
    if (turn == 4) echo(1) else
    if (turn == 5) answer(1) else
    if (turn == 6) claim(2) else
    if (turn == 7) accept(2, true) else
    seal
  ) }

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

  // A reaction on a stored message that another client deleted meanwhile:
  // Slack refuses it, the row waits as failed, and the user dismisses it.
  // The bug counts `message_not_found` as the reaction made.
  action reactionOnGoneWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, false) else
    if (turn == 3) answer(1) else
    if (turn == 4) queueAction(1, "react") else
    if (turn == 5) deleteElsewhere(1) else
    if (turn == 6) runAction(1) else
    if (turn == 7) (if (guard) actRefuse(1) else actAcceptWith(1, false)) else
    if (turn == 8) (if (guard) dismissAction(1) else actAnswer(1)) else
    seal
  ) }
  action reactionOnGoneStep = reactionOnGoneWith(true)
  action reactionOnGoneBugStep = reactionOnGoneWith(false)
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
  // The user deletes a post whose answer was lost, and the lookup finds
  // Slack never ran it: the delete applies to the row, which goes. The bug
  // puts the row back in the queue with the delete waiting on it, so the
  // worker posts it and then deletes it, and everyone else saw it.
  action deleteWhileUnknownWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) drop(1) else
    if (turn == 3) lost(1) else
    if (turn == 4) queueAction(1, "delete") else
    if (turn == 5) wake(1) else
    if (turn == 6) lookup(1) else
    if (turn == 7) { nondet f = s.fetches.oneOf(); finishFetchWith(f, guard) } else
    seal
  ) }
  action deleteWhileUnknownStep = deleteWhileUnknownWith(true)
  action deleteWhileUnknownBugStep = deleteWhileUnknownWith(false)

  // A reply's answer is lost, and its thread's root is deleted before the
  // lookup asks: Slack refuses the read for good. The row fails, for Retry
  // or Delete draft, and the channel's later posts go. The bug asks again
  // with backoff, forever, and never drains.
  action refusedLookupWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) (if (guard) progress else any { lookup(1), { nondet f = s.fetches.oneOf(); refuseFetchWith(f, false) } }) else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) drop(1) else
    if (turn == 3) lost(1) else
    if (turn == 4) loseThread(1) else
    if (turn == 5) wake(1) else
    if (turn == 6) lookup(1) else
    if (turn == 7) { nondet f = s.fetches.oneOf(); refuseFetchWith(f, guard) } else
    seal
  ) }
  action refusedLookupStep = refusedLookupWith(true)
  action refusedLookupBugStep = refusedLookupWith(false)

  // A root started from Home is refused, and the user deletes the draft
  // while a reply waits on it. The reply goes with the root. The bug leaves
  // it queued forever: nothing can claim it without a root, and it never
  // fails, so it shows as sending in a thread with no root.
  action discardedRootWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) sendReply(2, 1) else
    if (turn == 3) refuse(1, false) else
    if (turn == 4) refused(1) else
    if (turn == 5) discardWith(1, guard) else
    seal
  ) }
  action discardedRootStep = discardedRootWith(true)
  action discardedRootBugStep = discardedRootWith(false)

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

  // The user deletes the message in Juno before Juno has stored its
  // network copy. When the copy arrives it is hidden and deleted too. The
  // bug takes the user's delete for one made elsewhere and keeps the copy
  // as the message, so the deleted post comes back.
  action ownDeleteWith(guard: bool): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (copyHidden(turn)) copySetup else
    if (turn == 6) queueAction(1, "delete") else
    if (turn == 7) runAction(1) else
    if (turn == 8) actAccept(1) else
    if (turn == 9) actAnswer(1) else
    if (turn == 10) observeCopyAs(1, true, not(guard)) else
    if (turn == 11 and guard) deleteCopy(1) else
    seal
  ) }
  action ownDeleteStep = ownDeleteWith(true)
  action ownDeleteBugStep = ownDeleteWith(false)

  // Two messages in one channel: a reaction passes a retrying edit.
  // The engine tests also seed legacy attempts of 3816 before a restart.
  action boundedActionStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, false) else
    if (turn == 3) answer(1) else
    if (turn == 4) send(2) else
    if (turn == 5) claim(2) else
    if (turn == 6) accept(2, false) else
    if (turn == 7) answer(2) else
    if (turn == 8) all { s' = { ...s, actChannel: s.actChannel.set(2, 1) } } else
    if (turn == 9) queueAction(1, "change") else
    if (turn == 10) queueAction(2, "react") else
    if (turn == 11) runAction(1) else
    if (turn == 12) actFail(1) else
    if (turn == 13) all { s.act.get(1) == "waiting", runAction(2) } else
    if (turn == 14) actAccept(2) else
    if (turn == 15) actAnswer(2) else
    if (turn >= 16 and turn <= 23) (if (turn % 2 == 0) runAction(1) else actFail(1)) else
    all { s.act.get(1) == "failed", seal }
  ) }
  action expiredReactionStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, false) else
    if (turn == 3) answer(1) else
    if (turn == 4) goOffline else
    if (turn == 5) queueAction(1, "react") else
    if (turn == 6) expireReaction(1) else
    if (turn == 7) all { s.act.get(1) == "failed", dismissAction(1) } else seal
  ) }
  action defectActionStep = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (turn == 0) send(1) else
    if (turn == 1) claim(1) else
    if (turn == 2) accept(1, false) else
    if (turn == 3) answer(1) else
    if (turn == 4) queueAction(1, "change") else
    if (turn == 5) runAction(1) else
    if (turn == 6) actDefect(1) else
    if (turn == 7) all { s.act.get(1) == "failed", seal } else progress
  ) }

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

  // As `deletedOffline`, but the recheck after the reconnect does not read
  // the post's topic, so the store never learns the kept message is gone.
  // The guarded delete needs the topic read again and keeps the copy. The
  // bug waits for the catch-up only, then deletes the copy.
  action uncoveredRecheckWith(check: str): bool = all { not(reachedAgreement), tick(
    if (s.sealed) progress else
    if (copyHidden(turn)) copySetup else
    if (turn == 6) observeCopy(1) else
    if (turn == 7) disconnect else
    if (turn == 8) remoteChange(1, "gone") else
    if (turn == 9) reconnect else
    if (turn == 10) startFetch(1, "catchup") else
    if (turn == 11) { nondet f = s.fetches.oneOf(); finishFetch(f) } else
    if (turn == 12) catchUpWith(Set()) else
    if (turn == 13) (if (check == "full") keepCopy(1) else deleteCopyWith(1, true, check)) else
    seal
  ) }
  action uncoveredRecheckStep = uncoveredRecheckWith("full")
  action uncoveredRecheckBugStep = uncoveredRecheckWith("noRecheck")
}

module outbox {
  import outboxProtocol(drafts = Set(1, 2), fetchLimit = 2, drainLimit = 48).*
}

// Companion to outboxProtocol: an edit and a broadcast of the same stored
// reply occupy separate rows. Content, post creation, delete and wall-clock
// backoff remain in the main model. Here the socket echo may never arrive.
module broadcastOutbox {
  var b: { rows: int -> str, order: List[int], flight: int,
    serverBroadcast: bool, localBroadcast: bool, edited: bool, attempts: int -> int }
  var tick: int
  action init = all {
    b' = { rows: Map(1 -> "none", 2 -> "none"), order: [], flight: 0,
      serverBroadcast: false, localBroadcast: false, edited: false, attempts: Map(1 -> 0, 2 -> 0) },
    tick' = 0
  }
  // 1 is an edit (text only), 2 a broadcast (reply_broadcast only).
  action queue(k: int): bool = all {
    b.rows.get(k) == "none",
    b' = { ...b, rows: b.rows.set(k, "waiting"), order: b.order.append(k) }
  }
  def pending(k: int): bool = Set("waiting", "transit", "accepted", "checking").contains(b.rows.get(k))
  action startCall(k: int): bool = all {
    b.flight == 0, b.rows.get(k) == "waiting",
    b.order.select(j => pending(j)).head() == k,
    b' = { ...b, flight: k, rows: b.rows.set(k, "transit") }
  }
  action accept = all {
    b.flight != 0, b.rows.get(b.flight) == "transit",
    b.flight == 1 or not(b.serverBroadcast),
    b' = { ...b, rows: b.rows.set(b.flight, "accepted"),
      edited: b.edited or b.flight == 1, serverBroadcast: b.serverBroadcast or b.flight == 2 }
  }
  action answer = all {
    b.flight != 0, b.rows.get(b.flight) == "accepted",
    b' = { ...b, flight: 0, rows: b.rows.set(b.flight, "done"),
      localBroadcast: b.localBroadcast or b.flight == 2 }
  }
  // A lost answer, failed lookup or transient refusal consumes the same
  // persisted retry budget. The next edit waits while the broadcast waits.
  action loseExchange = all {
    b.flight != 0,
    b' = { ...b, flight: 0, attempts: b.attempts.set(b.flight, b.attempts.get(b.flight) + 1),
      rows: b.rows.set(b.flight, if (b.attempts.get(b.flight) >= 4) "failed" else "waiting") }
  }
  action refuse = all {
    b.flight == 2, b.rows.get(2) == "transit",
    b' = { ...b, rows: b.rows.set(2, "checking") }
  }
  // cant_broadcast_message means either already broadcast or forbidden.
  // A bounded history lookup distinguishes them before ending the row.
  action lookupWith(guard: bool): bool = all {
    b.flight == 2, b.rows.get(2) == "checking",
    b' = { ...b, flight: 0, rows: b.rows.set(2, if (guard and b.serverBroadcast) "done" else "dropped"),
      localBroadcast: if (guard) b.serverBroadcast else b.localBroadcast }
  }
  action echo = all {
    b.serverBroadcast, not(b.localBroadcast), b' = { ...b, localBroadcast: true }
  }
  val invariants = all {
    Set("done", "dropped").contains(b.rows.get(2)) implies b.localBroadcast == b.serverBroadcast,
    b.localBroadcast implies b.serverBroadcast,
    Set(1, 2).forall(k => b.attempts.get(k) <= 5),
    b.flight == 0 or b.rows.get(b.flight) != "waiting"
  }
  action simulationStep = all {
    any { queue(1), queue(2), startCall(1), startCall(2), accept, answer, loseExchange, refuse, lookupWith(true), echo },
    tick' = tick + 1
  }
  action lostWith(guard: bool): bool = all {
    if (tick == 0) queue(2) else if (tick == 1) queue(1) else
    if (tick == 2) startCall(2) else if (tick == 3) accept else
    if (tick == 4) loseExchange else if (tick == 5) startCall(2) else
    if (tick == 6) refuse else if (tick == 7) lookupWith(guard) else
    if (tick == 8) startCall(1) else if (tick == 9) accept else answer,
    tick' = tick + 1
  }
  action lostStep = lostWith(true)
  action lostBugStep = lostWith(false)
}
