// Topic drafts synced with Slack (SPEC 8 "Drafts", architecture 5.7,
// research slack-drafts.md): one topic's draft in Juno, its composer, and
// Slack's draft for the same place, which another device (a phone) also
// edits.
//
// Texts are integers and every edit makes a new one, so a text names one
// edit; 0 is no draft. `clock` is one wall clock: typing on either device
// and Slack's update stamps read it. The rule that compares a local edit's
// time with Slack's stamp assumes Juno's clock and Slack's agree; the model
// makes them one clock.
//
// Juno's side: the stored draft (`local`), what Juno knows of Slack's draft
// (`local.id`, `local.stamp`, `local.seenAt`), and one pending row for
// changes Slack has not acknowledged (`row`), whose generation every newer
// change bumps. The sender sends the stored text when it goes: an update
// with Slack's id, a create when Juno knows none, a delete for a cleared
// draft. Slack keeps one draft per place: a create there answers
// `attached_draft_exists`, and Juno lists before it creates again, as it
// does after a create whose answer was lost; that list takes the place's
// draft whatever its stamp while Juno links none. A message sent from the
// draft names it (`draft_id`) and Slack retires it; only a refused post
// leaves it, and Juno then deletes it. Slack never reuses a draft id, so
// Juno ignores versions of the ids it deleted, sent or saw deleted (`gone`).
//
// A version from Slack (an event, a list entry) is stale when it is no
// newer than the newest stamp Juno has seen, or of a draft that is gone. It
// is Juno's own when its text is the one Juno has, is sending, or sent in a
// call whose answer was lost (until a list after the loss); Juno's text that
// has moved on goes over it. It loses to a newer local edit Slack has not
// acknowledged, which then goes over it. Otherwise it replaces the draft,
// and is saved again when a save was out or lost, since that save may land
// after it. A lost call landed before Juno gave up on it, or never. A linked
// draft missing from a list requested after Juno linked it counts as
// deleted just after the version Juno knew. A catch-up needs a list
// requested after the socket came back and after Juno's link, with no call
// out.
//
// The composer takes a changed stored draft at once, unless it has typing
// not yet stored, or it has focus and was typed in since it showed: then it
// is `behind`, keeps its text, and takes the stored one when it loses focus
// with nothing typed since. Typing first stores its own text, which is newer.
//
// Each switch exists only so a bug schedule can show what one rule prevents.
module draftsProtocol {
  const drainLimit: int
  const eventLimit: int

  type Version = { id: int, text: int, stamp: int }
  // `seenAt` is when Juno linked the draft `id`, on its clock.
  type Local = { text: int, editedAt: int, id: int, stamp: int, seenAt: int }
  // `sending` is the text of the call in flight (-1 for none, 0 for a delete); `unsure` the texts of calls
  // whose answers were lost, until a list after the last loss (`unsureAt`); `findAt` when a create's
  // answer was lost or Slack said the place has a draft (0 for none); `sent` the drafts of refused posts,
  // to delete.
  type Row = { on: bool, gen: int, sending: int, unsure: Set[int], unsureAt: int, findAt: int, sent: Set[int] }
  type Call = { on: bool, op: str, text: int, id: int, gen: int, accepted: bool, answer: str, answerId: int, answerStamp: int }
  type Rules = { echoCheck: bool, resave: bool, tombstone: bool, hold: bool, seenGuard: bool }
  type State = {
    clock: int, nextText: int, nextId: int,
    // Slack's draft for the place; id 0 is none.
    slack: Version,
    local: Local, row: Row, call: Call,
    // Slack drafts Juno deleted or saw deleted.
    gone: Set[int],
    events: Set[Version], fetching: bool, fetchAt: int, fetched: Version,
    connected: bool, catchup: bool, connectedAt: int, listed: bool,
    // A message posted from the draft, naming Slack's draft.
    posting: bool, postDraft: int,
    // The composer.
    focused: bool, typed: bool, field: int, unsaved: bool, behind: bool,
    sealed: bool, label: str,
    // What the properties read.
    typedAt: int -> int, decidedAt: int -> int, sentTexts: Set[int], lost: Set[int], focusBroken: bool,
    firstNewer: int, editedSinceStart: bool
  }

  var s: State
  var remaining: int

