// Follow new threads as implemented by `followNew.ts` and the `auto` mode of
// the follow command. One conversation, three threads. A root is posted at a
// clock time; the setting stores the time it was turned on (`since`). A
// thread exists once its root has a reply, and Juno sees it when that reply
// is stored, live or by a catch-up, in any order and after any delay. A pass
// takes a seen thread whose root is at or after `since` and that it has not
// had its go at, records it (`claimed`) and, only when Slack has said
// nothing about the thread (row -1), follows it, in one transaction.
// -1 is Unknown (no stored row), 0 is unfollowed, 1 is followed. The
// follow's mirror to Slack is `follow.qnt`'s; here a follow is its local row.
// `ignored` is the conversation being ignored or left (a channel the user is
// not in): either way a pass records its new threads without following them.
// `mode` switches the protocol off in three ways for the bug schedules:
// "noClaim" follows any seen thread not followed, "split" decides and writes
// in two steps a user command can come between, and "anyRoot" ignores the
// root's time.
module follownew {
  pure val threads = Set(1, 2, 3)

  type State = {
    clock: int, on: bool, since: int, ignored: bool,
    rootAt: int -> int, replied: Set[int], seen: Set[int],
    row: int -> int, claimed: Set[int], decided: Set[int],
    autoCount: int -> int, firedSince: int -> int, unfollowed: Set[int],
    label: str, target: int
  }
  var s: State

