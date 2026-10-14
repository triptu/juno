// WP8's trailing-state rollback boundary: one input, one tool call with an
// external effect, one approval, and a journal copy restored over a newer one.
// It models pi's tool task as WP8 runs it (pi-durable 1.2.0, harness/tool.js):
// the call phase commits an execute intent (a state commit, no transcript
// entry) before `execute()`. On recovery, a call with an intent and the default
// `replay: "unsafe"` settles as interrupted; a call without one runs the call
// phase again. WP8 allocates a fresh authorization on every `authorize`, so a
// rerun call can authorize the effect again. This is a replay slice, not
// another action policy model: WP3 owns that policy.
module agent_recovery_replay {
  // One journal file. `last` is `next_seq - 1`.
  type Pi = { last: int, called: bool, intent: bool, result: bool }
  type Authorization = { id: int, outcome: str }
  type State = {
    pi: Pi, saved: Pi, cursor: int, authorizedSeq: int, live: bool, resumed: bool, rotated: bool,
    auths: Set[Authorization], nextAuth: int, current: int,
    effects: int, handoffs: List[int], label: str
  }
  var s: State
  var before: State
  var pc: int
  var scenario: int
  pure val empty: Pi = { last: 0, called: false, intent: false, result: false }
  pure val initial: State = {
    pi: empty, saved: empty, cursor: 0, authorizedSeq: 0, live: true, resumed: false, rotated: false,
    auths: Set(), nextAuth: 1, current: 0, effects: 0, handoffs: List(), label: "init"
  }
  action init = all { s' = initial, before' = initial, pc' = 0, scenario' = 0 }
  action idle = s' = { ...s, label: "blocked" }
  // The model's tool call: an entry commit.
  action call = s' = { ...s, pi: { ...s.pi, called: true, last: s.pi.last + 1 }, label: "call" }
  // Projection of the entry commit moves the cursor; state commits never do.
  action project = s' = { ...s, cursor: if (s.pi.called) 1 else 0, label: "project" }
  action intent = s' = { ...s, pi: { ...s.pi, intent: true, last: s.pi.last + 1 }, label: "intent" }
  // `authorize` in store/ledger.ts. The corrected tool reads the journal
  // position inside `execute()`, after the intent commit, and the same
  // transaction raises the incarnation's `authorized_seq`. `earlyPosition`
  // reads it before the intent commit; `unrecorded` is WP8 before this change.
  def position(bug: str): int = if (bug == "earlyPosition") s.pi.last - 1 else s.pi.last
  def authorizeWith(bug: str): State = { ...s,
    auths: s.auths.union(Set({ id: s.nextAuth, outcome: "consumed" })), current: s.nextAuth, nextAuth: s.nextAuth + 1,
    authorizedSeq: if (bug == "unrecorded") s.authorizedSeq else if (position(bug) > s.authorizedSeq) position(bug) else s.authorizedSeq }
  action authorize(bug: str): bool = if (not(s.live)) idle else s' = { ...authorizeWith(bug), label: "authorize" }
  // recordAttempt only succeeds for a still-consumed authorization. The
  // handoff/effect assumes a successful destination with no remote dedupe.
  pure def sendWith(st: State, guard: bool): State = {
    val eligible = st.auths.filter(a => a.id == st.current and (not(guard) or a.outcome == "consumed"))
    if (eligible == Set()) st else { ...st, auths: st.auths.map(a => if (a.id == st.current) { ...a, outcome: "sent" } else a),
      handoffs: st.handoffs.append(st.current), effects: st.effects + 1 }
  }
  action send(guard: bool): bool = if (not(s.live)) idle else {
    val sent = sendWith(s, guard)
    if (sent == s) idle else s' = { ...sent, label: "send" }
  }
  action receipt = s' = { ...s, auths: s.auths.map(a =>
    if (a.id == s.current and a.outcome == "sent") { ...a, outcome: "done" } else a), label: "receipt" }
  action save = s' = { ...s, saved: s.pi, label: "save" }
  action crash = s' = { ...s, live: false, resumed: false, current: 0, label: "crash" }
  // An older copy of the same incarnation's file: pi state is lost, agent.sqlite is not.
  action restoreOlder = s' = { ...s, pi: s.saved, label: "restoreOlder" }
  // `recover`: behind the cursor or behind the highest authorized position rotates.
  // Rotation retires this file, so its tool call never runs again.
  // Either way, startup classifies open authorizations as unknown.
  action open = {
    val floor = if (s.authorizedSeq < s.cursor) s.cursor else s.authorizedSeq
    val classified = s.auths.map(a => if (Set("consumed", "sent").contains(a.outcome)) { ...a, outcome: "unknown" } else a)
    if (s.pi.last < floor) s' = { ...s, live: true, resumed: false, rotated: true, auths: classified, label: "rotate" }
    else s' = { ...s, live: true, resumed: true, auths: classified, label: "resume" }
  }
  // pi's tool-task recovery. `replaySafe` declares the effect tool `replay: "safe"`.
  action recoverTool(bug: str): bool =
    if (not(s.resumed) or not(s.pi.called) or s.pi.result) idle else
    if (s.pi.intent and bug != "replaySafe")
      s' = { ...s, pi: { ...s.pi, result: true, last: s.pi.last + 1 }, label: "interrupted" }
    else {
      // The call phase runs again: intent, then execute calls authorize and sends.
      val withIntent = { ...s, pi: { ...s.pi, intent: true, last: s.pi.last + 1 } }
      val authorized = { ...withIntent, auths: withIntent.auths.union(Set({ id: withIntent.nextAuth, outcome: "consumed" })),
        current: withIntent.nextAuth, nextAuth: withIntent.nextAuth + 1 }
      s' = { ...sendWith(authorized, true), label: "rerun" }
    }
  // The dispatcher retries the authorization it had before the crash.
  action reuse = s' = { ...s, current: 1, label: "reuse" }

  val authorizedOnce = s.auths.size() <= 1
  val noRepeatedEffect = s.effects <= 1
  val oneHandoffPerAuthorization = s.handoffs.indices().forall(i =>
    s.handoffs.indices().forall(j => i == j or s.handoffs.nth(i) != s.handoffs.nth(j)))
  // The lemma behind the fix: a journal resumed after an authorization holds that call's intent.
  val resumeHoldsIntent = s.label != "resume" or s.auths == Set() or s.pi.intent
  val ledgerSurvivesRestore = s.label != "restoreOlder" or s.auths == before.auths
  val safety = authorizedOnce and noRepeatedEffect and oneHandoffPerAuthorization and resumeHoldsIntent and ledgerSurvivesRestore
  val reachedAgreement = s.label == "finished"

  action execute(op: str, bug: str): bool =
    if (op == "call") call else if (op == "project") project else if (op == "intent") intent else
    if (op == "authorize") authorize(bug) else if (op == "send") send(bug != "resend") else
    if (op == "receipt") receipt else if (op == "save") save else if (op == "crash") crash else
    if (op == "restore") restoreOlder else if (op == "open") open else
    if (op == "recover") recoverTool(bug) else reuse
  action script(commands: List[str], bug: str): bool = all {
    not(reachedAgreement), before' = s, pc' = pc + 1, scenario' = scenario,
    if (pc < commands.length()) execute(commands.nth(pc), bug) else s' = { ...s, label: "finished" }
  }

  // Departure 2. The copy is taken after the tool call is projected and
  // before its intent commit, so it is at the archive cursor and only state
  // is lost. WP8 compared it with the cursor alone, resumed, and pi ran the
  // call again: a second authorization and a second effect.
  pure val trailingState = List("call", "project", "save", "intent", "authorize", "send", "receipt",
    "crash", "restore", "open", "recover")
  action trailingStateStep = script(trailingState, "")
  action trailingStateBugStep = script(trailingState, "unrecorded")
  // The tool must read the position after its intent commit, inside execute().
  action earlyPositionStep = script(trailingState, "")
  action earlyPositionBugStep = script(trailingState, "earlyPosition")
  // An ordinary crash during the effect resumes: pi reports the call
  // interrupted. Rerunning is safe only if the tool is not replay-safe.
  pure val unsafeReplay = List("call", "project", "intent", "authorize", "send", "crash", "open", "recover")
  action unsafeReplayStep = script(unsafeReplay, "")
  action unsafeReplayBugStep = script(unsafeReplay, "replaySafe")
  // After startup the old authorization is unknown; retrying it cannot send.
  pure val replayUnknown = List("call", "project", "intent", "authorize", "send", "crash", "open", "reuse", "send")
  action replayUnknownStep = script(replayUnknown, "")
  action replayUnknownBugStep = script(replayUnknown, "resend")
  // A copy that holds the intent is not rotated: the check is not stricter than needed.
  pure val copyAfterIntent = List("call", "project", "intent", "save", "authorize", "send", "receipt",
    "crash", "restore", "open", "recover")

  pure val suiteCommands = List(trailingState, unsafeReplay, replayUnknown, copyAfterIntent)
  action suiteInit = { nondet which = 0.to(3).oneOf(); all { s' = initial, before' = initial, pc' = 0, scenario' = which } }
  action suiteStep = script(suiteCommands.nth(scenario), "")
  val case0 = scenario == 0 and reachedAgreement and s.rotated and not(s.resumed) and s.effects == 1 and s.auths == Set({ id: 1, outcome: "done" })
  val case1 = scenario == 1 and reachedAgreement and s.resumed and not(s.rotated) and s.pi.result and s.effects == 1 and s.auths == Set({ id: 1, outcome: "unknown" })
  val case2 = scenario == 2 and reachedAgreement and s.resumed and s.effects == 1 and s.handoffs == List(1)
  val case3 = scenario == 3 and reachedAgreement and s.resumed and not(s.rotated) and s.pi.result and s.effects == 1
}