  pure val none: Version = { id: 0, text: 0, stamp: 0 }
  pure val noCall: Call = { on: false, op: "", text: 0, id: 0, gen: 0, accepted: false, answer: "", answerId: 0, answerStamp: 0 }
  pure val rules: Rules = { echoCheck: true, resave: true, tombstone: true, hold: true, seenGuard: true }

  // The first run after sync ships: a draft Juno kept before (never in Slack,
  // so pending), Slack's draft for the place, both, or neither. Text 1 is
  // Juno's, typed at `junoAt`; text 2 is Slack's, typed at `slackAt`.
  action initWith(junoAt: int, slackAt: int): bool = {
    val juno = if (junoAt > 0) 1 else 0
    val phone = if (slackAt > 0) 2 else 0
    all {
      s' = {
        clock: 3, nextText: 3, nextId: 2,
        slack: if (slackAt > 0) { id: 1, text: phone, stamp: slackAt } else none,
        local: { text: juno, editedAt: junoAt, id: 0, stamp: 0, seenAt: 0 },
        row: { on: junoAt > 0, gen: if (junoAt > 0) 1 else 0, sending: -1, unsure: Set(), unsureAt: 0, findAt: 0, sent: Set() },
        call: noCall, gone: Set(), events: Set(), fetching: false, fetchAt: 0, fetched: none,
        connected: true, catchup: true, connectedAt: 3, listed: false,
        posting: false, postDraft: 0,
        focused: false, typed: false, field: juno, unsaved: false, behind: false,
        sealed: false, label: "init",
        typedAt: Map(1 -> junoAt, 2 -> slackAt), decidedAt: Map(), sentTexts: Set(), lost: Set(), focusBroken: false,
        firstNewer: if (junoAt == 0 and slackAt == 0) 0 else if (junoAt > slackAt) juno else phone,
        editedSinceStart: false
      },
      remaining' = drainLimit
    }
  }
  // The directed schedules start from no draft on either side, or from the first run's two drafts.
  action initFresh = initWith(0, 0)
  action initFirstRun = initWith(1, 2)
  action init = {
    nondet junoAt = Set(0, 1, 2).oneOf()
    nondet slackAt = Set(0, 1, 2).oneOf()
    all { junoAt == 0 or slackAt == 0 or junoAt != slackAt, initWith(junoAt, slackAt) }
  }

  // The composer after the stored draft became `stored`.
  pure def react(st: State, stored: int, hold: bool): State =
    if (stored == st.field or st.unsaved) st
    else if (hold and st.focused and st.typed) { ...st, behind: true }
    else { ...st, field: stored, behind: false, focusBroken: st.focusBroken or (st.focused and st.typed) }

  // When a text was typed; a deletion is as old as its stamp.
  pure def versionAt(st: State, text: int, stamp: int): int = if (text == 0) stamp else st.typedAt.get(text)

  // A version from Slack, by the rules above. `seenAt` is Juno's clock when it
  // learned of it; `absent` is a list without the draft; `find` is a list
  // that looks for the place's draft after a lost create or
  // `attached_draft_exists`, while Juno knows no draft there: its entry is the
  // place's draft whatever its stamp.
  pure def observe(st: State, v: Version, seenAt: int, absent: bool, find: bool, r: Rules): State = {
    val l = st.local
    val stale = (not(absent) and not(find) and l.stamp >= v.stamp) or (r.tombstone and st.gone.contains(v.id))
    val own = r.echoCheck and (st.row.sending == v.text or st.row.unsure.contains(v.text))
    val same = v.text == l.text or own
    val kept = st.row.on and l.editedAt > v.stamp
    val known = not(stale)
    val applies = known and not(same) and not(kept)
    // Juno's text replaced by an older version, or an older version of a draft the user changed in Juno.
    val older = applies and ((l.text != 0 and versionAt(st, v.text, v.stamp) < l.editedAt) or
      (st.decidedAt.keys().contains(v.id) and versionAt(st, v.text, v.stamp) < st.decidedAt.get(v.id)))
    val after = { ...st, clock: st.clock + 1, lost: if (older) st.lost.union(Set(l.text)) else st.lost }
    if (not(known)) after
    // Juno's own older text in Slack, or a newer local edit: Juno's text goes over it.
    else if (not(applies)) { ...after, local: { ...l, id: if (v.text == 0) 0 else v.id, stamp: if (absent or v.stamp < l.stamp) l.stamp else v.stamp, seenAt: if (v.id == l.id) l.seenAt else seenAt },
      gone: if (v.text == 0) st.gone.union(Set(v.id)) else st.gone,
      row: if (v.text != l.text and not(st.row.on)) { ...st.row, on: true, gen: st.row.gen + 1 } else st.row }
    else react({ ...after,
      local: { text: v.text, editedAt: v.stamp, id: if (v.text == 0) 0 else v.id, stamp: if (v.stamp < l.stamp) l.stamp else v.stamp, seenAt: if (v.id == l.id) l.seenAt else seenAt },
      gone: if (v.text == 0) st.gone.union(Set(v.id)) else st.gone,
      row: if (r.resave and (st.row.sending >= 0 or st.row.unsure.size() > 0)) { ...st.row, gen: st.row.gen + 1 }
        else if (st.row.sent.size() > 0) { ...st.row, gen: st.row.gen + 1 }
        else { ...st.row, on: false } }, v.text, r.hold)
  }

  // Typing in the focused composer: a new text, or clearing it.
  action typeText(clear: bool): bool = {
    val t = if (clear) 0 else s.nextText
    all {
      not(s.sealed), s.focused, t != s.field,
      s' = { ...s, clock: s.clock + 1, nextText: s.nextText + 1,
        field: t, typed: true, unsaved: true, behind: false,
        typedAt: if (clear) s.typedAt else s.typedAt.put(t, s.clock + 1),
        editedSinceStart: true, label: "type" }
    }
  }
  // A pause in typing (or leaving the field): the composer stores its text, a local change.
  action pause = all {
    s.unsaved,
    s' = { ...s, clock: s.clock + 1,
      decidedAt: if (s.local.id != 0) s.decidedAt.put(s.local.id, if (s.field == 0) s.clock + 1 else s.typedAt.get(s.field)) else s.decidedAt,
      local: { ...s.local, text: s.field, editedAt: if (s.field == 0) s.clock + 1 else s.typedAt.get(s.field) },
      row: { ...s.row, on: s.field != 0 or s.local.id != 0 or s.row.on, gen: s.row.gen + 1 },
      unsaved: false, label: "store" }
  }
  action focus = all { not(s.sealed), not(s.focused), s' = { ...s, focused: true, label: "focus" } }
  // Leaving the field takes the draft it held back. Typing is stored first.
  action blur = all {
    s.focused, not(s.unsaved),
    s' = { ...s, focused: false, field: if (s.behind) s.local.text else s.field, behind: false, label: "blur" }
  }
  // Enter: the text goes as a message. The draft is cleared, and Slack's
  // draft, if Juno knows one, goes with the post and is gone.
  action sendWith(r: Rules): bool = {
    val id = s.local.id
    all {
      not(s.sealed), s.focused, s.field != 0, not(s.posting),
      s' = { ...s, clock: s.clock + 1, sentTexts: s.sentTexts.union(Set(s.field)), decidedAt: if (id != 0) s.decidedAt.put(id, s.clock + 1) else s.decidedAt,
        field: 0, unsaved: false, behind: false,
        local: { ...s.local, text: 0, editedAt: s.clock + 1, id: 0 },
        gone: if (id != 0 and r.tombstone) s.gone.union(Set(id)) else s.gone,
        row: if (s.row.on) { ...s.row, gen: s.row.gen + 1 } else s.row,
        posting: true, postDraft: id, editedSinceStart: true, label: "send" }
    }
  }
  action send = sendWith(rules)
  // Slack takes the post and retires the draft it names (`draft_send`).
  action postLands = {
    val drops = s.postDraft != 0 and s.slack.id == s.postDraft
    all {
      s.posting,
      s' = { ...s, clock: s.clock + 1, posting: false, postDraft: 0,
        slack: if (drops) none else s.slack,
        events: if (s.connected and drops) s.events.union(Set({ id: s.postDraft, text: 0, stamp: s.clock + 1 })) else s.events,
        label: "postLands" }
    }
  }
  // Slack refuses the post: its draft stays, so Juno deletes it.
  action postRefused = all {
    not(s.sealed), s.posting,
    s' = { ...s, posting: false, postDraft: 0,
      row: if (s.postDraft != 0) { ...s.row, on: true, sent: s.row.sent.union(Set(s.postDraft)) } else s.row,
      label: "postRefused" }
  }

  // Another device types in Slack's draft, or deletes it (clearing or sending it).
  action phoneType = {
    val v = { id: if (s.slack.id == 0) s.nextId else s.slack.id, text: s.nextText, stamp: s.clock + 1 }
    all {
      not(s.sealed), s.events.size() < eventLimit,
      s' = { ...s, clock: s.clock + 1, nextText: s.nextText + 1, nextId: s.nextId + 1, slack: v,
        typedAt: s.typedAt.put(s.nextText, s.clock + 1),
        events: if (s.connected) s.events.union(Set(v)) else s.events,
        editedSinceStart: true, label: "phoneType" }
    }
  }
  action phoneDelete = all {
    not(s.sealed), s.slack.id != 0, s.events.size() < eventLimit,
    s' = { ...s, clock: s.clock + 1, slack: none,
      events: if (s.connected) s.events.union(Set({ id: s.slack.id, text: 0, stamp: s.clock + 1 })) else s.events,
      editedSinceStart: true, label: "phoneDelete" }
  }

  // The sender takes the row: what the stored draft needs now. A sent draft
  // waits for its post, then is deleted before anything else goes.
  action request = {
    val l = s.local
    val sentId = s.row.sent.fold(0, (a, b) => if (b > a) b else a)
    val op = if (sentId != 0) "deleteSent"
      else if (l.text != 0 and l.id != 0) "update"
      else if (l.text != 0) "create"
      else if (l.id != 0) "delete"
      else "nothing"
    all {
      s.connected, s.row.on, not(s.call.on),
      // A create whose answer was lost may have made a draft, or Slack has one Juno has not seen: a list looks first.
      not((op == "create" or op == "nothing") and s.row.findAt > 0),
      s' = if (op == "nothing") { ...s, row: { ...s.row, on: false, sending: -1 }, label: "request" }
        else { ...s,
          call: { ...noCall, on: true, op: op, text: if (op == "deleteSent") -1 else l.text, id: if (op == "deleteSent") sentId else l.id, gen: s.row.gen },
          row: { ...s.row, sending: if (op == "deleteSent") -1 else l.text },
          label: "request" }
    }
  }

  // Slack runs the call. Every write it makes is echoed on the socket.
  action accept = {
    val c = s.call
    val found = c.id != 0 and s.slack.id == c.id
    val occupied = c.op == "create" and s.slack.id != 0
    val written = if (occupied) s.slack
      else if (c.op == "create") { id: s.nextId, text: c.text, stamp: s.clock + 1 }
      else if (c.op == "update" and found) { id: c.id, text: c.text, stamp: s.clock + 1 }
      else if ((c.op == "delete" or c.op == "deleteSent") and found) none
      else s.slack
    val wrote = (c.op == "create" and not(occupied)) or found
    val echo = if (written.id == 0) { id: c.id, text: 0, stamp: s.clock + 1 } else written
    all {
      c.on, not(c.accepted), s.events.size() < eventLimit,
      s' = { ...s, clock: s.clock + 1, nextId: if (c.op == "create" and not(occupied)) s.nextId + 1 else s.nextId, slack: written,
        events: if (s.connected and wrote) s.events.union(Set(echo)) else s.events,
        call: { ...c, accepted: true,
          answer: if (occupied) "exists" else if (c.op == "create" or (c.op == "update" and found)) "saved" else if (c.op == "update") "notFound" else "deleted",
          answerId: written.id, answerStamp: s.clock + 1 },
        label: "accept" }
    }
  }

  // The answer. The row ends unless a newer change replaced its intent; an
  // update of a draft Slack no longer has becomes a create. A deleted draft
  // is gone for good.
  action respondWith(r: Rules): bool = {
    val c = s.call
    val l = s.local
    val sent = if (c.op == "deleteSent") s.row.sent.exclude(Set(c.id)) else s.row.sent
    // A save of a draft Juno has since seen deleted: the text goes again, as a new draft.
    val goneSave = c.answer == "saved" and r.tombstone and s.gone.contains(c.answerId)
    // Deleting a sent draft says nothing about the text typed since: the sender looks again.
    // A delete covers the draft it named: one linked meanwhile still needs its own.
    val covered = c.answer != "deleted" or l.id == c.id or l.id == 0
    val done = c.op != "deleteSent" and c.gen == s.row.gen and sent.size() == 0 and c.answer != "notFound" and c.answer != "exists" and not(goneSave) and
      (s.row.findAt == 0 or c.answer == "saved") and covered
    val newer = if (c.answerStamp > l.stamp) c.answerStamp else l.stamp
    all {
      c.on, c.accepted,
      s' = { ...s, clock: s.clock + 1, call: noCall,
        // A save's answer older than a draft Juno has linked since does not replace the link.
        local: if (goneSave or (c.answer == "saved" and l.id != 0 and l.id != c.answerId and c.answerStamp < l.stamp)) l
          else if (c.answer == "saved") { ...l, id: c.answerId, stamp: newer, seenAt: if (c.answerId == l.id) l.seenAt else s.clock + 1 }
          else if (c.answer == "exists") l
          else if (c.answer == "notFound") { ...l, id: if (l.id == c.id) 0 else l.id, seenAt: s.clock + 1 }
          else { ...l, id: if (l.id == c.id) 0 else l.id, seenAt: s.clock + 1 },
        gone: if ((c.answer == "deleted" or c.answer == "notFound") and r.tombstone) s.gone.union(Set(c.id)) else s.gone,
        catchup: s.catchup or c.answer == "exists",
        row: { ...s.row, on: not(done), sending: -1, sent: sent,
          findAt: if (c.answer == "exists") s.clock + 1 else if (c.answer == "saved" and not(goneSave)) 0 else s.row.findAt },
        label: "respond" }
    }
  }
  action respond = respondWith(rules)
  // The answer is lost, or the call failed on the way. The row stays, and so
  // does the text it sent, until the next answer: Slack may have it, so its
  // echo is still Juno's own and a version applied meanwhile is saved again.
  action lose = all {
    not(s.sealed), s.call.on,
    s' = { ...s, clock: s.clock + 1, call: noCall,
      row: { ...s.row, sending: -1, unsure: if (s.row.sending >= 0) s.row.unsure.union(Set(s.row.sending)) else s.row.unsure,
        unsureAt: s.clock + 1, findAt: if (s.call.op == "create") s.clock + 1 else s.row.findAt },
      catchup: true,
      label: "lose" }
  }

  action deliverWith(r: Rules): bool = {
    nondet v = s.events.oneOf()
    all {
      s.connected,
      s' = { ...observe(s, v, s.clock + 1, false, false, r), events: s.events.exclude(Set(v)), label: "deliver" }
    }
  }
  action deliver = deliverWith(rules)

  // A list of Slack's drafts, at each catch-up and on demand.
  action startList = all {
    s.connected, not(s.fetching),
    s' = { ...s, clock: s.clock + 1, fetching: true, fetchAt: s.clock + 1, fetched: s.slack, label: "startList" }
  }
  action finishListWith(r: Rules): bool = {
    val gone = s.fetched.id == 0 and s.local.id != 0 and (not(r.seenGuard) or s.fetchAt > s.local.seenAt)
    val find = s.row.findAt > 0 and s.fetchAt > s.row.findAt and s.local.id == 0
    val seen = if (s.fetched.id != 0) observe(s, s.fetched, s.fetchAt, false, find, r)
      else if (gone) observe(s, { id: s.local.id, text: 0, stamp: s.local.stamp }, s.fetchAt, true, false, r)
      else s
    // A list requested after a lost create, or after Slack said the place has a draft, has shown it;
    // one requested after the last lost answer has shown what those calls left.
    val found = if (seen.row.findAt > 0 and s.fetchAt > seen.row.findAt) { ...seen, row: { ...seen.row, findAt: 0 } } else seen
    val observed = if (s.fetchAt > found.row.unsureAt) { ...found, row: { ...found.row, unsure: Set() } } else found
    all {
      s.fetching,
      // Only a list requested since the socket came back is its catch-up, and
      // only one requested after Juno linked its draft, with no call out: an
      // answer can name a draft the list did not see. Another list follows.
      s' = { ...observed, fetching: false, listed: true,
        catchup: (s.catchup and s.fetchAt <= s.connectedAt) or s.call.on or (observed.local.id != 0 and s.fetchAt <= observed.local.seenAt),
        label: "finishList" }
    }
  }
  action finishList = finishListWith(rules)

  action disconnect = all {
    not(s.sealed), s.connected,
    s' = { ...s, connected: false, events: Set(), label: "disconnect" }
  }
  action reconnect = all { not(s.connected), s' = { ...s, clock: s.clock + 1, connected: true, catchup: true, connectedAt: s.clock + 1, label: "reconnect" } }
  // Juno quits with nothing typed unstored (quitting stores it) and starts again.
  // A call that was out counts as one whose answer was lost.
  action restart = all {
    not(s.sealed), not(s.unsaved),
    s' = { ...s, clock: s.clock + 1, call: noCall, events: Set(), fetching: false,
      row: { ...s.row, sending: -1,
        unsure: if (s.row.sending >= 0) s.row.unsure.union(Set(s.row.sending)) else s.row.unsure,
        unsureAt: if (s.row.sending >= 0) s.clock + 1 else s.row.unsureAt,
        findAt: if (s.call.on and s.call.op == "create") s.clock + 1 else s.row.findAt },
      connected: true, catchup: true, connectedAt: s.clock + 1, listed: false,
      focused: false, typed: false, field: s.local.text, behind: false, label: "restart" }
  }
  action seal = all { not(s.sealed), s' = { ...s, sealed: true, label: "seal" } }

  val quiet = s.sealed and not(s.row.on) and not(s.call.on) and s.events.size() == 0 and not(s.fetching) and
    s.connected and not(s.catchup) and not(s.posting) and not(s.unsaved) and not(s.behind) and not(s.focused)
  val agreed = s.local.text == s.slack.text and s.field == s.local.text and (s.local.text == 0 or s.local.id == s.slack.id)
  // Once all is quiet, Juno and Slack agree.
  val quietAgreement = quiet implies agreed
  // Typed text is never lost: Juno's text is replaced only by a version typed
  // after it, and a draft the user changed or sent in Juno never takes back
  // a version from before that (a deletion counts from its stamp).
  val typedNeverLost = s.lost == Set()
  // A focused composer that was typed in is never overwritten.
  val focusKept = not(s.focusBroken)
  // A sent draft does not come back.
  val sentStaysGone = not(s.sentTexts.contains(s.local.text)) and not(s.sentTexts.contains(s.field))
  // The first run merges Juno's old draft and Slack's by the same rule: the newer one stays.
  val firstRunMerged = (quiet and not(s.editedSinceStart)) implies s.local.text == s.firstNewer
  val reachedAgreement = quiet and agreed
  val drainBound = remaining > 0 or reachedAgreement
  val invariants = quietAgreement and typedNeverLost and focusKept and sentStaysGone and firstRunMerged and drainBound

  action work = any { request, accept, respond, pause, blur, postLands, startList, deliver, finishList, reconnect }
  action input = any { typeText(false), typeText(true), focus, send, postRefused, phoneType, phoneDelete, lose, disconnect, restart, seal }
  action tick(a: bool): bool = all {
    a, remaining' = if (s.sealed and not(quiet)) remaining - 1 else remaining
  }
  action progress = any { work, all { quiet, s' = { ...s, label: "idle" } } }
  action step = tick(if (s.sealed) progress else any { input, progress })
  action simulationStep = all { not(reachedAgreement), step }

  // Directed schedules. Each starts from `initFresh` (the first run's from
  // `initFirstRun`), seals after its last scripted step and drains with the
  // real rules.

  // Juno's save is in flight; more is typed and stored; Slack's echo of the
  // save arrives before its answer. Without the echo check the newer typing
  // is replaced by the older text Juno sent.
  action echoRace(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") startList else
    if (s.label == "startList") finishList else
    if (s.label == "finishList") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type" and s.row.gen == 0) pause else
    if (s.label == "store" and not(s.call.on)) request else
    if (s.label == "request") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") accept else
    if (s.label == "accept") deliverWith(r) else
    seal
  )
  action echoRaceStep = echoRace(rules)
  action echoRaceBugStep = echoRace({ ...rules, echoCheck: false })

  // The phone types while Juno's update is in flight; its event applies before
  // Juno's answer, but Juno's update lands after it. Without saving the
  // applied version again, Slack keeps Juno's older text and Juno shows the
  // phone's.
  action inflightApply(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") startList else
    if (s.label == "startList") finishList else
    if (s.label == "finishList") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type" and s.nextText == 4) pause else
    if (s.label == "store" and s.nextText == 4) request else
    if (s.label == "request" and s.nextText == 4) accept else
    if (s.label == "accept" and s.nextText == 4) respond else
    if (s.label == "respond" and s.nextText == 4) deliver else
    if (s.label == "deliver" and s.nextText == 4) typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") blur else
    if (s.label == "blur") request else
    if (s.label == "request") phoneType else
    if (s.label == "phoneType") deliverWith(r) else
    if (s.label == "deliver" and s.call.on and not(s.call.accepted)) accept else
    if (s.label == "accept") respond else
    seal
  )
  action inflightApplyStep = inflightApply(rules)
  action inflightApplyBugStep = inflightApply({ ...rules, resave: false })

  // The phone edits the draft Juno is about to send, and a list catches the
  // edit before the send, but finishes after Slack retired the draft with the
  // post. Without remembering the sent draft, the phone's older version of
  // it comes back over the send.
  action sentReturns(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") startList else
    if (s.label == "startList" and not(s.listed)) finishList else
    if (s.label == "finishList" and s.sentTexts.size() == 0 and s.local.text == 0 and s.slack.id == 0) focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") request else
    if (s.label == "request") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") deliver else
    if (s.label == "deliver") phoneType else
    if (s.label == "phoneType") startList else
    if (s.label == "startList") sendWith(r) else
    if (s.label == "send") postLands else
    if (s.label == "postLands") finishListWith(r) else
    seal
  )
  action sentReturnsStep = sentReturns(rules)
  action sentReturnsBugStep = sentReturns({ ...rules, tombstone: false })

  // The phone changes the draft while the composer has focus and was typed
  // in. Without holding it back, the field changes under the caret.
  action focusedRemote(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") startList else
    if (s.label == "startList") finishList else
    if (s.label == "finishList") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") request else
    if (s.label == "request") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") deliver else
    if (s.label == "deliver" and s.events.size() == 0 and s.slack.text == s.local.text and s.field == s.local.text) phoneType else
    if (s.label == "phoneType") deliverWith(r) else
    seal
  )
  action focusedRemoteStep = focusedRemote(rules)
  action focusedRemoteBugStep = focusedRemote({ ...rules, hold: false })

  // A list requested before Juno's create answered finishes after it, without
  // the new draft. Without the guard on when Juno learned of it, the draft
  // is deleted in Juno while Slack keeps it.
  action staleList(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") startList else
    if (s.label == "startList" and not(s.listed)) finishList else
    if (s.label == "finishList" and s.local.text == 0 and s.slack.id == 0) focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") blur else
    if (s.label == "blur") startList else
    if (s.label == "startList") request else
    if (s.label == "request") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") deliver else
    if (s.label == "deliver") finishListWith(r) else
    seal
  )
  action staleListStep = staleList(rules)
  action staleListBugStep = staleList({ ...rules, seenGuard: false })

  // The first run: Juno's old draft and a newer one in Slack for the same
  // place. Juno's create answers that the place has a draft; the list that
  // follows merges the two by the rule, and the newer one stays.
  action firstRunStep = tick(
    if (s.sealed) progress else
    if (s.label == "init") request else
    if (s.label == "request") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") startList else
    if (s.label == "startList") finishList else
    seal
  )

  // Typed offline; Juno restarts and the draft reaches Slack once it is back.
  action offlineRestartStep = tick(
    if (s.sealed) progress else
    if (s.label == "init") startList else
    if (s.label == "startList") finishList else
    if (s.label == "finishList") disconnect else
    if (s.label == "disconnect") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") blur else
    if (s.label == "blur") restart else
    seal
  )
}

module drafts {
  import draftsProtocol(drainLimit = 48, eventLimit = 6).*
}
