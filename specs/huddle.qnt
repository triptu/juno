// One user's Huddle service. IDs are opaque, fresh attendee IDs are never reused.
// Successful reception includes the durable pending-leave write: see README for
// the unavoidable crash gap between an HTTP response and that transaction.
//
// Two processes with their own lifetimes share the call. The renderer page
// (generation `page`) runs the media; the engine never sees it, only main's
// report of the live page (`engineLive`) and the page's own state reports,
// which arrive in any order. The engine acts on what it can know
// (`engStopped`); the invariants check the page's actual `media`.
module huddle {
  val attendees = Set(1, 2, 3)
  val channels = Set(1, 2)
  val gens = Set(0, 1, 2, 3, 4)
  val workspaces = Set(1, 2)
  type Frame = { kind: str, channel: int, room: int, attendee: int }
  /** A page's whole media state: the session it holds, the last credentials it received, the last session it ended and why. */
  type Report = { gen: int, conn: int, seq: int, holds: int, recv: int, ended: int, reason: str }
  /** Credentials on their way to page `gen` as the answer to a Start that came on engine connection `conn`. */
  type HandOff = { gen: int, conn: int, a: int }
  type State = {
    up: bool, quitting: bool, phase: str, wanted: int, request: int, cancel: bool,
    wantedPage: int, requestPage: int, wantedConn: int, requestConn: int,
    current: int, channel: int -> int, room: int -> int,
    received: Set[int], pending: Set[int], unsent: Set[int], sent: Set[int],
    cancelled: Set[int], handed: Set[int], otherDevice: bool,
    ws: int, recWs: int -> int, loadedWs: Set[int],
    holder: int -> int, handedAt: int -> int, handConn: int -> int, handCount: int, staleGone: Set[int],
    engineLive: int, engineMax: int, engineSeen: Set[int], closedSeen: int, engReports: int -> Report,
    page: int, conn: int, media: Set[int], pageRecv: int, pageSeq: int, pageEnded: int, pageReason: str,
    rule: int,
    persisted: int, persistGen: int, persistConn: int, persistCancel: bool, persistBug: int, persistCaller: bool, startCancelled: bool,
    pageDirty: bool, pageResend: bool, outbox: Set[Report], handOffs: Set[HandOff],
    connected: bool, dirty: bool, epoch: int, fetchEpoch: int,
    fetching: bool, snapshot: Set[int], snapshotVersion: int,
    slack: Set[int], served: Set[int], servedVersion: int, settling: bool, shown: Set[int], version: int,
    frames: Set[Frame], leaveReplies: Set[int], lastReply: str,
    sealed: bool, label: str
  }
  var s: State
  var before: State
  var turn: int
  var remaining: int