  action init = all {
    s' = {
      clock: 1, on: false, since: 0, ignored: false,
      rootAt: threads.mapBy(_ => -1), replied: Set(), seen: Set(),
      row: threads.mapBy(_ => -1), claimed: Set(), decided: Set(),
      autoCount: threads.mapBy(_ => 0), firedSince: threads.mapBy(_ => 0), unfollowed: Set(),
      label: "init", target: 0
    }
  }

  action turnOn = all {
    not(s.on),
    s' = { ...s, on: true, since: s.clock, clock: s.clock + 1, label: "turnOn", target: 0 }
  }
  // Turning it off follows nothing more and unfollows nothing.
  action turnOff = all { s.on, s' = { ...s, on: false, label: "turnOff", target: 0 } }
  action setIgnored(value: bool): bool = all {
    s.ignored != value, s' = { ...s, ignored: value, label: "ignore", target: 0 }
  }

  action post(k: int): bool = all {
    s.rootAt.get(k) == -1,
    s' = { ...s, rootAt: s.rootAt.set(k, s.clock), clock: s.clock + 1, label: "post", target: k }
  }
  action reply(k: int): bool = all {
    s.rootAt.get(k) != -1,
    s' = { ...s, replied: s.replied.union(Set(k)), label: "reply", target: k }
  }
  // The reply is stored: from the socket, or from the catch-up after Juno was closed or offline.
  action observe(k: int): bool = all {
    s.replied.contains(k), not(s.seen.contains(k)),
    s' = { ...s, seen: s.seen.union(Set(k)), label: "observe", target: k }
  }

  // Notify me on the thread: Always or Auto follow it (1), Never unfollows it (0).
  action userSet(k: int, value: int): bool = all {
    s.seen.contains(k),
    s' = { ...s, row: s.row.set(k, value),
      unfollowed: if (value == 0) s.unfollowed.union(Set(k)) else s.unfollowed.exclude(Set(k)),
      label: "userSet", target: k }
  }
  // Slack follows the thread for a mention, also after an unfollow.
  action mention(k: int): bool = all {
    s.replied.contains(k),
    s' = { ...s, row: s.row.set(k, 1), unfollowed: s.unfollowed.exclude(Set(k)), label: "mention", target: k }
  }

  pure def newRoot(st: State, k: int, mode: str): bool = mode == "anyRoot" or st.rootAt.get(k) >= st.since
  pure def candidate(st: State, k: int, mode: str): bool =
    st.on and st.seen.contains(k) and newRoot(st, k, mode) and
      (if (mode == "noClaim") st.row.get(k) != 1 else not(st.claimed.contains(k)))
  // The follow is made only on Unknown, except in "noClaim", which follows whatever is not followed.
  pure def follows(st: State, k: int, mode: str): bool =
    not(st.ignored) and (if (mode == "noClaim") st.row.get(k) != 1 else st.row.get(k) == -1)

  action followed(k: int): bool = all {
    s' = { ...s, row: s.row.set(k, 1), autoCount: s.autoCount.set(k, s.autoCount.get(k) + 1),
      firedSince: s.firedSince.set(k, s.since), claimed: s.claimed.union(Set(k)), decided: s.decided.exclude(Set(k)),
      label: "autoFollow", target: k }
  }
  // One transaction: record the thread, and follow it when Slack has said nothing about it.
  action auto(k: int, mode: str): bool = all {
    mode != "split", candidate(s, k, mode),
    if (follows(s, k, mode)) followed(k)
    else s' = { ...s, claimed: s.claimed.union(Set(k)), label: "autoSkip", target: k }
  }
  // The "split" bug: the decision and the write are separate steps.
  action decide(k: int): bool = all {
    candidate(s, k, "split"), not(s.decided.contains(k)),
    s' = { ...s, claimed: s.claimed.union(Set(k)),
      decided: if (follows(s, k, "split")) s.decided.union(Set(k)) else s.decided, label: "decide", target: k }
  }
  action write(k: int): bool = all { s.decided.contains(k), followed(k) }

  action idle = s' = { ...s, label: "idle" }

  action input = {
    nondet k = threads.oneOf()
    nondet value = Set(0, 1).oneOf()
    nondet flag = Set(true, false).oneOf()
    any { turnOn, turnOff, setIgnored(flag), post(k), reply(k), observe(k), userSet(k, value), mention(k), auto(k, "atomic"), idle }
  }
  action step = input
  action simulationStep = step

  // Follow new threads follows a thread at most once.
  val atMostOnce = threads.forall(k => s.autoCount.get(k) <= 1)
  // It never follows a thread whose root came before the setting was turned on.
  val neverBeforeOn = threads.forall(k => s.autoCount.get(k) > 0 implies s.rootAt.get(k) >= s.firedSince.get(k))
  // After the user's Never, the thread stays unfollowed until the user or Slack follows it again.
  val unfollowKept = threads.forall(k => s.unfollowed.contains(k) implies s.row.get(k) == 0)
  val invariants = atMostOnce and neverBeforeOn and unfollowKept
  // A witness: every new thread seen while the setting is on, outside an ignore, has been handled.
  val reachedAgreement = s.on and not(s.ignored) and s.seen.size() > 0 and
    threads.forall(k => candidate(s, k, "atomic") == false)

  // Followed by the setting, then Never; more replies come. "noClaim" follows it again.
  action refollow(mode: str): bool =
    if (s.label == "init") turnOn else
    if (s.label == "turnOn") post(1) else
    if (s.label == "post") reply(1) else
    if (s.label == "reply" and not(s.seen.contains(1))) observe(1) else
    if (s.label == "observe") auto(1, mode) else
    if (s.label == "autoFollow" and s.unfollowed.size() == 0) userSet(1, 0) else
    if (s.label == "userSet") reply(1) else
    if (s.label == "reply" and candidate(s, 1, mode)) auto(1, mode) else idle
  action refollowStep = refollow("atomic")
  action refollowBugStep = refollow("noClaim")

  // The user's Never lands between the pass's decision and its write. In one transaction it cannot.
  action splitRace(bug: bool): bool =
    if (s.label == "init") turnOn else
    if (s.label == "turnOn") post(1) else
    if (s.label == "post") reply(1) else
    if (s.label == "reply") observe(1) else
    if (s.label == "observe" and bug) decide(1) else
    if (s.label == "observe" or s.label == "decide") userSet(1, 0) else
    if (s.label == "userSet" and bug) write(1) else
    if (s.label == "userSet" and candidate(s, 1, "atomic")) auto(1, "atomic") else idle
  action splitRaceStep = splitRace(false)
  action splitRaceBugStep = splitRace(true)

  // A root from before the setting gets its first reply after it. "anyRoot" follows it.
  action olderRoot(mode: str): bool =
    if (s.label == "init") post(1) else
    if (s.label == "post") turnOn else
    if (s.label == "turnOn") reply(1) else
    if (s.label == "reply") observe(1) else
    if (s.label == "observe" and candidate(s, 1, mode)) auto(1, mode) else idle
  action olderRootStep = olderRoot("atomic")
  action olderRootBugStep = olderRoot("anyRoot")
}
