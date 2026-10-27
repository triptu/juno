// Topic drafts synced with Slack (SPEC 8 "Drafts", architecture 5.7,
// research slack-drafts.md): one topic's draft in Juno, its composer, and
// Slack's draft for the same place, which another device (a phone) also
// edits and attaches files to.
//
// Texts are integers and every edit makes a new one, so a text names one
// edit; 0 is no text. `clock` is real time in milliseconds: typing on either
// device and Slack's stamps read it, and each of those moves it on. Juno's
// own steps (an answer, a lost call, a delivery, a list) may fall in the same
// millisecond as the step before. Juno's clock reads `clock - skew` (`skew`
// is 0, or 2 for Juno running behind). The rule that compares a local edit's
// time with Slack's stamp is right only while the two clocks agree; when Juno
// runs behind, a newer local edit can lose, and its text is kept recoverable
// (`local.replaced`: ⌘Z in the composer).
//
// Juno's side: the stored draft (`local`), what Juno knows of Slack's draft
// (`local.id`, `stamp`, `seenAt`, `files`), and one pending row for changes
// Slack has not acknowledged (`row`), whose generation every newer change
// bumps. The sender reads the row (`read`) and later claims it in one
// transaction that reads the stored draft again (`claim`): an update with
// Slack's id, a create when Juno links none, or a delete for a draft the user
// cleared, and nothing else. Juno never writes to a draft with files: it shows its text and
// keeps typing there local. A user's clear keeps a time of its own, which its
// deletion carries; Slack refuses a time that is not plausible (`conflict`).
// Slack can refuse a text for good (too long): that settles the generation it
// sent, and a newer change still goes. An answer's files and stamp count only
// when it is newer than what Juno has seen of that draft. Slack keeps one
// draft per place: a create there answers `attached_draft_exists`, and Juno
// lists before it creates again, as after a create whose answer was lost;
// that list takes the place's draft whatever its stamp while Juno links none.
//
// A send asks Slack to delete nothing. A message sent from the draft names it
// when it goes to the draft's place and the draft has no files, and Slack
// retires it when the post lands. The draft stays linked until Juno sees it
// retired, so its versions keep coming in, and if Slack refuses the post it is
// the place's draft as it was; Juno writes nothing to it while the post waits,
// and typing done meanwhile goes on as a new draft once Slack retires it. A
// post that went elsewhere leaves Slack's draft where it is, and Juno stops
// linking it. Juno deletes a draft only for the user's clear: a late save of
// Juno's that lands after another device emptied the draft stays in Slack.
// Every send remembers the text it carried and Juno's own texts that can be
// on the draft it went from
// (`local.sent`), with that draft's id, or, for a create Juno had no answer
// to, its `client_msg_id` (`cmid`; the next create gets a new one): a version
// with one of those texts is never shown, whatever the clocks say, and is
// linked only if it is the draft Juno links or a list looks for a draft to
// write to. A record is settled once Slack shows its draft gone or holding
// another text; only settled records are forgotten (all but the newest).
// Slack never reuses a draft id, so Juno ignores versions of the ids it saw
// deleted or retired (`gone`).
//
// A version from Slack (an event, a list entry) is stale when it is no
// newer than the newest stamp Juno has seen, or of a draft that is gone. A
// deletion says so (`deleted`); a live draft of files alone is not one. A
// deletion of a draft Juno does not link only marks it gone. A version is
// Juno's own when its text is the one Juno has, is sending, or sent in a call
// whose answer was lost (until a list after the loss). It loses to a newer
// local edit Slack has not acknowledged, which then goes over it. Otherwise
// it replaces the draft, and is saved again when a save was out or lost,
// since that save may land after it; that resave (`row.resave`) is no local
// edit. A local edit it replaces is kept for ⌘Z (`replaced`) until a local
// action lets it go; a later version never replaces the kept text. A lost
// call landed before Juno gave up on it, or never.
//
// A list is a snapshot taken when it was requested. Its entry applies when
// it finishes; a linked draft it misses becomes a pending absence that a
// later step writes after reading the link again: only a draft still linked,
// and linked before the request, counts as deleted, just after the version
// Juno knew. A list settles only finds and losses from before its request
// (a strictly earlier millisecond). A list can fail; while a find, a loss or
// a catch-up is owed, another follows, in a later millisecond. A catch-up
// needs a list requested after the socket came back and after Juno's link,
// with no call out.
//
// The composer takes a changed stored draft at once, unless it has typing
// not yet stored, or it has focus and was typed in since it showed: then it
// is `behind`, keeps its text, and takes the stored one when it loses focus
// with nothing typed since. Typing first stores its own text, which is newer.
// A graceful quit stores typing first; a crash loses typing not yet stored.
//
// Each switch exists only so a bug schedule can show what one rule prevents.
module draftsProtocol {
  const drainLimit: int
  const eventLimit: int

  // `chosen` is when the writer chose a version (real time, for the
  // properties): the phone's write, or Juno's store of the text it saved.
  // `cmid` is the `client_msg_id` of the create that made the draft (0 for
  // the phone's).
  type Version = { id: int, text: int, stamp: int, deleted: bool, files: bool, chosen: int, cmid: int }
  type Slot = { id: int, text: int, stamp: int, files: bool, chosen: int, cmid: int }
  // Texts a send carried and Juno's own texts that can be on the draft it
  // went from: Slack's id (0 while Juno has not had it) or its create's `cmid`
  // (0 when none). `at`: when the text went (for the properties). `seq`
  // orders records, for forgetting settled ones.
  type Sent = { id: int, cmid: int, texts: Set[int], settled: bool, seq: int, at: int }
  // `seenAt` is when Juno linked the draft `id`, on Juno's clock. `replaced`
  // is the text ⌘Z brings back. `cmid` is the `client_msg_id` Juno creates
  // the place's draft with (0 until its first create needs one). `userClear`:
  // the empty text is a user's clear.
  type Local = { text: int, editedAt: int, id: int, stamp: int, seenAt: int, files: bool, replaced: int, chosen: int, cmid: int, sent: Set[Sent], userClear: bool }
  // `sending` is the text of the call in flight (-1 for none, 0 for a
  // delete); `unsure` the texts of calls whose answers were lost, until a
  // list after the last loss (`unsureAt`); `findAt` when a create's answer
  // was lost or Slack said the place has a draft (0 for none). `resave`: the
  // row only saves again a version taken from Slack (a text; an empty one is
  // not put back); `quiet`: a send settled the draft, and the row sends
  // nothing. `refusedGen`: the generation Slack refused for
  // good (-1 for none).
  type Row = { on: bool, gen: int, sending: int, unsure: Set[int], unsureAt: int, findAt: int, resave: bool, quiet: bool, refusedGen: int }
  // `byUser`: a delete for the user's clear; `knew`: when it was claimed, the newest version Juno had seen of
  // the draft had files (both for the properties).
  type Call = { on: bool, op: str, text: int, id: int, gen: int, edited: int, chosen: int, cmid: int, byUser: bool, knew: bool,
    accepted: bool, answer: str, answerId: int, answerStamp: int, answerFiles: bool }
  type Read = { on: bool, op: str, text: int, id: int, gen: int, edited: int, chosen: int }
  type Rules = {
    echoCheck: bool, resave: bool, tombstone: bool, hold: bool, seenGuard: bool,
    clearTime: bool, claimRead: bool, absenceRecheck: bool, liveFiles: bool, keepListing: bool,
    keepReplaced: bool, quitStores: bool, copyOnce: bool, freshAnswer: bool, refusalByGen: bool,
    listWhileOwed: bool, hideSent: bool, keepUnresolved: bool, sendAsksNothing: bool, filesHandsOff: bool,
    clearOnly: bool, retireOnConfirm: bool, refusalUnnames: bool
  }
  type State = {
    clock: int, skew: int, nextText: int, nextId: int, nextCmid: int, nextSeq: int,
    slack: Slot,
    local: Local, row: Row, read: Read, call: Call,
    gone: Set[int],
    events: Set[Version], fetching: bool, fetchAt: int, fetched: Slot,
    absence: { on: bool, id: int, at: int },
    connected: bool, catchup: bool, connectedAt: int, listsLeft: int,
    // A message posted from the draft, naming Slack's draft (0 for none); a refused one waits for Retry
    // (`failed`), with the draft a retry names, and when Slack refused it; `retried`: the post is a retry.
    posting: bool, postDraft: int, postAt: int, failed: bool, failedDraft: int, failedAt: int, retried: bool,
    // The composer.
    focused: bool, typed: bool, field: int, unsaved: bool, behind: bool,
    sealed: bool, label: str,
    // What the properties and the schedules read. When the user changed a draft in Juno (`decidedAt`), and
    // when a post that named it retired it (`retiredAt`); the newest version of each draft Juno has seen.
    decidedAt: int -> int, retiredAt: int -> int, sentTexts: Set[int], lost: Set[int],
    focusBroken: bool, typingLost: bool, firstNewer: int, editedSinceStart: bool, listFailures: int,
    newest: int -> { stamp: int, files: bool }, refusedTexts: Set[int], copyLost: bool, wrongWrite: bool,
    // Texts Juno's own late saves left in Slack: a create or update that landed after a version from Slack
    // had replaced its intent.
    leftovers: Set[int]
  }

