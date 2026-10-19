// One user's Huddle service. IDs are opaque, fresh attendee IDs are never reused.
// Successful reception includes the durable pending-leave write: see README for
// the unavoidable crash gap between an HTTP response and that transaction.
module huddle {
  val attendees = Set(1, 2, 3)
  val channels = Set(1, 2)
  type Frame = { kind: str, channel: int, room: int, attendee: int }
  type State = {
    up: bool, quitting: bool, phase: str, wanted: int, request: int, cancel: bool,
    current: int, channel: int -> int, room: int -> int,
    received: Set[int], pending: Set[int], unsent: Set[int], sent: Set[int],
    media: Set[int], stopped: Set[int], cancelled: Set[int],
    reports: int -> str, handed: Set[int], otherDevice: bool,
    connected: bool, dirty: bool, epoch: int, fetchEpoch: int,
    fetching: bool, snapshot: Set[int], snapshotVersion: int,
    slack: Set[int], shown: Set[int], version: int,
    frames: Set[Frame], leaveReplies: Set[int], lastReply: str,
    sealed: bool, label: str
  }
  var s: State
  var before: State
  var turn: int
  var remaining: int

  pure val initial = {
    up: true, quitting: false, phase: "idle", wanted: 0, request: 0, cancel: false,
    current: 0, channel: attendees.mapBy(_ => 0), room: attendees.mapBy(_ => 0),
    received: Set(), pending: Set(), unsent: Set(), sent: Set(),
    media: Set(), stopped: Set(), cancelled: Set(), reports: attendees.mapBy(_ => ""),
    handed: Set(), otherDevice: false, connected: true, dirty: true, epoch: 0,
    fetchEpoch: -1, fetching: false, snapshot: Set(), snapshotVersion: 0,
    slack: Set(), shown: Set(), version: 0, frames: Set(), leaveReplies: Set(),
    lastReply: "", sealed: false, label: "init"
  }
  action init = all { s' = initial, before' = initial, turn' = 0, remaining' = 32 }