  pure val noReport = { gen: 0, conn: 0, seq: 0, holds: 0, recv: 0, ended: 0, reason: "" }
  pure val initial = {
    up: true, quitting: false, phase: "idle", wanted: 0, request: 0, cancel: false,
    wantedPage: 0, requestPage: 0, wantedConn: 0, requestConn: 0,
    current: 0, channel: attendees.mapBy(_ => 0), room: attendees.mapBy(_ => 0),
    received: Set(), pending: Set(), unsent: Set(), sent: Set(),
    cancelled: Set(), handed: Set(), otherDevice: false,
    ws: 1, recWs: attendees.mapBy(_ => 0), loadedWs: workspaces,
    holder: attendees.mapBy(_ => 0), handedAt: Set(0, 1, 2, 3).mapBy(_ => 0), handConn: attendees.mapBy(_ => 0), handCount: 0, staleGone: Set(),
    engineLive: 1, engineMax: 1, engineSeen: Set(1), closedSeen: 0, engReports: gens.mapBy(_ => noReport),
    page: 1, conn: 1, media: Set(), pageRecv: 0, pageSeq: 0, pageEnded: 0, pageReason: "",
    rule: 0,
    persisted: 0, persistGen: 0, persistConn: 0, persistCancel: false, persistBug: 0, persistCaller: true, startCancelled: false,
    pageDirty: false, pageResend: false, outbox: Set(), handOffs: Set(),
    connected: true, dirty: true, epoch: 0,
    fetchEpoch: -1, fetching: false, snapshot: Set(), snapshotVersion: 0,
    slack: Set(), served: Set(), servedVersion: 0, settling: false, shown: Set(), version: 0, frames: Set(), leaveReplies: Set(),
    lastReply: "", sealed: false, label: "init"
  }
  action init = all { s' = initial, before' = initial, turn' = 0, remaining' = 32 }
  action disabled = all { false, s' = s }

  // Main gives out page generations in rising order and reports the live one
  // and the highest it gave out: every generation at or below that which is
  // not live is gone. Old rule (rule 12): a generation was gone only once main
  // had listed it, so one that died unlisted stayed pending.
  pure def gone(st: State, g: int): bool =
    if (st.rule == 12) st.engineSeen.contains(g) and g != st.engineLive
    else st.engineMax != 0 and g <= st.engineMax and g != st.engineLive

  // What the engine can know of an attendee's media: no page got its
  // credentials, main's report shows its page gone (a page of an earlier
  // engine process that main does not list is gone too), or its page's latest
  // report, sent after the hand-off, does not hold it. A report is after the
  // hand-off when it came on a later engine connection of the page (the
  // earlier one is closed), or on the same one and names the credentials.
  // Old rules: bug 8, a page gone before the answer was an event already
  // consumed (`staleGone`); rule 11, a report placed itself only by the
  // credentials it names, so one lost with its connection placed none.
  pure def engStopped(st: State, a: int): bool = {
    pure val g = st.holder.get(a)
    pure val r = st.engReports.get(g)
    pure val earlier = st.handedAt.get(a) == 0
    pure val after = if (st.rule == 11) r.recv != 0 and st.handedAt.get(r.recv) >= st.handedAt.get(a)
      else r.conn > st.handConn.get(a) or (r.conn == st.handConn.get(a) and r.recv == a)
    g == 0 or
    (gone(st, g) and not(st.staleGone.contains(a))) or
    (earlier and st.engineLive != 0 and g != st.engineLive) or
    (r.seq > 0 and r.holds != a and (earlier or after))
  }

  // Start and Join share rooms.join. A new intent cancels an older join; it
  // cannot issue another request until the older attendee has been cleaned up.
  // The asking page gets the credentials, once main lists it.
  action choose(c: int): bool = all {
    s.up, not(s.quitting),
    s' = { ...s, wanted: c, wantedPage: s.page, wantedConn: s.conn, cancel: s.request != 0, current: 0, startCancelled: false,
      phase: if (s.request != 0 or s.pending.size() > 0) "leaving" else "idle",
      otherDevice: false, label: "choose" }
  }
  action leave = all {
    s.up,
    s' = { ...s, wanted: 0, current: 0, cancel: s.request != 0,
      phase: if (s.request != 0 or s.pending.size() > 0) "leaving" else "idle", label: "leave" }
  }
  // Every workspace's stored leaves are loaded, none of this workspace's are
  // left, and every other workspace's attendee is known stopped. Old rule
  // (bug 10): only the active workspace was loaded, so another's attendee was
  // not known at all after a restart.
  action requestJoin(bug: int): bool = all {
    s.up, s.wanted != 0, s.request == 0, s.wantedPage == s.engineLive,
    if (bug == 10) s.loadedWs.contains(s.ws) else s.loadedWs == workspaces,
    s.pending.filter(a => s.loadedWs.contains(s.recWs.get(a))).forall(a => s.recWs.get(a) != s.ws and engStopped(s, a)),
    s.received != attendees, not(s.otherDevice),
    s' = { ...s, request: s.wanted, requestPage: s.wantedPage, requestConn: s.wantedConn, wanted: 0, cancel: false, phase: "joining", label: "request" }
  }
  // The answer is stored first (`answerJoin`), then handed to the asking
  // page in a step of its own (`handOff`) if the join was not cancelled, main
  // still lists the page, and the Start still waits for it. The Start can be
  // cancelled between the two (`cancelStart` takes no lock); a cancelled one
  // gets nothing, so no page has the credentials and the attendee is left at
  // once. Old rules: bug 1 skips the record; bug 3 hands out a cancelled
  // answer; bug 8 hands out to a page that went while the join was out; bug
  // 13 decides on the Start before the store, so a Start cancelled during it
  // is recorded as holding credentials no page ever gets.
  pure def stored(st: State, a: int, r: int, bug: int): State = {
    // The Start's connection closed and the engine knows it: no page will get the answer.
    pure val g = if (bug == 3 or bug == 8) st.requestPage else if (st.cancel or st.requestPage != st.engineLive or st.requestConn < st.closedSeen) 0 else st.requestPage
    { ...st, request: 0, received: st.received.union(Set(a)),
      channel: st.channel.set(a, st.request), room: st.room.set(a, r),
      pending: if (bug == 1) st.pending else st.pending.union(Set(a)),
      unsent: st.unsent.union(Set(a)), recWs: st.recWs.set(a, st.ws), holder: st.holder.set(a, 0),
      staleGone: if (bug == 8) st.staleGone.union(Set(a)) else st.staleGone,
      cancelled: if (st.cancel) st.cancelled.union(Set(a)) else st.cancelled,
      persisted: a, persistGen: g, persistConn: st.requestConn, persistCancel: st.cancel, persistBug: bug,
      persistCaller: not(st.startCancelled), phase: "joining", label: "answer" }
  }
  pure def handedOff(st: State, bug: int): State = {
    pure val a = st.persisted
    pure val waiting = if (bug == 13) st.persistCaller else not(st.startCancelled)
    pure val handOff = st.persistGen != 0 and (st.persistBug == 3 or st.persistBug == 8 or not(st.persistCancel)) and waiting
    // Credentials for a cancelled Start go back on its cancelled request, never to the page.
    pure val reaches = handOff and not(st.startCancelled)
    { ...st, holder: st.holder.set(a, if (handOff) st.persistGen else 0),
      handedAt: if (handOff) st.handedAt.set(a, st.handCount + 1) else st.handedAt,
      handConn: if (handOff) st.handConn.set(a, st.persistConn) else st.handConn,
      handCount: if (handOff) st.handCount + 1 else st.handCount,
      handOffs: if (reaches) st.handOffs.union(Set({ gen: st.persistGen, conn: st.persistConn, a: a })) else st.handOffs,
      handed: if (handOff) st.handed.union(Set(a)) else st.handed,
      current: if (handOff and (st.persistBug == 3 or not(st.persistCancel))) a else 0,
      persisted: 0, startCancelled: false, phase: if (handOff) "joining" else "leaving", label: "handOff" }
  }
  action answerJoin(a: int, r: int, bug: int): bool = all {
    s.up, s.request != 0, s.persisted == 0, not(s.received.contains(a)),
    s' = stored(s, a, r, bug)
  }
  action handOff(bug: int): bool = all { s.up, s.persisted != 0, s' = handedOff(s, bug) }
  /** Store and hand off with nothing between, for schedules about other things. */
  action answerNow(a: int, r: int, bug: int): bool = all {
    s.up, s.request != 0, s.persisted == 0, not(s.received.contains(a)),
    s' = handedOff(stored(s, a, r, bug), 0)
  }
  // The page's Start request is cancelled while its connection stays open
  // (the user's Cancel during "Joining…"). Its intent stays; its answer is
  // handed to no page.
  action cancelStart = all {
    s.up, not(s.startCancelled), s.wanted != 0 or s.request != 0 or s.persisted != 0,
    s' = { ...s, startCancelled: true, label: "cancelStart" }
  }
  action joinError = all {
    s.up, s.request != 0,
    s' = { ...s, request: 0, phase: "idle", cancel: false, label: "joinError" }
  }
  // What the pages' state means for the call: a queued Start of a page that
  // went is dropped, a join in flight for one is cancelled, and the current
  // call ends once its media is stopped. Old rule (bug 6): the call stays.
  action reconcile(bug: int): bool = all {
    s.up,
    val stoppedCurrent = s.current != 0 and engStopped(s, s.current)
    val ends = stoppedCurrent and bug != 6
    val r = s.engReports.get(s.holder.get(s.current))
    s' = { ...s,
      wanted: if (ends or (s.wanted != 0 and gone(s, s.wantedPage))) 0 else s.wanted,
      cancel: s.cancel or (s.request != 0 and (gone(s, s.requestPage) or ends)),
      current: if (ends) 0 else s.current,
      otherDevice: s.otherDevice or (stoppedCurrent and r.ended == s.current and r.reason == "AudioJoinedFromAnotherDevice"),
      phase: if (ends) "leaving" else s.phase, label: "reconcile" }
  }
  pure def needsReconcile(st: State): bool =
    (st.wanted != 0 and gone(st, st.wantedPage)) or
    (st.request != 0 and not(st.cancel) and gone(st, st.requestPage)) or
    (st.current != 0 and engStopped(st, st.current))
  // Leave stops the page's media and sends rooms.leave at once; the stored
  // record is cleared only once the media is known stopped (and its request
  // has gone out): `leave` clears `current`, so the page stops the media,
  // `sendLeave` sends at once, and `clearLeave` waits for `engStopped`.
  action sendLeave(a: int): bool = all {
    s.up, s.loadedWs.contains(s.ws), s.recWs.get(a) == s.ws, s.pending.contains(a), a != s.current, s.unsent.contains(a),
    s' = { ...s, sent: s.sent.union(Set(a)), unsent: s.unsent.exclude(Set(a)),
      leaveReplies: s.leaveReplies.union(Set(a)), label: "sendLeave" }
  }
  // Any answer from Slack, an error included, means it took the leave. A
  // refusal before Slack took it (a rate limit, the network, the session)
  // means it did not: the record is pending and unsent again, even if it was
  // already cleared, and goes out again.
  action leaveAnswer(a: int, answer: str, bug: int): bool = all {
    s.up, s.leaveReplies.contains(a),
    s' = if (answer != "refused") { ...s, leaveReplies: s.leaveReplies.exclude(Set(a)), lastReply: answer, label: "leaveAnswer" }
      else { ...s, leaveReplies: s.leaveReplies.exclude(Set(a)), lastReply: answer, sent: s.sent.exclude(Set(a)),
        pending: if (bug == 7) s.pending else s.pending.union(Set(a)),
        unsent: if (bug == 7) s.unsent else s.unsent.union(Set(a)), label: "leaveRefused" }
  }
  action clearLeave(a: int): bool = all {
    s.up, s.loadedWs.contains(s.ws), s.recWs.get(a) == s.ws, s.pending.contains(a), a != s.current, not(s.unsent.contains(a)), engStopped(s, a),
    s' = { ...s, pending: s.pending.exclude(Set(a)), phase: "idle", label: "clearLeave" }
  }

  // The page. It decides on credentials when they arrive: start the session
  // (only one at a time) or never. Credentials for an older page are lost
  // with it. It stops a session when the engine's call no longer names it,
  // or Chime ends it (another device, a lost connection). Each change marks
  // its state to be reported; so does every new connection to the engine.
  action receive(h: HandOff, start: bool): bool = all {
    s.handOffs.contains(h),
    s' = if (h.gen != s.page or h.conn != s.conn) { ...s, handOffs: s.handOffs.exclude(Set(h)), label: "handOffLost" }
      else { ...s, handOffs: s.handOffs.exclude(Set(h)), pageRecv: h.a,
        media: if (start and s.media.size() == 0) Set(h.a) else s.media, pageDirty: true, label: "receive" }
  }
  action pageStop(a: int, reason: str): bool = all {
    s.media.contains(a),
    s' = { ...s, media: s.media.exclude(Set(a)), pageEnded: a, pageReason: reason, pageDirty: true, label: "pageStop" }
  }
  action pageReport = all {
    s.outbox.size() < 2,
    val holds = if (s.media.size() == 0) 0 else s.media.fold(0, (x, y) => y)
    s' = { ...s, pageSeq: s.pageSeq + 1, pageDirty: false, pageResend: false,
      outbox: s.outbox.union(Set({ gen: s.page, conn: s.conn, seq: s.pageSeq + 1, holds: holds, recv: s.pageRecv, ended: s.pageEnded, reason: s.pageReason })),
      label: "pageReport" }
  }
  // The latest report per page wins, whatever order they arrive in; a page
  // main shows gone is ignored. Old rule (bug 9): a report that came before
  // the stored leaves were loaded found nothing to stop, and was lost.
  action deliver(r: Report, bug: int): bool = all {
    s.up, s.outbox.contains(r),
    val keep = not(gone(s, r.gen)) and not(bug == 9 and not(s.loadedWs.contains(s.ws))) and r.seq > s.engReports.get(r.gen).seq
    s' = { ...s, outbox: s.outbox.exclude(Set(r)), engReports: if (keep) s.engReports.set(r.gen, r) else s.engReports, label: "deliver" }
  }
  action deliverAny = if (s.outbox == Set()) disabled else { nondet r = s.outbox.oneOf() deliver(r, 0) }
  action receiveAny(start: bool): bool = if (s.handOffs == Set()) disabled else { nondet h = s.handOffs.oneOf() receive(h, start) }
  // The page reloads, crashes or closes at any time, before a hand-off too; a new page loads.
  action pageEnd = all {
    s.page < 4,
    s' = { ...s, page: s.page + 1, conn: s.conn + 1, media: Set(), pageRecv: 0, pageSeq: 0, pageEnded: 0, pageReason: "",
      pageDirty: false, pageResend: true, outbox: s.outbox.filter(r => r.conn > s.conn), label: "pageEnd" }
  }
  // The live page's engine connection closes and it reconnects: answers and
  // reports still on the old connection are lost; the page sends its state
  // again. The engine learns later that the old connection closed.
  action pageReconnect = all {
    s.conn < 6,
    s' = { ...s, conn: s.conn + 1, pageResend: true, outbox: s.outbox.filter(r => r.conn > s.conn), label: "pageReconnect" }
  }
  action seeClosed = all { s.up, s.closedSeen < s.conn, s' = { ...s, closedSeen: s.conn, label: "seeClosed" } }
  // The user switches workspace: the session ends (no call, no queued join)
  // and the other one's starts. The page may still hold the old attendee.
  action switchWs = all {
    s.up, s.request == 0,
    s' = { ...s, ws: 3 - s.ws, wanted: 0, current: 0, cancel: false, phase: "idle", label: "switchWs" }
  }
  // Main's report of the live page, in order, possibly late.
  action mainReport = all { s.up, s' = { ...s, engineLive: s.page, engineMax: s.page, engineSeen: s.engineSeen.union(Set(s.page)), label: "mainReport" } }

  action quit = all {
    s.up, not(s.quitting),
    s' = { ...s, quitting: true, wanted: 0, current: 0, cancel: s.request != 0,
      phase: "leaving", label: "quit" }
  }
  action finishQuit = all {
    s.up, s.quitting, s.pending.size() == 0, s.request == 0,
    s' = { ...s, up: false, connected: false, label: "finishQuit" }
  }
  // An engine process loses intent, HTTP responses, its knowledge of pages
  // and reports, and what was in flight between it and the page; not disk.
  pure def engineLost(st: State): State = { ...st, up: false, loadedWs: Set(), current: 0, wanted: 0, request: 0, cancel: false,
    phase: "idle", connected: false, fetching: false, frames: Set(), leaveReplies: Set(),
    handedAt: Set(0, 1, 2, 3).mapBy(_ => 0), handConn: attendees.mapBy(_ => 0), handCount: 0, staleGone: Set(),
    engineLive: 0, engineMax: 0, engineSeen: Set(), closedSeen: 0, engReports: gens.mapBy(_ => noReport),
    persisted: 0, startCancelled: false,
    outbox: Set(), handOffs: Set(), unsent: st.pending }
  // The whole app crashes: the page goes with it, and its media.
  action crash = all {
    s.up, s.page < 4,
    s' = { ...engineLost(s), page: s.page + 1, conn: s.conn + 1, media: Set(), pageRecv: 0, pageSeq: 0, pageEnded: 0, pageReason: "",
      pageDirty: false, pageResend: true, label: "crash" }
  }
  // The engine alone crashes; the page lives on with its media.
  action engineCrash = all { s.up, s' = { ...engineLost(s), label: "engineCrash" } }
  // The page's connection opens to the new engine, and it sends its state again.
  // The stored leaves load later (`load`), after any number of reports.
  action restart = all {
    not(s.up),
    s' = { ...s, up: true, quitting: false, connected: true, dirty: true, settling: true, pageResend: true, conn: s.conn + 1,
      epoch: s.epoch + 1, fetching: false, unsent: s.pending, phase: "leaving", label: "restart" }
  }
  action load(w: int): bool = all { s.up, not(s.loadedWs.contains(w)), s' = { ...s, loadedWs: s.loadedWs.union(Set(w)), label: "load" } }

  // Slack's running list includes other people. Its changes are independent of
  // media: arch v2 can retain an empty huddle after the local media has stopped.
  // `huddles/info` answers `served`, Slack's list as of `servedVersion`, which
  // lags `slack` until `catchUp`.
  action slackChange(c: int): bool = all {
    s' = { ...s, slack: if (s.slack.contains(c)) s.slack.exclude(Set(c)) else s.slack.union(Set(c)),
      version: s.version + 1,
      frames: if (s.up and s.connected) Set({ kind: "sh_room_update", channel: c, room: c, attendee: 0 }) else s.frames,
      dirty: if (s.up and s.connected and s.frames.size() > 0) true else s.dirty,
      epoch: if (s.up and s.connected and s.frames.size() > 0) s.epoch + 1 else s.epoch,
      label: "slackChange" }
  }
  action queueFrame(f: Frame): bool = all {
    s.up, s.connected, s.frames.size() < 2,
    s' = { ...s, frames: s.frames.union(Set(f)), label: "queueFrame" }
  }
  // Slack's edge catches up with its socket.
  action catchUp = all { s.servedVersion != s.version, s' = { ...s, served: s.slack, servedVersion: s.version, label: "catchUp" } }
  // Old rule (rule 14): a frame's channel was read at once, while the edge
  // could still answer from before the frame.
  action roomFrame(f: Frame, bug: int): bool = all {
    s.up, s.connected, s.frames.contains(f),
    s' = { ...s, dirty: true, epoch: s.epoch + 1, settling: if (bug == 14) s.settling else true,
      // Observed frames have a user id, not an attendee id. Even a same-room
      // self-leave cannot identify the current media session. Refetch only.
      current: if (bug == 4 and f.kind == "sh_room_leave") 0 else s.current,
      frames: s.frames.exclude(Set(f)), label: "roomFrame" }
  }
  action disconnect = all {
    s.up, s.connected,
    s' = { ...s, connected: false, frames: Set(), epoch: s.epoch + 1, dirty: true, label: "disconnect" }
  }
  action reconnect = all {
    s.up, not(s.connected),
    s' = { ...s, connected: true, dirty: true, settling: true, epoch: s.epoch + 1, label: "reconnect" }
  }
  action overflow(bug: int): bool = all {
    s.up, s.connected,
    s' = { ...s, frames: Set(), dirty: if (bug == 5) s.dirty else true, settling: true,
      epoch: s.epoch + 1, label: "overflow" }
  }
  // The engine reads once the socket has been quiet for the settle time. The
  // guard is the timing assumption: by then the edge has caught up with every
  // change before the frame, connect or overflow that started the wait.
  action settle = all { s.up, s.settling, s.servedVersion == s.version, s' = { ...s, settling: false, label: "settle" } }
  action fetchInfo = all {
    s.up, s.connected, s.dirty, not(s.fetching), not(s.settling),
    s' = { ...s, fetching: true, fetchEpoch: s.epoch, snapshot: s.served,
      snapshotVersion: s.servedVersion, label: "fetchInfo" }
  }
  action answerInfo = all {
    s.up, s.fetching,
    s' = if (s.fetchEpoch == s.epoch and s.connected)
      { ...s, fetching: false, shown: s.snapshot, dirty: false, label: "answerInfo" }
      else { ...s, fetching: false, dirty: true, label: "discardInfo" }
  }
  action infoError = all { s.fetching, s' = { ...s, fetching: false, dirty: true, label: "infoError" } }

  // Quiet means the user leaves, Slack stops changing, failures cease, the app
  // restarts and delivery recovers. Drain uses real actions, never assigns agreement.
  // A Start of a page that already died cannot be withdrawn by the user;
  // the engine must drop it.
  action seal = all {
    s' = { ...s, sealed: true, wanted: if (s.wantedPage == s.page) 0 else s.wanted, current: 0, cancel: s.request != 0,
      phase: "leaving", label: "seal" }
  }
  /** Credentials on their way to the live page, which may still start them. */
  pure def liveHandOffs(st: State): Set[int] = st.handOffs.filter(h => h.gen == st.page).map(h => h.a)
  val cleaned = s.received.subseteq(s.sent) and s.media.size() == 0 and liveHandOffs(s).size() == 0
  val settled = s.up and s.loadedWs == workspaces and s.connected and s.engineLive == s.page and s.current == 0 and s.request == 0 and s.wanted == 0 and
    s.pending.size() == 0 and s.frames.size() == 0 and not(s.fetching) and not(s.dirty) and
    s.outbox.size() == 0 and s.handOffs.size() == 0
  val reachedAgreement = s.sealed and settled and cleaned and s.shown == s.slack
  // Every attendee Juno durably received has a leave pending or sent, and any
  // media that runs or may still start has its record: the engine only clears
  // a record when what it can know says the media stopped.
  val noGhost = s.received.subseteq(s.pending.union(s.sent)) and
    s.media.union(liveHandOffs(s)).subseteq(s.pending) and (s.sealed and settled implies cleaned)
  val oneCall = s.media.size() <= 1 and (s.request != 0 implies (s.media.size() == 0 and liveHandOffs(s).size() == 0)) and
    (s.label == "request" implies before.pending.forall(a => before.recWs.get(a) != before.ws))
  val leaveDuringJoin = not(s.cancelled.contains(s.current)) and s.cancelled.intersect(s.handed).size() == 0 and
    (s.sealed and settled implies s.cancelled.subseteq(s.sent))
  val noStaleLeave = s.label == "roomFrame" implies s.current == before.current
  val matchingState = (s.label == "answerInfo" and s.snapshotVersion == s.version implies s.shown == s.slack) and
    (s.sealed and settled implies s.shown == s.slack)
  val otherDevice = s.otherDevice implies s.current == 0 and s.request == 0 and s.wanted == 0
  val drainBound = remaining > 0 or reachedAgreement
  val invariants = noGhost and oneCall and leaveDuringJoin and noStaleLeave and matchingState and otherDevice and drainBound

  action progress =
    if (not(s.up)) restart
    else if (s.persisted != 0) handOff(0)
    else if (s.loadedWs != workspaces) { nondet w = workspaces.exclude(s.loadedWs).oneOf() load(w) }
    else if (s.engineLive != s.page) mainReport
    else if (s.closedSeen < s.conn) seeClosed
    else if (s.handOffs != Set()) receiveAny(false)
    else if (s.media.exclude(Set(s.current)) != Set()) { nondet a = s.media.exclude(Set(s.current)).oneOf() pageStop(a, "left") }
    else if (s.pageDirty or s.pageResend) pageReport
    else if (s.outbox != Set()) deliverAny
    else if (needsReconcile(s)) reconcile(0)
    else if (s.request != 0) { nondet a = attendees.exclude(s.received).oneOf() answerJoin(a, 1, 0) }
    else if (s.pending.size() > 0) {
      val movable = s.pending.filter(a => s.recWs.get(a) == s.ws and (s.unsent.contains(a) or (a != s.current and engStopped(s, a))))
      // Another workspace's leaves go out through its own session.
      if (movable == Set() and s.pending.exists(a => s.recWs.get(a) != s.ws)) switchWs
      else if (movable == Set()) all { s' = { ...s, label: "stuck" } }
      else {
        nondet a = movable.oneOf()
        if (s.unsent.contains(a)) sendLeave(a) else clearLeave(a)
      }
    } else if (not(s.connected)) reconnect
    else if (s.frames.size() > 0) { nondet f = s.frames.oneOf() roomFrame(f, 0) }
    else if (s.fetching) answerInfo
    else if (s.settling) (if (s.servedVersion != s.version) catchUp else settle)
    else if (s.dirty) fetchInfo
    else all { s' = { ...s, label: "idle" } }

  // While an answer is being stored the engine holds its lock: only the
  // hand-off, a Start's cancel, the page, Slack and a crash can act.
  action input = {
    nondet a = attendees.oneOf()
    nondet c = channels.oneOf()
    nondet r = channels.oneOf()
    nondet kind = Set("sh_room_join", "sh_room_leave", "sh_room_update").oneOf()
    if (s.persisted != 0) any {
      handOff(0), cancelStart, receiveAny(true), receiveAny(false), pageReport, pageEnd, pageReconnect,
      pageStop(a, "left"), pageStop(a, "AudioJoinedFromAnotherDevice"), pageStop(a, "connectionLost"),
      crash, engineCrash, slackChange(c), catchUp
    } else any {
      cancelStart,
      choose(c), leave, requestJoin(0), answerJoin(a, r, 0), joinError, reconcile(0),
      sendLeave(a), clearLeave(a),
      leaveAnswer(a, "ok", 0), leaveAnswer(a, "feature_not_enabled", 0), leaveAnswer(a, "refused", 0),
      receiveAny(true), receiveAny(false), pageReport, deliverAny, pageEnd, mainReport, pageReconnect, seeClosed, switchWs,
      pageStop(a, "left"), pageStop(a, "AudioJoinedFromAnotherDevice"), pageStop(a, "connectionLost"),
      quit, finishQuit, crash, engineCrash, restart, load(1), load(2), slackChange(c), catchUp, settle,
      queueFrame({ kind: kind, channel: c, room: r, attendee: a }),
      roomFrame({ kind: kind, channel: c, room: r, attendee: a }, 0),
      disconnect, reconnect, overflow(0), fetchInfo, answerInfo, infoError, seal
    }
  }
  action tick(a: bool): bool = all {
    a, before' = s, turn' = turn + 1,
    remaining' = if (s.sealed and not(reachedAgreement)) remaining - 1 else remaining
  }
  action step = tick(if (s.sealed) progress else input)
  action simulationStep = all { not(reachedAgreement), step }
  temporal eventualCleanup = progress.weakFair(s).implies(
    eventually(always(s.sealed)).implies(eventually(always(cleaned))))
  temporal eventualAgreement = progress.weakFair(s).implies(
    eventually(always(s.sealed)).implies(eventually(always(s.shown == s.slack))))

  // Scenario shorthands: the page starts the credentials it is handed, and a
  // page stop whose report reaches the engine at once.
  action startMedia = receiveAny(true)
  action stopReported(a: int, reason: str): bool = all {
    s.up, s.media.contains(a),
    val r = { gen: s.page, conn: s.conn, seq: s.pageSeq + 1, holds: 0, recv: s.pageRecv, ended: a, reason: reason }
    s' = { ...s, media: s.media.exclude(Set(a)), pageEnded: a, pageReason: reason, pageSeq: s.pageSeq + 1,
      pageDirty: false, engReports: s.engReports.set(s.page, r), label: "stopReported" }
  }
  /** A Start under an old rule (`rule`), for its counterexample. */
  action chooseUnder(c: int, rule: int): bool = all {
    s.up,
    s' = { ...s, wanted: c, wantedPage: s.page, wantedConn: s.conn, rule: rule, otherDevice: false, startCancelled: false, label: "choose" }
  }
  action deliverWith(bug: int): bool = if (s.outbox == Set()) disabled else { nondet r = s.outbox.oneOf() deliver(r, bug) }

  // Directed witnesses run alongside random schedules. Mutation variants only
  // disable the named rule; the default state machine always uses bug = 0.
  action scenario(which: int, bug: int): bool = tick(
    if (s.sealed) progress
    else if (which == 22) (
      // Slack changes and its frame arrives while its edge still answers from before.
      if (turn == 0) slackChange(1)
      else if (turn == 1) roomFrame({ kind: "sh_room_update", channel: 1, room: 1, attendee: 0 }, bug)
      else if (bug == 14) (if (turn == 2) fetchInfo else if (turn == 3) answerInfo else seal)
      else if (turn == 2) catchUp else if (turn == 3) settle
      else if (turn == 4) fetchInfo else if (turn == 5) answerInfo else seal
    ) else if (which == 5) (
      if (turn == 0) fetchInfo else if (turn == 1) answerInfo
      else if (turn == 2) slackChange(2) else if (turn == 3) overflow(bug)
      else seal
    ) else if (which == 21) (
      // The user cancels the Start while its answer is being stored; the
      // page's connection stays open, and its reports there hold nothing.
      if (turn == 0) choose(1) else if (turn == 1) requestJoin(0)
      else if (turn == 2) answerJoin(1, 1, 0) else if (turn == 3) cancelStart
      else if (turn == 4) handOff(bug) else if (turn == 5) pageReport
      else if (turn == 6) deliverAny else seal
    ) else if (which == 18) (
      // The Start's connection closes and the page reconnects while Slack has
      // the join; the answer goes out on the old connection and is lost.
      if (turn == 0) chooseUnder(1, bug) else if (turn == 1) requestJoin(0)
      else if (turn == 2) pageReconnect else if (turn == 3) answerNow(1, 1, 0)
      else if (turn == 4) pageReport else if (turn == 5) deliverAny else seal
    ) else if (which == 19) (
      // The user switches workspace mid-call and the engine restarts while
      // the page still holds the first workspace's attendee.
      if (turn == 0) choose(1) else if (turn == 1) requestJoin(0)
      else if (turn == 2) answerNow(1, 1, 0) else if (turn == 3) startMedia
      else if (turn == 4) switchWs else if (turn == 5) engineCrash
      else if (turn == 6) restart else if (turn == 7) load(2)
      else if (turn == 8) mainReport else if (turn == 9) choose(2)
      else if (turn == 10 and bug == 10) requestJoin(10) else seal
    ) else if (which == 20) (
      // A page main gave out asks, then dies before main lists it.
      if (turn == 0) pageEnd else if (turn == 1) chooseUnder(1, bug)
      else if (turn == 2) pageEnd else if (turn == 3) mainReport else seal
    ) else if (turn == 0) choose(1)
    else if (turn == 1) requestJoin(0)
    else if (which == 16) (
      // The page dies while its join is out; main says so before the answer.
      if (turn == 2) pageEnd else if (turn == 3) mainReport
      else if (turn == 4) answerNow(1, 1, bug) else seal
    )
    else if (which == 3 and turn == 2) leave
    else if (which == 3 and turn == 3) answerNow(1, 1, bug)
    else if (which == 3) seal
    else if (which == 10 and turn == 2) joinError
    else if (which == 10) seal
    else if (turn == 2) answerNow(1, 1, bug)
    else if (which == 11 and turn == 3) crash
    else if (which == 11) seal
    else if (turn == 3) startMedia
    else if (which == 1) (if (turn == 4) crash else seal)
    else if (which == 2 or which == 4) (
      if (turn == 4) choose(2)
      else if (turn == 5 and bug == 2)
        all { s' = { ...s, request: 2, requestPage: s.page, wanted: 0, phase: "joining", label: "request" } }
      else if (turn == 5) sendLeave(1)
      else if (turn == 6) stopReported(1, "left")
      else if (turn == 7) clearLeave(1)
      else if (turn == 8) requestJoin(0)
      else if (turn == 9) answerNow(2, 2, 0)
      else if (turn == 10) startMedia
      else if (which == 4 and turn == 11) queueFrame({kind: "sh_room_leave", channel: 1, room: 1, attendee: 1})
      else if (which == 4 and turn == 12) roomFrame({kind: "sh_room_leave", channel: 1, room: 1, attendee: 1}, bug)
      else if (which == 4 and turn == 13) queueFrame({kind: "sh_room_leave", channel: 2, room: 2, attendee: 1})
      else if (which == 4 and turn == 14) roomFrame({kind: "sh_room_leave", channel: 2, room: 2, attendee: 1}, bug)
      else if (which == 4 and turn == 15) queueFrame({kind: "sh_room_leave", channel: 2, room: 2, attendee: 1})
      else if (which == 4 and turn == 16) roomFrame({kind: "sh_room_leave", channel: 2, room: 2, attendee: 1}, bug)
      else seal
    ) else if (which == 6) (
      if (turn == 4) stopReported(1, "AudioJoinedFromAnotherDevice")
      else if (turn == 5) reconcile(bug)
      else if (turn == 6) disconnect else if (turn == 7) reconnect else seal
    ) else if (which == 7) (
      if (turn == 4) quit else if (turn == 5) sendLeave(1)
      else if (turn == 6) leaveAnswer(1, "feature_not_enabled", 0)
      else if (turn == 7) stopReported(1, "left") else if (turn == 8) clearLeave(1)
      else if (turn == 9) finishQuit else seal
    ) else if (which == 8) (
      if (turn == 4) fetchInfo else if (turn == 5) disconnect
      else if (turn == 6) slackChange(2) else if (turn == 7) reconnect
      else if (turn == 8) answerInfo else seal
    ) else if (which == 9) (
      if (turn == 4) stopReported(1, "connectionLost")
      else if (turn == 5) reconcile(0) else seal
    ) else if (which == 12) (
      if (turn == 4) leave else if (turn == 5) sendLeave(1)
      else if (turn == 6) crash else seal
    ) else if (which == 13) (
      if (turn == 4) pageEnd else if (turn == 5) mainReport else if (turn == 6) reconcile(0) else seal
    ) else if (which == 14) (
      if (turn == 4) engineCrash else if (turn == 5) restart else seal
    ) else if (which == 15) (
      if (turn == 4) leave else if (turn == 5) sendLeave(1)
      else if (turn == 6) stopReported(1, "left") else if (turn == 7) clearLeave(1)
      else if (turn == 8) leaveAnswer(1, "refused", bug) else seal
    ) else if (which == 17) (
      // The engine restarts under a live page, which stops its session and
      // reports before the stored leaves are loaded.
      if (turn == 4) engineCrash else if (turn == 5) restart
      else if (turn == 6) pageStop(1, "left") else if (turn == 7) pageReport
      else if (turn == 8) deliverWith(bug) else seal
    ) else seal
  )
  action refusedStep = scenario(10, 0)
  action crashBeforeMediaStep = scenario(11, 0)
  action crashAfterLeaveStep = scenario(12, 0)
  action ghostStep = scenario(1, 0)
  action ghostBugStep = scenario(1, 1)
  action oneCallStep = scenario(2, 0)
  action oneCallBugStep = scenario(2, 2)
  action cancelStep = scenario(3, 0)
  action cancelBugStep = scenario(3, 3)
  action staleStep = scenario(4, 0)
  action staleBugStep = scenario(4, 4)
  action overflowStep = scenario(5, 0)
  action overflowBugStep = scenario(5, 5)
  action otherDeviceStep = scenario(6, 0)
  action otherDeviceBugStep = scenario(6, 6)
  action quitStep = scenario(7, 0)
  action reconnectStep = scenario(8, 0)
  action connectionLostStep = scenario(9, 0)
  action pageGoneStep = scenario(13, 0)
  action engineCrashStep = scenario(14, 0)
  action refusedLeaveStep = scenario(15, 0)
  action refusedLeaveBugStep = scenario(15, 7)
  action pageDuringJoinStep = scenario(16, 0)
  action pageDuringJoinBugStep = scenario(16, 8)
  action earlyReportStep = scenario(17, 0)
  action earlyReportBugStep = scenario(17, 9)
  action lostStartStep = scenario(18, 0)
  action lostStartBugStep = scenario(18, 11)
  action workspaceRestartStep = scenario(19, 0)
  action workspaceRestartBugStep = scenario(19, 10)
  action unlistedPageStep = scenario(20, 0)
  action unlistedPageBugStep = scenario(20, 12)
  action cancelDuringPersistStep = scenario(21, 0)
  action cancelDuringPersistBugStep = scenario(21, 13)
  action laggingInfoStep = scenario(22, 0)
  action laggingInfoBugStep = scenario(22, 14)
}