  var s: State
  var remaining: int

  pure val none: Slot = { id: 0, text: 0, stamp: 0, files: false, chosen: 0, cmid: 0 }
  pure val noCall: Call = { on: false, op: "", text: 0, id: 0, gen: 0, edited: 0, chosen: 0, cmid: 0, byUser: false, knew: false,
    accepted: false, answer: "", answerId: 0, answerStamp: 0, answerFiles: false }
  pure val noRead: Read = { on: false, op: "", text: 0, id: 0, gen: 0, edited: 0, chosen: 0 }
  pure val noAbsence = { on: false, id: 0, at: 0 }
  pure val rules: Rules = {
    echoCheck: true, resave: true, tombstone: true, hold: true, seenGuard: true,
    clearTime: true, claimRead: true, absenceRecheck: true, liveFiles: true, keepListing: true,
    keepReplaced: true, quitStores: true, copyOnce: true, freshAnswer: true, refusalByGen: true,
    listWhileOwed: true, hideSent: true, keepUnresolved: true, sendAsksNothing: true, filesHandsOff: true,
    clearOnly: true, retireOnConfirm: true, refusalUnnames: true
  }
  // Lists that may fail in a row before a sender without `keepListing` stops asking.
  pure val listTries = 2

  // The first run after sync ships: a draft Juno kept before (never in Slack,
  // so pending), Slack's draft for the place, both, or neither. Text 1 is
  // Juno's, typed at `junoAt`; text 2 is Slack's, typed at `slackAt`.
  action initWith(junoAt: int, slackAt: int, skew: int): bool = {
    val juno = if (junoAt > 0) 1 else 0
    val phone = if (slackAt > 0) 2 else 0
    all {
      s' = {
        clock: 3, skew: skew, nextText: 3, nextId: 2, nextCmid: 1, nextSeq: 1,
        slack: if (slackAt > 0) { id: 1, text: phone, stamp: slackAt, files: false, chosen: slackAt, cmid: 0 } else none,
        local: { text: juno, editedAt: junoAt, id: 0, stamp: 0, seenAt: 0, files: false, replaced: 0, chosen: junoAt, cmid: 0, sent: Set(), userClear: false },
        row: { on: junoAt > 0, gen: if (junoAt > 0) 1 else 0, sending: -1, unsure: Set(), unsureAt: 0, findAt: 0, resave: false, quiet: false, refusedGen: -1 },
        read: noRead, call: noCall, gone: Set(),
        events: Set(), fetching: false, fetchAt: 0, fetched: none, absence: noAbsence,
        connected: true, catchup: true, connectedAt: 3, listsLeft: listTries,
        posting: false, postDraft: 0, postAt: 0, failed: false, failedDraft: 0, failedAt: 0, retried: false,
        focused: false, typed: false, field: juno, unsaved: false, behind: false,
        sealed: false, label: "init",
        decidedAt: Map(), retiredAt: Map(), sentTexts: Set(), lost: Set(),
        focusBroken: false, typingLost: false,
        firstNewer: if (junoAt == 0 and slackAt == 0) 0 else if (junoAt > slackAt) juno else phone,
        editedSinceStart: false, listFailures: 0,
        newest: Map(), refusedTexts: Set(), copyLost: false, wrongWrite: false, leftovers: Set()
      },
      remaining' = drainLimit
    }
  }
  action init = {
    nondet junoAt = Set(0, 1, 2).oneOf()
    nondet slackAt = Set(0, 1, 2).oneOf()
    nondet skew = Set(0, 2).oneOf()
    all { junoAt == 0 or slackAt == 0 or junoAt != slackAt, initWith(junoAt, slackAt, skew) }
  }
  // The directed schedules start from no draft on either side, from the first
  // run's two drafts, or with Juno's clock behind Slack's.
  action initFresh = initWith(0, 0, 0)
  action initFirstRun = initWith(1, 2, 0)
  action initBehind = initWith(0, 0, 2)

  // The composer after the stored draft became `stored`.
  pure def react(st: State, stored: int, hold: bool): State =
    if (stored == st.field or st.unsaved) st
    else if (hold and st.focused and st.typed) { ...st, behind: true }
    else { ...st, field: stored, behind: false, focusBroken: st.focusBroken or (st.focused and st.typed) }

  // A local edit Slack has not acknowledged; without `copyOnce` a resave of Slack's version counts as one. A
  // row a send settled is none.
  pure def pending(st: State, r: Rules): bool = st.row.on and (not(r.copyOnce) or not(st.row.resave)) and not(st.row.quiet)

  // The sent records Juno keeps: every unsettled one and the newest settled one; without `keepUnresolved`
  // only the newest record of all.
  pure def keptSent(sent: Set[Sent], r: Rules): Set[Sent] = {
    val newest = sent.fold(0, (a, x) => if (x.seq > a) x.seq else a)
    val newestSettled = sent.fold(0, (a, x) => if (x.settled and x.seq > a) x.seq else a)
    if (r.keepUnresolved) sent.filter(x => not(x.settled) or x.seq == newestSettled) else sent.filter(x => x.seq == newest)
  }

  // A version from Slack, by the rules above. `seenAt` is Juno's clock when it
  // learned of it; `absent` a list's absence; `find` a list that looks for the
  // place's draft while Juno links none.
  pure def observe(st: State, v: Version, seenAt: int, absent: bool, find: bool, r: Rules): State = {
    val l = st.local
    val stale = (not(absent) and not(find) and l.stamp >= v.stamp) or (r.tombstone and st.gone.contains(v.id))
    // A text Juno sent from the place; without `hideSent` it is taken like any other.
    val hidden = r.hideSent and not(v.deleted) and l.sent.exists(x => x.texts.contains(v.text))
    val learned = l.sent.map(x => if (x.id == 0 and x.cmid != 0 and x.cmid == v.cmid) { ...x, id: v.id } else x)
    if (stale) { ...st, clock: st.clock + 1 }
    else if (hidden and l.id != v.id and not(find)) { ...st, clock: st.clock + 1, local: { ...l, sent: learned } }
    else if (hidden)
      { ...st, clock: st.clock + 1, local: { ...l, sent: learned, id: v.id, files: v.files, seenAt: if (v.id == l.id) l.seenAt else seenAt, stamp: if (v.stamp > l.stamp) v.stamp else l.stamp } }
    else {
      // The draft a text went from is gone, or holds another text now.
      val settled = keptSent(l.sent.map(x => if ((x.id != 0 and x.id == v.id) or (x.cmid != 0 and x.cmid == v.cmid)) { ...x, settled: true } else x), r)
      // Typing done after a send outlives the draft it went from: it goes on as a new draft.
      if (v.deleted and v.id == l.id and pending(st, r) and l.sent.exists(x => x.id == v.id))
        { ...st, clock: st.clock + 1, gone: st.gone.union(Set(v.id)), local: { ...l, sent: settled, id: 0, files: false } }
      else observeVersion({ ...st, local: { ...l, sent: settled } }, v, seenAt, absent, r)
    }
  }

  // A version that is no text Juno sent, by the rules above.
  pure def observeVersion(st: State, v: Version, seenAt: int, absent: bool, r: Rules): State = {
    val l = st.local
    // Without `liveFiles`, a live draft of files alone counts as deleted.
    val deleted = v.deleted or (not(r.liveFiles) and v.text == 0)
    val other = deleted and v.id != l.id
    val own = r.echoCheck and (st.row.sending == v.text or st.row.unsure.contains(v.text))
    val same = v.text == l.text
    val kept = pending(st, r) and l.editedAt > v.stamp
    val applies = not(other) and not(same) and not(own) and not(kept)
    val text = if (deleted) 0 else v.text
    val keep = applies and pending(st, r) and l.text != 0 and r.keepReplaced
    // The kept text stays; without `copyOnce` the newest replaced text takes its place.
    val copy = if (r.copyOnce and l.replaced != 0) l.replaced else if (keep) l.text else l.replaced
    // Juno's text replaced by a version chosen before it (kept for ⌘Z excuses it only while Juno's clock
    // runs behind), or, while the clocks agree, a version chosen before the user changed the draft in Juno
    // (a send is no change), or, whatever the clocks, one chosen before a post that named it retired it,
    // once Juno has seen it retired.
    val older = applies and ((l.text != 0 and v.chosen < l.chosen and (st.skew == 0 or not(keep))) or
      ((l.text != 0 or l.userClear) and st.skew == 0 and st.decidedAt.keys().contains(v.id) and v.chosen < st.decidedAt.get(v.id)) or
      (st.retiredAt.keys().contains(v.id) and st.gone.contains(v.id) and v.chosen < st.retiredAt.get(v.id)))
    val after = { ...st, clock: st.clock + 1, lost: if (older) st.lost.union(Set(l.text)) else st.lost }
    val linked = { ...l, id: if (deleted) 0 else v.id, stamp: if (absent or v.stamp < l.stamp) l.stamp else v.stamp,
      seenAt: if (v.id == l.id) l.seenAt else seenAt, files: if (deleted) false else v.files }
    val gone = if (deleted) st.gone.union(Set(v.id)) else st.gone
    if (other) { ...after, gone: gone }
    // Juno's own older text in Slack, or a newer local edit, which goes over it.
    else if (not(applies)) { ...after, local: linked, gone: gone }
    else react({ ...after,
      local: { ...linked, text: text, editedAt: v.stamp, replaced: copy, chosen: v.chosen, userClear: false },
      gone: gone, copyLost: st.copyLost or (l.replaced != 0 and copy != l.replaced),
      // A save of Juno's that is out, or whose answer was lost, while this replaces its intent may land after
      // it and stay in Slack (for the properties).
      leftovers: st.leftovers.union(st.row.unsure.exclude(Set(0))).union(if (st.call.on and st.call.text != 0) Set(st.call.text) else Set()),
      row: if (r.resave and (st.row.sending >= 0 or st.row.unsure.size() > 0)) { ...st.row, gen: st.row.gen + 1, resave: true, quiet: false }
        else { ...st.row, on: false } }, text, r.hold)
  }

  // Juno has seen a version of draft `id`: the newest it has seen says whether the draft has files.
  pure def saw(st: State, id: int, stamp: int, files: bool): State =
    if (id == 0 or st.gone.contains(id) or (st.newest.keys().contains(id) and st.newest.get(id).stamp >= stamp)) st
    else { ...st, newest: st.newest.put(id, { stamp: stamp, files: files }) }
  pure def knowsFiles(st: State, id: int): bool = st.newest.keys().contains(id) and st.newest.get(id).files

  // Typing in the focused composer: a new text, or clearing it.
  action typeText(clear: bool): bool = {
    val t = if (clear) 0 else s.nextText
    all {
      not(s.sealed), s.focused, t != s.field,
      s' = { ...s, clock: s.clock + 1, nextText: s.nextText + 1,
        field: t, typed: true, unsaved: true, behind: false,
        editedSinceStart: true, label: "type" }
    }
  }
  // The composer stores its text: a local change, at Juno's time; it lets a
  // replaced text go. Emptying it is the user's clear (Old drafts' Delete is
  // the same). Without `clearTime` a clear keeps no time of its own.
  pure def stored(st: State, r: Rules): State =
    { ...st, clock: st.clock + 1,
      decidedAt: if (st.local.id != 0) st.decidedAt.put(st.local.id, st.clock + 1) else st.decidedAt,
      local: { ...st.local, text: st.field, editedAt: if (st.field == 0 and not(r.clearTime)) 0 else st.clock + 1 - st.skew, replaced: 0, chosen: st.clock + 1, userClear: st.field == 0 },
      row: { ...st.row, on: st.field != 0 or st.local.id != 0 or st.row.on, gen: st.row.gen + 1, resave: false, quiet: false },
      unsaved: false }
  action pauseWith(r: Rules): bool = all { s.unsaved, s' = { ...stored(s, r), label: "store" } }
  action pause = pauseWith(rules)
  action focus = all { not(s.sealed), not(s.focused), s' = { ...s, focused: true, label: "focus" } }
  // Leaving the field takes the draft it held back. Typing is stored first.
  action blur = all {
    s.focused, not(s.unsaved),
    s' = { ...s, focused: false, field: if (s.behind) s.local.text else s.field, behind: false, label: "blur" }
  }
  // ⌘Z in the field right after another device's draft filled it: the replaced text is typing again.
  action recover = all {
    not(s.sealed), s.focused, not(s.unsaved), s.local.replaced != 0, s.field == s.local.text,
    s' = { ...s, clock: s.clock + 1, field: s.local.replaced, typed: true, unsaved: true, editedSinceStart: true, label: "recover" }
  }
  // Enter: the text goes as a message, to the draft's place (`here`) or
  // another, and the draft is cleared. Without `sendAsksNothing` the send is
  // a clear Juno saves: it keeps the link and deletes the draft. Without
  // `retireOnConfirm` a post that names the draft makes it gone at once.
  action sendWith(here: bool, r: Rules): bool = {
    val l = s.local
    val named = here and l.id != 0 and not(l.files)
    val unlinks = l.id != 0 and not(l.files) and r.sendAsksNothing and (not(here) or not(r.retireOnConfirm))
    val unanswered = l.id == 0 and l.cmid != 0 and s.row.on and ((s.call.on and s.call.op == "create") or s.row.findAt > 0 or s.row.unsure.size() > 0)
    val texts = Set(s.field).union(if (s.row.sending > 0) Set(s.row.sending) else Set()).union(s.row.unsure).exclude(Set(0))
    val record = { id: l.id, cmid: if (unanswered) l.cmid else 0, texts: texts, settled: l.id == 0 and not(unanswered), seq: s.nextSeq, at: s.clock + 1 }
    val calls = s.row.sending >= 0 or s.row.unsure.size() > 0 or s.row.findAt > 0
    all {
      not(s.sealed), s.focused, s.field != 0, not(s.posting),
      s' = { ...s, clock: s.clock + 1, sentTexts: s.sentTexts.union(Set(s.field)),
        // The send settles what the user typed: it is no decision against what another device has.
        decidedAt: if (l.id != 0) s.decidedAt.put(l.id, 0) else s.decidedAt,
        field: 0, unsaved: false, behind: false,
        local: { ...l, text: 0, editedAt: if (r.clearTime) s.clock + 1 - s.skew else 0, id: if (unlinks) 0 else l.id, files: if (unlinks) false else l.files,
          replaced: 0, chosen: s.clock + 1, userClear: false, sent: keptSent(l.sent.union(Set(record)), r), cmid: if (unanswered) 0 else l.cmid },
        nextSeq: s.nextSeq + 1,
        gone: if (named and not(r.retireOnConfirm)) s.gone.union(Set(l.id)) else s.gone,
        row: if (not(r.sendAsksNothing) and l.id != 0 and not(named)) { ...s.row, on: true, gen: s.row.gen + 1, resave: false, quiet: false }
          else if (s.row.on and calls) { ...s.row, gen: s.row.gen + 1, resave: false, quiet: true }
          else { ...s.row, on: false },
        posting: true, postDraft: if (named) l.id else 0, postAt: s.clock + 1, failed: false, retried: false, editedSinceStart: true, label: "send" }
    }
  }
  action send = sendWith(true, rules)
  // Slack takes the post and retires the draft it names (`draft_send`).
  action postLands = {
    val drops = s.postDraft != 0 and s.slack.id == s.postDraft
    // A retry retired the draft as it was written after Slack refused the post: that text, or file, is gone.
    val stale = drops and s.retried and s.slack.chosen > s.failedAt
    all {
      s.posting,
      s' = { ...s, clock: s.clock + 1, posting: false, postDraft: 0,
        slack: if (drops) none else s.slack,
        lost: if (stale and s.slack.text != 0) s.lost.union(Set(s.slack.text)) else s.lost,
        wrongWrite: s.wrongWrite or (stale and s.slack.files),
        // Slack retired the draft with the post: nothing from before the send may come back.
        retiredAt: if (drops) s.retiredAt.put(s.postDraft, s.postAt) else s.retiredAt,
        events: if (s.connected and drops) s.events.union(Set({ id: s.postDraft, text: 0, stamp: s.clock + 1, deleted: true, files: false, chosen: s.clock + 1, cmid: s.slack.cmid })) else s.events,
        label: "postLands" }
    }
  }
  // Slack refuses the post: its draft was not retired, and is the place's
  // draft as Juno last saw it; deleting the failed message changes nothing.
  // The post waits for Retry and no longer names the draft, which Juno may
  // write to meanwhile; without `refusalUnnames` a retry names it still.
  // Without `retireOnConfirm` Juno links it again and counts it not gone, but
  // what came of it meanwhile was dropped.
  action postRefusedWith(r: Rules): bool = {
    val failed = { ...s, posting: false, postDraft: 0, failed: true, failedDraft: if (r.refusalUnnames) 0 else s.postDraft, failedAt: s.clock }
    all {
    not(s.sealed), s.posting,
    s' = if (r.retireOnConfirm) { ...failed, label: "postRefused" }
      else { ...failed,
        gone: s.gone.exclude(Set(s.postDraft)),
        local: if (s.postDraft != 0 and s.local.id == 0) { ...s.local, id: s.postDraft, seenAt: s.clock } else s.local,
        label: "postRefused" }
    }
  }
  action postRefused = postRefusedWith(rules)
  // Retry on the failed message: it goes again, naming the draft the refusal left it.
  action retry = all {
    not(s.sealed), s.failed, not(s.posting),
    s' = { ...s, clock: s.clock + 1, failed: false, posting: true, postDraft: s.failedDraft, retried: true, label: "retry" }
  }

  // Another device types in Slack's draft, attaches files to it, empties its
  // text keeping its files, or deletes it (clearing or sending it).
  pure def phoneWrite(st: State, text: int, files: bool, typed: bool): State = {
    val v = { id: if (st.slack.id == 0) st.nextId else st.slack.id, text: text, stamp: st.clock + 1, files: files, chosen: st.clock + 1, cmid: if (st.slack.id == 0) 0 else st.slack.cmid }
    { ...st, clock: st.clock + 1, nextText: if (typed) st.nextText + 1 else st.nextText, nextId: st.nextId + 1, slack: v,
      events: if (st.connected) st.events.union(Set({ id: v.id, text: text, stamp: v.stamp, deleted: false, files: files, chosen: v.chosen, cmid: v.cmid })) else st.events,
      editedSinceStart: true }
  }
  action phoneType = all { not(s.sealed), s.events.size() < eventLimit, s' = { ...phoneWrite(s, s.nextText, s.slack.files, true), label: "phoneType" } }
  action phoneAttach = all { not(s.sealed), s.events.size() < eventLimit, s' = { ...phoneWrite(s, s.slack.text, true, false), label: "phoneAttach" } }
  action phoneEmpty = all { not(s.sealed), s.slack.files, s.slack.text != 0, s.events.size() < eventLimit, s' = { ...phoneWrite(s, 0, true, false), label: "phoneEmpty" } }
  action phoneDelete = all {
    not(s.sealed), s.slack.id != 0, s.events.size() < eventLimit,
    s' = { ...s, clock: s.clock + 1, slack: none,
      events: if (s.connected) s.events.union(Set({ id: s.slack.id, text: 0, stamp: s.clock + 1, deleted: true, files: false, chosen: s.clock + 1, cmid: s.slack.cmid })) else s.events,
      editedSinceStart: true, label: "phoneDelete" }
  }

  // What the stored draft needs now: nothing for a generation Slack refused
  // for good, or, with `filesHandsOff`, for a draft with files; a delete only
  // for the user's clear (a local edit, not a send). Without `clearOnly` an
  // empty version put back over Juno's own late save deletes too.
  pure def opOf(st: State, r: Rules): str = {
    val l = st.local
    if (st.row.refusedGen == st.row.gen) "nothing"
    else if (r.filesHandsOff and l.id != 0 and l.files) "nothing"
    else if (l.text != 0 and l.id != 0) "update"
    else if (l.text != 0) "create"
    else if (l.id != 0 and (pending(st, r) or (not(r.clearOnly) and st.row.resave))) "delete"
    else "nothing"
  }
  // A post that names the draft Juno links is on its way: Juno writes nothing to that draft meanwhile.
  pure def retiring(st: State): bool = st.posting and st.postDraft != 0 and st.postDraft == st.local.id
  // A row that waits for a newer change: its text was refused for good, or the draft has files.
  pure def parked(st: State, r: Rules): bool = st.row.on and (st.row.refusedGen == st.row.gen or (r.filesHandsOff and st.local.id != 0 and st.local.files))

  // The sender reads the row: what it would send.
  action readWith(r: Rules): bool = {
    val op = opOf(s, r)
    all {
      s.connected, s.row.on, not(parked(s, r)), not(retiring(s)), not(s.call.on), not(s.read.on),
      s' = { ...s, read: { on: true, op: op, text: s.local.text, id: s.local.id, gen: s.row.gen, edited: s.local.editedAt, chosen: s.local.chosen }, label: "read" }
    }
  }
  action read = readWith(rules)
  // It claims the row in one transaction that reads the stored draft again;
  // without `claimRead` it sends what it read, even after the row changed.
  action claimWith(r: Rules): bool = {
    val op = if (r.claimRead) opOf(s, r) else s.read.op
    val id = if (r.claimRead) s.local.id else s.read.id
    val text = if (r.claimRead) s.local.text else s.read.text
    val nothing = (r.claimRead and not(s.row.on)) or op == "nothing" or (op == "create" and s.row.findAt > 0) or retiring(s)
    all {
      s.read.on, not(s.call.on),
      s' = if (nothing) { ...s, read: noRead,
          row: if (r.claimRead and s.row.on and op == "nothing" and s.row.findAt == 0 and not(parked(s, r)) and not(retiring(s))) { ...s.row, on: false, sending: -1 } else s.row,
          label: "claim" }
        else { ...s, read: noRead,
          // A first create gets a `client_msg_id`.
          local: if (op == "create" and s.local.cmid == 0) { ...s.local, cmid: s.nextCmid } else s.local,
          nextCmid: if (op == "create" and s.local.cmid == 0) s.nextCmid + 1 else s.nextCmid,
          call: { ...noCall, on: true, op: op, text: if (op == "delete") 0 else text, id: id,
            gen: if (r.claimRead) s.row.gen else s.read.gen,
            edited: if (r.claimRead) s.local.editedAt else s.read.edited,
            chosen: if (r.claimRead) s.local.chosen else s.read.chosen, cmid: if (s.local.cmid == 0) s.nextCmid else s.local.cmid,
            byUser: s.local.userClear, knew: knowsFiles(s, id) },
          row: { ...s.row, sending: if (op == "delete") 0 else text },
          label: "claim" }
    }
  }
  action claim = claimWith(rules)

  // Slack runs the call; every write it makes is echoed. An update or delete
  // with no plausible edit time is refused (`draft_has_conflict`), and so is
  // a text Slack refuses for good. Juno's update sends no files.
  action accept = {
    val c = s.call
    val found = c.id != 0 and s.slack.id == c.id
    val refused = (c.op == "create" or c.op == "update") and s.refusedTexts.contains(c.text)
    val occupied = not(refused) and c.op == "create" and s.slack.id != 0
    val checked = c.op == "create" or c.edited > 0
    val written = if (refused or not(checked) or occupied) s.slack
      else if (c.op == "create") { id: s.nextId, text: c.text, stamp: s.clock + 1, files: false, chosen: c.chosen, cmid: c.cmid }
      else if (c.op == "update" and found) { id: c.id, text: c.text, stamp: s.clock + 1, files: false, chosen: c.chosen, cmid: s.slack.cmid }
      else if (c.op == "delete" and found) none
      else s.slack
    val wrote = not(refused) and checked and ((c.op == "create" and not(occupied)) or found)
    val echo = if (written.id == 0) { id: c.id, text: 0, stamp: s.clock + 1, deleted: true, files: false, chosen: c.chosen, cmid: s.slack.cmid }
      else { id: written.id, text: written.text, stamp: written.stamp, deleted: false, files: written.files, chosen: written.chosen, cmid: written.cmid }
    all {
      c.on, not(c.accepted), s.events.size() < eventLimit,
      s' = { ...s, clock: s.clock + 1, nextId: if (wrote and c.op == "create") s.nextId + 1 else s.nextId, slack: written,
        events: if (s.connected and wrote) s.events.union(Set(echo)) else s.events,
        // Juno deleted a draft for something other than the user's clear, or wrote to one it knew had files.
        wrongWrite: s.wrongWrite or (wrote and ((c.op == "delete" and (not(c.byUser) or c.knew)) or (c.op == "update" and c.knew))),
        call: { ...c, accepted: true,
          answer: if (refused) "refused" else if (not(checked)) "conflict" else if (occupied) "exists" else if (c.op == "create" or (c.op == "update" and found)) "saved"
            else if (c.op == "update") "notFound" else "deleted",
          answerId: written.id, answerStamp: s.clock + 1, answerFiles: written.files },
        label: "accept" }
    }
  }
  // Slack refuses the call's text for good (too long, say), and every later call with it.
  action refuseCall = all {
    not(s.sealed), s.call.on, not(s.call.accepted), s.call.op == "create" or s.call.op == "update", s.call.text != 0,
    s' = { ...s, refusedTexts: s.refusedTexts.union(Set(s.call.text)), call: { ...s.call, accepted: true, answer: "refused" }, label: "refuse" }
  }

  // The answer, `dt` after the step before. The row ends when no newer change
  // replaced its intent, nothing else is owed, and a delete covered the draft
  // Juno links. A save's files and stamp count only when it is newer than
  // what Juno has seen of that draft. A create answered after its text went
  // is remembered by id and not linked. A refusal settles the generation it sent.
  action respondAt(r: Rules, dt: int): bool = {
    val c = s.call
    val l = s.local
    val t = s.clock + dt
    val sentCreate = c.op == "create" and c.answer == "saved" and l.sent.exists(x => not(x.settled) and x.cmid != 0 and x.cmid == c.cmid)
    val goneSave = c.answer == "saved" and s.gone.contains(c.answerId)
    val covered = c.answer != "deleted" or l.id == c.id or l.id == 0
    val refused = c.answer == "refused"
    val done = not(refused) and c.gen == s.row.gen and c.answer != "notFound" and c.answer != "exists" and c.answer != "conflict" and not(goneSave) and
      (s.row.findAt == 0 or c.answer == "saved") and covered
    val newer = if (c.answerStamp > l.stamp) c.answerStamp else l.stamp
    val keepLink = c.answer == "saved" and l.id != 0 and l.id != c.answerId and c.answerStamp < l.stamp
    // Without `freshAnswer` an answer no newer than what Juno has seen of the same draft still sets its files.
    val staleSame = r.freshAnswer and c.answer == "saved" and l.id != 0 and l.id == c.answerId and c.answerStamp <= l.stamp
    // The refused text stays a local edit: the row stays, sending nothing for that generation. Without
    // `refusalByGen` a refusal ends the row, a newer change with it.
    val refusedRow = if (not(r.refusalByGen)) { ...s.row, on: false, sending: -1 }
      else { ...s.row, sending: -1, refusedGen: if (c.gen == s.row.gen) c.gen else s.row.refusedGen }
    all {
      c.on, c.accepted,
      s' = saw({ ...s, clock: t, call: noCall,
        // A create whose text went as a message is remembered by id; settled at once when its draft is already gone.
        local: if (sentCreate) { ...l, sent: keptSent(l.sent.map(x => if (x.cmid == c.cmid) { ...x, id: c.answerId, settled: x.settled or goneSave } else x), r) }
          else if (refused or goneSave or keepLink or staleSame or c.answer == "exists" or c.answer == "conflict") l
          else if (c.answer == "saved") { ...l, id: c.answerId, stamp: newer, seenAt: if (c.answerId == l.id) l.seenAt else t, files: c.answerFiles }
          else { ...l, id: if (l.id == c.id) 0 else l.id, files: if (l.id == c.id) false else l.files, seenAt: t,
            // The draft a text went from is gone.
            sent: keptSent(l.sent.map(x => if (x.id == c.id) { ...x, settled: true } else x), r) },
        gone: if (c.answer == "deleted" or c.answer == "notFound") s.gone.union(Set(c.id)) else s.gone,
        catchup: s.catchup or c.answer == "exists" or c.answer == "conflict",
        row: if (refused) refusedRow else { ...s.row, on: not(done), sending: -1,
          findAt: if (c.answer == "exists") t else if (c.answer == "saved" and not(goneSave)) 0 else s.row.findAt },
        label: "respond" }, if (c.answer == "saved" and not(sentCreate)) c.answerId else 0, c.answerStamp, c.answerFiles)
    }
  }
  action respondWith(r: Rules): bool = respondAt(r, 1)
  action respond = respondWith(rules)
  action respondAny = { nondet dt = Set(0, 1).oneOf() respondAt(rules, dt) }
  // The answer is lost, or the call failed on the way, `dt` after the step
  // before. The row stays, and so does the text it sent, until a list after
  // the loss.
  action loseAt(dt: int): bool = all {
    not(s.sealed), s.call.on,
    s' = { ...s, clock: s.clock + dt, call: noCall,
      row: { ...s.row, sending: -1, unsure: if (s.row.sending >= 0) s.row.unsure.union(Set(s.row.sending)) else s.row.unsure,
        unsureAt: s.clock + dt, findAt: if (s.call.op == "create") s.clock + dt else s.row.findAt },
      catchup: true, label: "lose" }
  }
  action lose = loseAt(1)
  action loseAny = { nondet dt = Set(0, 1).oneOf() loseAt(dt) }

  action deliverAt(r: Rules, dt: int): bool = {
    nondet v = s.events.oneOf()
    all {
      s.connected,
      s' = { ...observe(saw(s, v.id, v.stamp, v.files), v, s.clock + dt, false, false, r), clock: s.clock + dt, events: s.events.exclude(Set(v)), label: "deliver" }
    }
  }
  action deliverWith(r: Rules): bool = deliverAt(r, 1)
  // Delivers a deletion (for the schedules).
  action deliverGone(r: Rules): bool = {
    nondet v = s.events.filter(e => e.deleted).oneOf()
    all { s.connected, s' = { ...observe(s, v, s.clock + 1, false, false, r), clock: s.clock + 1, events: s.events.exclude(Set(v)), label: "deliver" } }
  }
  // Delivers a live version, not a deletion (for the schedules).
  action deliverLive(r: Rules): bool = {
    nondet v = s.events.filter(e => not(e.deleted)).oneOf()
    all { s.connected, s' = { ...observe(saw(s, v.id, v.stamp, v.files), v, s.clock + 1, false, false, r), clock: s.clock + 1, events: s.events.exclude(Set(v)), label: "deliver" } }
  }
  action deliver = deliverWith(rules)
  action deliverAny = { nondet dt = Set(0, 1).oneOf() deliverAt(rules, dt) }

  // A list of Slack's drafts, requested `dt` after the step before. A list
  // takes time, so the next one is requested in a later millisecond. A failed
  // one is asked for again, with backoff; without `keepListing` the sender
  // gives up after a few failures in a row, until the socket comes back.
  action startListAt(dt: int): bool = all {
    s.connected, not(s.fetching), s.listsLeft > 0, s.clock + dt > s.fetchAt,
    s' = { ...s, clock: s.clock + dt, fetching: true, fetchAt: s.clock + dt, fetched: s.slack, label: "startList" }
  }
  action startList = startListAt(1)
  action startListAny = { nondet dt = Set(0, 1).oneOf() startListAt(dt) }
  action failListWith(r: Rules): bool = all {
    not(s.sealed), s.fetching,
    s' = { ...s, fetching: false, listFailures: s.listFailures + 1, listsLeft: if (r.keepListing) s.listsLeft else s.listsLeft - 1, label: "failList" }
  }
  action failList = failListWith(rules)
  // The list's entry applies; a linked draft it missed waits as an absence.
  action finishListWith(r: Rules): bool = {
    val f = s.fetched
    val find = s.row.findAt > 0 and s.fetchAt > s.row.findAt and s.local.id == 0
    val seen = if (f.id != 0) observe(saw(s, f.id, f.stamp, f.files), { id: f.id, text: f.text, stamp: f.stamp, deleted: false, files: f.files, chosen: f.chosen, cmid: f.cmid }, s.fetchAt, false, find, r) else s
    // The draft Juno links once the entry applied, when the list lacks it.
    val missing = seen.local.id != 0 and seen.local.id != f.id and (not(r.seenGuard) or s.fetchAt > seen.local.seenAt)
    // A list requested after a lost create, or after Slack said the place has a draft, has shown it;
    // one requested after the last lost answer has shown what those calls left.
    val found = if (seen.row.findAt > 0 and s.fetchAt > seen.row.findAt) { ...seen, row: { ...seen.row, findAt: 0 } } else seen
    val settled = if (s.fetchAt > found.row.unsureAt) { ...found, row: { ...found.row, unsure: Set() } } else found
    all {
      s.fetching, not(s.absence.on),
      s' = { ...settled, fetching: false, listsLeft: listTries,
        absence: if (missing) { on: true, id: seen.local.id, at: s.fetchAt } else s.absence,
        // Only a list requested since the socket came back, after Juno's link, with no call out, is the catch-up;
        // a find or a loss it did not settle (one from its own millisecond) asks for another, unless `listWhileOwed` is off.
        catchup: (s.catchup and s.fetchAt <= s.connectedAt) or s.call.on or (settled.local.id != 0 and s.fetchAt <= settled.local.seenAt) or
          (r.listWhileOwed and (settled.row.findAt > 0 or settled.row.unsure.size() > 0)),
        label: "finishList" }
    }
  }
  action finishList = finishListWith(rules)
  // The absence is written in a later transaction that reads the link again;
  // without `absenceRecheck` it deletes whatever Juno links by then.
  action applyAbsenceWith(r: Rules): bool = {
    val a = s.absence
    val still = s.local.id == a.id and (not(r.seenGuard) or s.local.seenAt < a.at)
    val target = if (r.absenceRecheck) a.id else s.local.id
    all {
      a.on,
      s' = if ((r.absenceRecheck and not(still)) or target == 0) { ...s, absence: noAbsence, label: "absence" }
        // The deletion was chosen before the list was requested.
        else { ...observe(s, { id: target, text: 0, stamp: s.local.stamp, deleted: true, files: false, chosen: a.at, cmid: 0 }, a.at, true, false, r), absence: noAbsence, label: "absence" }
    }
  }
  action applyAbsence = applyAbsenceWith(rules)

  action disconnect = all {
    not(s.sealed), s.connected,
    s' = { ...s, connected: false, events: Set(), label: "disconnect" }
  }
  action reconnect = all { not(s.connected), s' = { ...s, clock: s.clock + 1, connected: true, catchup: true, connectedAt: s.clock + 1, listsLeft: listTries, label: "reconnect" } }
  // Juno stops and starts again. A call that was out counts as one whose
  // answer was lost; the composer starts from the stored draft.
  pure def restarted(st: State, label: str): State =
    { ...st, clock: st.clock + 1, call: noCall, read: noRead, events: Set(), fetching: false, absence: noAbsence,
      row: { ...st.row, sending: -1,
        unsure: if (st.row.sending >= 0) st.row.unsure.union(Set(st.row.sending)) else st.row.unsure,
        unsureAt: if (st.row.sending >= 0) st.clock + 1 else st.row.unsureAt,
        findAt: if (st.call.on and st.call.op == "create") st.clock + 1 else st.row.findAt },
      connected: true, catchup: true, connectedAt: st.clock + 1, listsLeft: listTries,
      focused: false, typed: false, unsaved: false, field: st.local.text, behind: false, label: label }
  // A graceful quit stores typing first; without `quitStores` it is lost.
  action quitWith(r: Rules): bool = all {
    not(s.sealed),
    s' = if (s.unsaved and r.quitStores) restarted(stored(s, r), "quit")
      else { ...restarted(s, "quit"), typingLost: s.typingLost or (s.unsaved and s.field != s.local.text) }
  }
  action quit = quitWith(rules)
  // A crash loses typing not yet stored.
  action crash = all { not(s.sealed), s' = restarted(s, "crash") }
  action seal = all { not(s.sealed), s' = { ...s, sealed: true, label: "seal" } }

  val quiet = s.sealed and (not(s.row.on) or parked(s, rules)) and not(s.call.on) and not(s.read.on) and s.events.size() == 0 and not(s.fetching) and
    not(s.absence.on) and s.connected and not(s.catchup) and not(s.posting) and not(s.unsaved) and not(s.behind) and not(s.focused)
  // Juno and Slack agree: the same text in the same draft; a text Slack
  // refused for good, kept in Juno only; a draft with files, whose text Juno
  // shows and never changes, with any typing there kept in Juno; or an empty
  // draft in Juno while Slack's holds a text Juno sent, never shown, holds a
  // late save of Juno's left there, or is a draft Juno sent from, holding what
  // it held before the send: it stays in Slack after a send elsewhere or a
  // refused post.
  val agreed = s.field == s.local.text and (
    ((s.local.text == s.slack.text or s.refusedTexts.contains(s.local.text)) and s.local.id == s.slack.id) or
    (s.local.files and s.local.id != 0 and s.local.id == s.slack.id) or
    (s.local.text == 0 and (s.local.id == 0 or s.local.id == s.slack.id) and
      (s.leftovers.contains(s.slack.text) or s.local.sent.exists(x => x.texts.contains(s.slack.text) or (x.id != 0 and x.id == s.slack.id and s.slack.chosen < x.at)))))
  // Once all is quiet, Juno and Slack agree.
  val quietAgreement = quiet implies agreed
  // Typed text is never silently lost: Juno's text is replaced only by a
  // version chosen after it (while Juno's clock runs behind, it may be, and is
  // then kept for ⌘Z); while the clocks agree, a draft the user changed in
  // Juno never takes back a version chosen before that; and, whatever the
  // clocks, a draft a post retired never takes back one chosen before the send.
  val typedNeverLost = s.lost == Set()
  // A focused composer that was typed in is never overwritten.
  val focusKept = not(s.focusBroken)
  // A sent text never comes back to Juno's draft or composer, whatever the clocks say.
  val sentStaysGone = not(s.sentTexts.contains(s.local.text)) and not(s.sentTexts.contains(s.field))
  // The first run merges Juno's old draft and Slack's by the same rule: the newer one stays.
  val firstRunMerged = (quiet and not(s.editedSinceStart)) implies s.local.text == s.firstNewer
  // Local text kept for ⌘Z stays until a local action lets it go: no version
  // from Slack replaces or drops it.
  val copyKept = not(s.copyLost)
  // Juno deletes a Slack draft only for the user's clear of the draft it
  // shows (the composer emptied, or Old drafts' Delete). It never writes to a
  // draft the newest version it has seen has files on. Files another device
  // attached unseen can go with an update, as Slack has no conditional write.
  val deletesOnlyOnClear = not(s.wrongWrite)
  // A graceful quit keeps what was typed.
  val quitKeepsTyping = not(s.typingLost)
  val reachedAgreement = quiet and agreed
  val drainBound = remaining > 0 or reachedAgreement
  // A sent record whose draft Juno has seen retired or deleted is settled, so it can be forgotten.
  val retiredSettles = s.local.sent.forall(x => x.settled or x.id == 0 or not(s.gone.contains(x.id)))
  val invariants = quietAgreement and typedNeverLost and focusKept and sentStaysGone and firstRunMerged and copyKept and deletesOnlyOnClear and retiredSettles and quitKeepsTyping and drainBound

  // A list is asked for when one is owed (a catch-up, a lost answer, `attached_draft_exists`); a sweep's lists are inputs.
  action listOwed = all { s.catchup, startListAny }
  action work = any { read, claim, accept, respondAny, pause, blur, postLands, listOwed, finishList, applyAbsence, deliverAny, reconnect }
  action input = any {
    typeText(false), typeText(true), focus, recover, send, sendWith(false, rules), postRefused, retry, startListAny,
    phoneType, phoneAttach, phoneEmpty, phoneDelete, loseAny, refuseCall, failList, disconnect, quit, crash, seal,
  }
  action tick(a: bool): bool = all {
    a, remaining' = if (s.sealed and not(quiet)) remaining - 1 else remaining
  }
  action progress = any { work, all { quiet, s' = { ...s, label: "idle" } } }
  action step = tick(if (s.sealed) progress else any { input, progress })
  action simulationStep = all { not(reachedAgreement), step }

  // Directed schedules. Each starts from `initFresh` unless it says, seals
  // after its last scripted step and drains with the real rules.

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
    if (s.label == "store" and not(s.call.on)) read else
    if (s.label == "read") claim else
    if (s.label == "claim") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") accept else
    if (s.label == "accept") deliverWith(r) else
    seal
  )
  action echoRaceStep = echoRace(rules)
  action echoRaceBugStep = echoRace({ ...rules, echoCheck: false })

  // The phone types while Juno's update is in flight; its event applies before
  // Juno's answer, but Juno's update lands after it. Without saving the
  // applied version again, Slack keeps Juno's older text.
  action inflightApply(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type" and s.nextText == 4) pause else
    if (s.label == "store" and s.nextText == 4) read else
    if (s.label == "read" and s.nextText == 4) claim else
    if (s.label == "claim" and s.nextText == 4) accept else
    if (s.label == "accept" and s.nextText == 4) respond else
    if (s.label == "respond" and s.nextText == 4) deliver else
    if (s.label == "deliver" and s.nextText == 4) typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") blur else
    if (s.label == "blur") read else
    if (s.label == "read") claim else
    if (s.label == "claim") phoneType else
    if (s.label == "phoneType") deliverWith(r) else
    if (s.label == "deliver" and s.call.on and not(s.call.accepted)) accept else
    if (s.label == "accept") respond else
    seal
  )
  action inflightApplyStep = inflightApply(rules)
  action inflightApplyBugStep = inflightApply({ ...rules, resave: false })

  // The user clears the draft and Juno deletes it; a phone edit made just
  // before the delete arrives after it. Without remembering gone drafts, the
  // edit brings the deleted draft back over the clear.
  action deletedReturns(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type" and s.field != 0) pause else
    if (s.label == "store" and s.local.id == 0) read else
    if (s.label == "read" and s.local.id == 0) claim else
    if (s.label == "claim" and s.local.id == 0) accept else
    if (s.label == "accept" and s.local.id == 0) respond else
    if (s.label == "respond" and s.local.id != 0) deliver else
    if (s.label == "deliver" and s.local.id != 0) phoneType else
    if (s.label == "phoneType") typeText(true) else
    if (s.label == "type") pause else
    if (s.label == "store") read else
    if (s.label == "read") claim else
    if (s.label == "claim") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") deliverLive(r) else
    seal
  )
  action deletedReturnsStep = deletedReturns(rules)
  action deletedReturnsBugStep = deletedReturns({ ...rules, tombstone: false })

  // The phone changes the draft while the composer has focus and was typed
  // in. Without holding it back, the field changes under the caret.
  action focusedRemote(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") read else
    if (s.label == "read") claim else
    if (s.label == "claim") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") deliver else
    if (s.label == "deliver" and s.events.size() == 0 and s.slack.text == s.local.text and s.field == s.local.text) phoneType else
    if (s.label == "phoneType") deliverWith(r) else
    seal
  )
  action focusedRemoteStep = focusedRemote(rules)
  action focusedRemoteBugStep = focusedRemote({ ...rules, hold: false })

  // A list requested before Juno's create answered finishes after it, without
  // the new draft. Without the guard on when Juno linked it, the draft is
  // deleted in Juno while Slack keeps it.
  action staleList(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") blur else
    if (s.label == "blur") startList else
    if (s.label == "startList") read else
    if (s.label == "read") claim else
    if (s.label == "claim") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") deliver else
    if (s.label == "deliver") finishListWith(r) else
    if (s.label == "finishList" and s.absence.on) applyAbsenceWith(r) else
    seal
  )
  action staleListStep = staleList(rules)
  action staleListBugStep = staleList({ ...rules, seenGuard: false })

  // Clearing a linked draft: its deletion carries the clear's time. Without
  // it Slack refuses the deletion, and the draft never leaves Slack.
  action clearStamp(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type" and s.field != 0) pauseWith(r) else
    if (s.label == "store" and s.local.id == 0) read else
    if (s.label == "read") claim else
    if (s.label == "claim") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") typeText(true) else
    if (s.label == "type") pauseWith(r) else
    seal
  )
  action clearStampStep = clearStamp(rules)
  action clearStampBugStep = clearStamp({ ...rules, clearTime: false })

  // The phone's newer draft lands between the sender's read and its claim.
  // Without reading again in the claim, Juno's older text overwrites it.
  action staleClaim(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type" and s.nextText == 4) pause else
    if (s.label == "store" and s.nextText == 4) read else
    if (s.label == "read" and s.nextText == 4) claim else
    if (s.label == "claim" and s.nextText == 4) accept else
    if (s.label == "accept" and s.nextText == 4) respond else
    if (s.label == "respond" and s.nextText == 4) deliver else
    if (s.label == "deliver" and s.nextText == 4) typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") blur else
    if (s.label == "blur") read else
    if (s.label == "read") phoneType else
    if (s.label == "phoneType") deliver else
    if (s.label == "deliver") claimWith(r) else
    if (s.label == "claim" and s.call.on) accept else
    if (s.label == "accept") respond else
    seal
  )
  action staleClaimStep = staleClaim(rules)
  action staleClaimBugStep = staleClaim({ ...rules, claimRead: false })

  // A list misses the draft the phone deleted (its event lost); before its
  // absence is written, the phone's new draft is linked. Without reading the
  // link again, the absence deletes the new draft.
  action staleAbsence(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") blur else
    if (s.label == "blur") read else
    if (s.label == "read") claim else
    if (s.label == "claim") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") deliver else
    if (s.label == "deliver" and not(s.absence.on) and s.slack.id != 0 and s.local.id == s.slack.id) disconnect else
    if (s.label == "disconnect") phoneDelete else
    if (s.label == "phoneDelete") reconnect else
    if (s.label == "reconnect") startList else
    if (s.label == "startList") finishList else
    if (s.label == "finishList") phoneType else
    if (s.label == "phoneType") deliver else
    if (s.label == "deliver" and s.absence.on) applyAbsenceWith(r) else
    seal
  )
  action staleAbsenceStep = staleAbsence(rules)
  action staleAbsenceBugStep = staleAbsence({ ...rules, absenceRecheck: false })

  // The phone makes a draft of files alone; Juno types in the topic. Without
  // telling a live files-only draft from a deletion, Juno marks it gone and
  // can never adopt it: its creates meet `attached_draft_exists` for ever.
  action filesOnly(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") phoneAttach else
    if (s.label == "phoneAttach") deliverWith(r) else
    if (s.label == "deliver") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") blur else
    seal
  )
  action filesOnlyStep = filesOnly(rules)
  action filesOnlyBugStep = filesOnly({ ...rules, liveFiles: false })

  // The connection drops while Juno's create is out, losing its answer and
  // echo, and the lists that should find its draft fail twice. Without
  // listing on, the row waits for a list that never comes.
  action listsFail(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") read else
    if (s.label == "read") claim else
    if (s.label == "claim") accept else
    if (s.label == "accept") disconnect else
    if (s.label == "disconnect") lose else
    if (s.label == "lose") reconnect else
    if ((s.label == "reconnect" or s.label == "failList") and s.listFailures < 2) startList else
    if (s.label == "startList" and s.listFailures < 2) failListWith(r) else
    seal
  )
  action listsFailStep = listsFail(rules)
  action listsFailBugStep = listsFail({ ...rules, keepListing: false })

  // Juno's clock runs behind: the phone's edit, made before Juno's typing,
  // carries a later stamp and replaces it. Without keeping the replaced text
  // it is gone; with it, ⌘Z brings it back and it goes over the phone's.
  action behindClock(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") phoneType else
    if (s.label == "phoneType") focus else
    if (s.label == "focus" and s.local.replaced == 0) typeText(false) else
    if (s.label == "type") pauseWith(r) else
    if (s.label == "store" and s.events.size() > 0) deliverWith(r) else
    if (s.label == "deliver") blur else
    if (s.label == "blur" and s.local.replaced != 0) focus else
    if (s.label == "focus") recover else
    if (s.label == "recover") pauseWith(r) else
    seal
  )
  action behindClockStep = behindClock(rules)
  action behindClockBugStep = behindClock({ ...rules, keepReplaced: false })

  // Typing not yet stored when Juno quits. Without storing it first, it is lost.
  action quitTyping(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") quitWith(r) else
    seal
  )
  action quitTypingStep = quitTyping(rules)
  action quitTypingBugStep = quitTyping({ ...rules, quitStores: false })

  // Juno's create is out when the phone makes a draft there and then changes
  // it: Juno's text is kept for ⌘Z when the first version replaces it.
  // Without keeping the first copy, the second version keeps the phone's
  // first text instead, and Juno's is gone.
  action copyTwice(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") read else
    if (s.label == "read") claim else
    if (s.label == "claim" or (s.label == "deliver" and s.nextText == 5)) phoneType else
    if (s.label == "phoneType") deliverWith(r) else
    if (s.label == "deliver" and s.call.on and not(s.call.accepted)) accept else
    if (s.label == "accept") respond else
    seal
  )
  action copyTwiceStep = copyTwice(rules)
  action copyTwiceBugStep = copyTwice({ ...rules, copyOnce: false })

  // Juno's update is answered late: the phone attached a file meanwhile, and
  // Juno saw it. Without ignoring the older answer, Juno forgets the draft has
  // files, and writes to it.
  action staleAnswer(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store" and parked(s, r)) seal else
    if (s.label == "store") read else
    if (s.label == "read") claim else
    if (s.label == "claim" and s.local.id == 0) accept else
    if (s.label == "accept" and s.local.id == 0) respond else
    if (s.label == "respond" and s.nextText == 4) typeText(false) else
    if (s.label == "claim" and s.call.on) accept else
    if (s.label == "accept" and s.nextText == 5) phoneAttach else
    if ((s.label == "phoneAttach" or s.label == "deliver") and s.events.size() > 0) deliver else
    if (s.label == "deliver" and s.call.on) respondWith(r) else
    if (s.label == "respond" and s.nextText == 5) typeText(false) else
    if (s.label == "accept") respond else
    seal
  )
  action staleAnswerStep = staleAnswer(rules)
  action staleAnswerBugStep = staleAnswer({ ...rules, freshAnswer: false })

  // Juno's create is out when the user types more; Slack refuses the first
  // text for good. Without settling only the generation it sent, the row
  // ends and the newer text never reaches Slack.
  action refusedEdit(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type" and not(s.call.on)) pause else
    if (s.label == "store" and not(s.call.on)) read else
    if (s.label == "read") claim else
    if (s.label == "claim") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") refuseCall else
    if (s.label == "refuse") respondWith(r) else
    seal
  )
  action refusedEditStep = refusedEdit(rules)
  action refusedEditBugStep = refusedEdit({ ...rules, refusalByGen: false })

  // Juno's create fails on the way, and the list that follows is requested
  // in the same millisecond: it cannot settle the find. Without listing on
  // while a find is owed, the create waits for a list that never comes.
  action sameMillisList(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") read else
    if (s.label == "read") claim else
    if (s.label == "claim") loseAt(0) else
    if (s.label == "lose") startListAt(0) else
    if (s.label == "startList") finishListWith(r) else
    seal
  )
  action sameMillisListStep = sameMillisList(rules)
  action sameMillisListBugStep = sameMillisList({ ...rules, listWhileOwed: false })

  // Juno's clock runs behind. Juno's create lands but its answer and echo
  // are late; the text goes as a message meanwhile, then the answer comes.
  // Without hiding a sent text, the late echo brings it back.
  action lateEcho(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") read else
    if (s.label == "read" and not(s.posting)) claim else
    if (s.label == "claim" and s.call.on and not(s.call.accepted)) accept else
    if (s.label == "accept") sendWith(true, r) else
    if (s.label == "send") respond else
    if (s.label == "respond") deliverLive(r) else
    seal
  )
  action lateEchoStep = lateEcho(rules)
  action lateEchoBugStep = lateEcho({ ...rules, hideSent: false })

  // Juno's create lands but its answer and echo are late; its text goes as a
  // message, the phone deletes the draft unheard, the answer is lost, and a
  // list that finds nothing settles the lost create. Two more texts go before
  // the echo comes. Without keeping the create's unsettled record past the
  // settled ones Juno forgets, the late echo brings the first text back.
  action manySends(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type" and s.nextSeq == 1) pause else
    if (s.label == "store") read else
    if (s.label == "read") claim else
    if (s.label == "claim") accept else
    if (s.label == "accept") sendWith(true, r) else
    if (s.label == "send" and s.nextSeq == 2) phoneDelete else
    if (s.label == "phoneDelete") lose else
    if (s.label == "lose") startList else
    if (s.label == "startList") finishListWith(r) else
    if (s.label == "finishList" or (s.label == "send" and s.nextSeq < 4)) postLands else
    if (s.label == "postLands") typeText(false) else
    if (s.label == "type") sendWith(true, r) else
    if (s.label == "send") deliverLive(r) else
    seal
  )
  action manySendsStep = manySends(rules)
  action manySendsBugStep = manySends({ ...rules, keepUnresolved: false })

  // Juno sends the draft into another place, and the phone writes on Slack's
  // draft after. Without asking Slack for nothing, the send is a clear Juno
  // saves, and Juno deletes Slack's draft.
  action sentElsewhere(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") read else
    if (s.label == "read" and not(s.posting)) claim else
    if (s.label == "claim" and not(s.posting)) accept else
    if (s.label == "accept" and not(s.posting)) respond else
    if (s.label == "respond") sendWith(false, r) else
    if (s.label == "send" and s.row.on) read else
    if (s.label == "send") phoneType else
    if (s.label == "read") claimWith(r) else
    if (s.label == "claim" and s.call.on) accept else
    if (s.label == "phoneType") deliver else
    seal
  )
  action sentElsewhereStep = sentElsewhere(rules)
  action sentElsewhereBugStep = sentElsewhere({ ...rules, sendAsksNothing: false })

  // The phone's draft has text and files; Juno types in the topic. Without
  // leaving a draft with files alone, Juno's update goes over it.
  action filesHandsOff(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") phoneType else
    if (s.label == "phoneType") phoneAttach else
    if ((s.label == "phoneAttach" or s.label == "deliver") and s.events.size() > 0) deliver else
    if (s.label == "deliver") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store" and parked(s, r)) blur else
    if (s.label == "store") readWith(r) else
    if (s.label == "read") claimWith(r) else
    if (s.label == "claim" and s.call.on) accept else
    seal
  )
  action filesHandsOffStep = filesHandsOff(rules)
  action filesHandsOffBugStep = filesHandsOff({ ...rules, filesHandsOff: false })

  // Juno's update is out when the phone empties the draft, keeping a file;
  // Juno takes that, and its update lands after. Without deleting only for
  // the user's clear, Juno deletes the draft to put the empty one back, and
  // what the phone writes next goes with it.
  action lateSave(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") read else
    if (s.label == "read" and s.local.id == 0) claim else
    if (s.label == "claim" and s.local.id == 0) accept else
    if (s.label == "accept" and s.local.id == 0) respond else
    if (s.label == "respond" and s.nextText == 4) deliver else
    if (s.label == "deliver" and s.nextText == 4) typeText(false) else
    if (s.label == "read") claimWith(r) else
    if (s.label == "claim" and s.call.on and s.nextText == 5 and not(s.slack.files)) phoneAttach else
    if (s.label == "phoneAttach") phoneEmpty else
    if ((s.label == "phoneEmpty" or s.label == "deliver") and s.events.size() > 0) deliver else
    if (s.label == "deliver" and s.call.on and not(s.call.accepted)) accept else
    if (s.label == "accept" and s.row.sending > 0) respond else
    if (s.label == "respond" and s.row.on) readWith(r) else
    if (s.label == "claim" and s.call.on) accept else
    seal
  )
  action lateSaveStep = lateSave(rules)
  action lateSaveBugStep = lateSave({ ...rules, clearOnly: false })

  // Juno sends the draft in its place; while the post waits, the phone changes
  // its text and attaches a file, and Slack refuses the post. Without keeping
  // the draft until Slack says it is retired, Juno drops what the phone wrote,
  // and stays empty while Slack's draft holds the phone's text and file.
  action refusedSend(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") startList else
    if (s.label == "startList") finishList else
    if (s.label == "finishList") focus else
    if (s.label == "focus" and s.local.id == 0) typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") read else
    if (s.label == "read") claim else
    if (s.label == "claim") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") deliver else
    if (s.label == "deliver" and not(s.posting)) sendWith(true, r) else
    if (s.label == "send") phoneType else
    if (s.label == "phoneType") phoneAttach else
    if ((s.label == "phoneAttach" or s.label == "deliver") and s.events.size() > 0) deliverWith(r) else
    if (s.label == "deliver") postRefusedWith(r) else
    seal
  )
  action refusedSendStep = refusedSend(rules)
  action refusedSendBugStep = refusedSend({ ...rules, retireOnConfirm: false })

  // Juno sends the draft in its place; the post lands and Juno sees Slack
  // retire the draft. Without keeping the draft until then, the retirement
  // finds it gone already and never settles the record of what was sent.
  action retireSettles(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") read else
    if (s.label == "read") claim else
    if (s.label == "claim") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") deliver else
    if (s.label == "deliver" and not(s.posting) and s.events.size() == 0 and s.local.text != 0) sendWith(true, r) else
    if (s.label == "send") postLands else
    if (s.label == "postLands") deliverGone(r) else
    seal
  )
  action retireSettlesStep = retireSettles(rules)
  action retireSettlesBugStep = retireSettles({ ...rules, retireOnConfirm: false })

  // Juno sends the draft in its place and Slack refuses the post; the user
  // types a new text, which Juno saves to the same draft, then retries the
  // message. Without the refusal dropping the draft from the post, the retry
  // retires the draft holding the new text.
  action retryAfterEdit(r: Rules): bool = tick(
    if (s.sealed) progress else
    if (s.label == "init") startList else
    if (s.label == "startList") finishList else
    if (s.label == "finishList") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") pause else
    if (s.label == "store") read else
    if (s.label == "read") claim else
    if (s.label == "claim") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") deliver else
    if (s.label == "deliver" and s.failed and s.events.size() == 0) retry else
    if (s.label == "deliver" and s.sentTexts.size() == 0 and s.events.size() == 0) sendWith(true, r) else
    if (s.label == "send") postRefusedWith(r) else
    if (s.label == "postRefused") typeText(false) else
    if (s.label == "retry") postLands else
    if ((s.label == "postLands" or s.label == "deliver") and s.events.size() > 0) deliver else
    seal
  )
  action retryAfterEditStep = retryAfterEdit(rules)
  action retryAfterEditBugStep = retryAfterEdit({ ...rules, refusalUnnames: false })

  // The first run: Juno's old draft and a newer one in Slack for the same
  // place. Juno's create answers that the place has a draft; the list that
  // follows merges the two by the rule, and the newer one stays.
  action firstRunStep = tick(
    if (s.sealed) progress else
    if (s.label == "init") read else
    if (s.label == "read") claim else
    if (s.label == "claim") accept else
    if (s.label == "accept") respond else
    if (s.label == "respond") startList else
    if (s.label == "startList") finishList else
    seal
  )

  // Typed offline; Juno quits and the draft reaches Slack once it is back.
  action offlineRestartStep = tick(
    if (s.sealed) progress else
    if (s.label == "init") disconnect else
    if (s.label == "disconnect") focus else
    if (s.label == "focus") typeText(false) else
    if (s.label == "type") quit else
    seal
  )
}

module drafts {
  import draftsProtocol(drainLimit = 48, eventLimit = 6).*
}