  // Start and Join share rooms.join. A new intent cancels an older join; it
  // cannot issue another request until the older attendee has been cleaned up.
  action choose(c: int): bool = all {
    s.up, not(s.quitting),
    s' = { ...s, wanted: c, cancel: s.request != 0, current: 0,
      phase: if (s.request != 0 or s.pending.size() > 0) "leaving" else "idle",
      otherDevice: false, label: "choose" }
  }
  action leave = all {
    s.up,
    s' = { ...s, wanted: 0, current: 0, cancel: s.request != 0,
      phase: if (s.request != 0 or s.pending.size() > 0) "leaving" else "idle", label: "leave" }
  }
  action requestJoin = all {
    s.up, s.wanted != 0, s.request == 0, s.pending.size() == 0, s.media.size() == 0,
    s.received != attendees, not(s.otherDevice),
    s' = { ...s, request: s.wanted, wanted: 0, cancel: false, phase: "joining", label: "request" }
  }
  action answerJoin(a: int, r: int, bug: int): bool = all {
    s.up, s.request != 0, not(s.received.contains(a)),
    s' = { ...s, request: 0, received: s.received.union(Set(a)),
      channel: s.channel.set(a, s.request), room: s.room.set(a, r),
      pending: if (bug == 1) s.pending else s.pending.union(Set(a)),
      unsent: s.unsent.union(Set(a)), stopped: s.stopped.union(Set(a)),
      cancelled: if (s.cancel) s.cancelled.union(Set(a)) else s.cancelled,
      current: if (s.cancel and bug != 3) 0 else a,
      phase: if (s.cancel and bug != 3) "leaving" else "joining", label: "answer" }
  }
  action joinError = all {
    s.up, s.request != 0,
    s' = { ...s, request: 0, phase: "idle", cancel: false, label: "joinError" }
  }
  // The renderer accepts credentials once, tagged by attendee and call. A
  // delayed start must recheck the current intent before starting media.
  action startMedia = all {
    s.up, s.current != 0, s.phase == "joining", s.pending.contains(s.current),
    s' = { ...s, media: s.media.union(Set(s.current)),
      stopped: s.stopped.exclude(Set(s.current)), handed: s.handed.union(Set(s.current)),
      phase: "joined", label: "startMedia" }
  }
  action sendLeave(a: int): bool = all {
    s.up, s.pending.contains(a), a != s.current, s.unsent.contains(a),
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
  action stopMedia(a: int): bool = all {
    s.up, s.pending.contains(a), a != s.current, not(s.unsent.contains(a)), not(s.stopped.contains(a)),
    s' = { ...s, media: s.media.exclude(Set(a)), stopped: s.stopped.union(Set(a)), label: "stopMedia" }
  }
  action clearLeave(a: int): bool = all {
    s.up, s.pending.contains(a), a != s.current, not(s.unsent.contains(a)), s.stopped.contains(a),
    s' = { ...s, pending: s.pending.exclude(Set(a)), phase: "idle", label: "clearLeave" }
  }
  // Chime stops before the renderer's report reaches the engine. Reports can
  // arrive late or twice; another attendee's report never tears down this one.
  // A renderer page that reloads, crashes or closes stops the media it held
  // ("pageGone"); main's report of it is the report.
  action forcedStop(a: int, reason: str): bool = all {
    s.media.contains(a),
    s' = { ...s, media: s.media.exclude(Set(a)), stopped: s.stopped.union(Set(a)),
      reports: s.reports.set(a, reason), label: "forcedStop" }
  }
  action reportStop(a: int, bug: int): bool = all {
    s.up, s.reports.get(a) != "",
    s' = if (a != s.current) { ...s, label: "oldReport" }
      else { ...s, current: if (bug == 6) a else 0, wanted: 0,
        phase: "leaving", cancel: s.request != 0,
        otherDevice: s.reports.get(a) == "AudioJoinedFromAnotherDevice",
        label: "reportStop" }
  }
  action quit = all {
    s.up, not(s.quitting),
    s' = { ...s, quitting: true, wanted: 0, current: 0, cancel: s.request != 0,
      phase: "leaving", label: "quit" }
  }
  action finishQuit = all {
    s.up, s.quitting, s.pending.size() == 0, s.request == 0,
    s' = { ...s, up: false, connected: false, label: "finishQuit" }
  }
  // A process crash loses intent, HTTP responses and renderer delivery, not
  // disk. The dead renderer stops local media; Slack may retain the attendee
  // until Chime times out. Restart still replays the leave.
  action crash = all {
    s.up,
    s' = { ...s, up: false, current: 0, wanted: 0, request: 0, cancel: false,
      phase: "idle", connected: false, fetching: false, frames: Set(),
      media: Set(), stopped: s.stopped.union(s.media), leaveReplies: Set(),
      reports: attendees.mapBy(_ => ""), unsent: s.pending, label: "crash" }
  }
  // The engine process alone crashes; the renderer page lives on and keeps
  // its media until the restarted engine's call names no attendee and the
  // page stops it (`stopMedia`). A stored record is not taken as stopped.
  action engineCrash = all {
    s.up,
    s' = { ...s, up: false, current: 0, wanted: 0, request: 0, cancel: false,
      phase: "idle", connected: false, fetching: false, frames: Set(), leaveReplies: Set(),
      unsent: s.pending, label: "engineCrash" }
  }
  action restart = all {
    not(s.up),
    s' = { ...s, up: true, quitting: false, connected: true, dirty: true,
      epoch: s.epoch + 1, fetching: false, unsent: s.pending, phase: "leaving", label: "restart" }
  }

  // Slack's running list includes other people. Its changes are independent of
  // media: arch v2 can retain an empty huddle after the local media has stopped.
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
  action roomFrame(f: Frame, bug: int): bool = all {
    s.up, s.connected, s.frames.contains(f),
    s' = { ...s, dirty: true, epoch: s.epoch + 1,
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
    s' = { ...s, connected: true, dirty: true, epoch: s.epoch + 1, label: "reconnect" }
  }
  action overflow(bug: int): bool = all {
    s.up, s.connected,
    s' = { ...s, frames: Set(), dirty: if (bug == 5) s.dirty else true,
      epoch: s.epoch + 1, label: "overflow" }
  }
  action fetchInfo = all {
    s.up, s.connected, s.dirty, not(s.fetching),
    s' = { ...s, fetching: true, fetchEpoch: s.epoch, snapshot: s.slack,
      snapshotVersion: s.version, label: "fetchInfo" }
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
  action seal = all {
    s' = { ...s, sealed: true, wanted: 0, current: 0, cancel: s.request != 0,
      phase: "leaving", label: "seal" }
  }
  val cleaned = s.received.subseteq(s.sent.intersect(s.stopped)) and s.media.size() == 0
  val settled = s.up and s.connected and s.current == 0 and s.request == 0 and
    s.pending.size() == 0 and s.frames.size() == 0 and not(s.fetching) and not(s.dirty)
  val reachedAgreement = s.sealed and settled and cleaned and s.shown == s.slack
  val noGhost = s.received.subseteq(s.pending.union(s.sent)) and
    s.handed.exclude(s.stopped).subseteq(s.pending) and (s.sealed and settled implies cleaned)
  val oneCall = s.media.size() <= 1 and (s.request != 0 implies s.media.size() == 0) and
    (s.label == "request" implies before.pending.size() == 0)
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
    else if (s.request != 0) { nondet a = attendees.exclude(s.received).oneOf(); answerJoin(a, 1, 0) }
    else if (s.pending.size() > 0) {
      nondet a = s.pending.oneOf()
      if (s.unsent.contains(a)) sendLeave(a)
      else if (not(s.stopped.contains(a))) stopMedia(a)
      else clearLeave(a)
    } else if (not(s.connected)) reconnect
    else if (s.frames.size() > 0) { nondet f = s.frames.oneOf(); roomFrame(f, 0) }
    else if (s.fetching) answerInfo
    else if (s.dirty) fetchInfo
    else all { s' = { ...s, label: "idle" } }

  action input = {
    nondet a = attendees.oneOf()
    nondet c = channels.oneOf()
    nondet r = channels.oneOf()
    nondet kind = Set("sh_room_join", "sh_room_leave", "sh_room_update").oneOf()
    any {
      choose(c), leave, requestJoin, answerJoin(a, r, 0), joinError, startMedia,
      sendLeave(a), stopMedia(a), clearLeave(a),
      leaveAnswer(a, "ok", 0), leaveAnswer(a, "feature_not_enabled", 0), leaveAnswer(a, "refused", 0),
      forcedStop(a, "AudioJoinedFromAnotherDevice"), forcedStop(a, "connectionLost"), forcedStop(a, "pageGone"), reportStop(a, 0),
      quit, finishQuit, crash, engineCrash, restart, slackChange(c),
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

  // Directed witnesses run alongside random schedules. Mutation variants only
  // disable the named rule; the default state machine always uses bug = 0.
  action scenario(which: int, bug: int): bool = tick(
    if (s.sealed) progress
    else if (which == 5) (
      if (turn == 0) fetchInfo else if (turn == 1) answerInfo
      else if (turn == 2) slackChange(2) else if (turn == 3) overflow(bug)
      else seal
    ) else if (turn == 0) choose(1)
    else if (turn == 1) requestJoin
    else if (which == 3 and turn == 2) leave
    else if (which == 3 and turn == 3) answerJoin(1, 1, bug)
    else if (which == 3) seal
    else if (which == 10 and turn == 2) joinError
    else if (which == 10) seal
    else if (turn == 2) answerJoin(1, 1, bug)
    else if (which == 11 and turn == 3) crash
    else if (which == 11) seal
    else if (turn == 3) startMedia
    else if (which == 1) (if (turn == 4) crash else seal)
    else if (which == 2 or which == 4) (
      if (turn == 4) choose(2)
      else if (turn == 5 and bug == 2)
        all { s' = { ...s, request: 2, wanted: 0, phase: "joining", label: "request" } }
      else if (turn == 5) sendLeave(1)
      else if (turn == 6) stopMedia(1)
      else if (turn == 7) clearLeave(1)
      else if (turn == 8) requestJoin
      else if (turn == 9) answerJoin(2, 2, 0)
      else if (turn == 10) startMedia
      else if (which == 4 and turn == 11) queueFrame({kind: "sh_room_leave", channel: 1, room: 1, attendee: 1})
      else if (which == 4 and turn == 12) roomFrame({kind: "sh_room_leave", channel: 1, room: 1, attendee: 1}, bug)
      else if (which == 4 and turn == 13) queueFrame({kind: "sh_room_leave", channel: 2, room: 2, attendee: 1})
      else if (which == 4 and turn == 14) roomFrame({kind: "sh_room_leave", channel: 2, room: 2, attendee: 1}, bug)
      else if (which == 4 and turn == 15) queueFrame({kind: "sh_room_leave", channel: 2, room: 2, attendee: 1})
      else if (which == 4 and turn == 16) roomFrame({kind: "sh_room_leave", channel: 2, room: 2, attendee: 1}, bug)
      else seal
    ) else if (which == 6) (
      if (turn == 4) forcedStop(1, "AudioJoinedFromAnotherDevice")
      else if (turn == 5) reportStop(1, bug)
      else if (turn == 6) disconnect else if (turn == 7) reconnect else seal
    ) else if (which == 7) (
      if (turn == 4) quit else if (turn == 5) sendLeave(1)
      else if (turn == 6) leaveAnswer(1, "feature_not_enabled", 0)
      else if (turn == 7) stopMedia(1) else if (turn == 8) clearLeave(1)
      else if (turn == 9) finishQuit else seal
    ) else if (which == 8) (
      if (turn == 4) fetchInfo else if (turn == 5) disconnect
      else if (turn == 6) slackChange(2) else if (turn == 7) reconnect
      else if (turn == 8) answerInfo else seal
    ) else if (which == 9) (
      if (turn == 4) forcedStop(1, "connectionLost")
      else if (turn == 5) reportStop(1, 0) else seal
    ) else if (which == 12) (
      if (turn == 4) leave else if (turn == 5) sendLeave(1)
      else if (turn == 6) crash else seal
    ) else if (which == 13) (
      if (turn == 4) forcedStop(1, "pageGone") else if (turn == 5) reportStop(1, 0) else seal
    ) else if (which == 14) (
      if (turn == 4) engineCrash else if (turn == 5) restart else seal
    ) else if (which == 15) (
      if (turn == 4) leave else if (turn == 5) sendLeave(1)
      else if (turn == 6) stopMedia(1) else if (turn == 7) clearLeave(1)
      else if (turn == 8) leaveAnswer(1, "refused", bug) else seal
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
}
