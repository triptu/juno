// The retained room of the live call (huddle/src/own.ts), separate from
// huddle.qnt's media lifecycle. A read lists one room or none; frames carry
// the whole roster and an ordered timestamp. Times themselves are UI data.
module huddle_room {
  type State = { attendee: int, room: int, people: Set[int], version: int, remote: bool, label: str }
  var s: State
  var before: State
  pure val empty = { attendee: 0, room: 0, people: Set(), version: 0, remote: false, label: "init" }
  action init = all { s' = empty, before' = empty }
  action join(a: int, r: int): bool = all {
    s' = { attendee: a, room: r, people: Set(1), version: 0, remote: false, label: "join" }
  }
  // Leave, switch, and terminal media reports all drop the old attendee.
  action leave = all { s' = { ...empty, label: "leave" } }
  action frame(r: int, people: Set[int], v: int): bool = all {
    s' = if (s.attendee != 0 and s.room == r and v > s.version)
      { ...s, people: people, version: v, label: "frame" }
      else { ...s, label: "ignoredFrame" }
  }
  // An empty edge listing is inconclusive about live media. Another room
  // in the same channel must never supply this call's people or start time.
  action read(r: int, people: Set[int]): bool = all {
    s' = if (s.attendee != 0 and s.room == r and people != Set())
      { ...s, people: people, label: "read" }
      else { ...s, label: "missingRead" }
  }
  action media(present: bool): bool = all { s' = { ...s, remote: present, label: "media" } }
  // One timer starts only with affirmative evidence that self is alone;
  // a remote presence report cancels it, even if the edge still lists self.
  action alone = all {
    s.attendee != 0, s.people == Set(1), not(s.remote),
    s' = { ...empty, label: "alone" }
  }
  action step = all {
    before' = s,
    nondet a = Set(1, 2, 3).oneOf()
    nondet r = Set(1, 2).oneOf()
    nondet p = Set(Set(), Set(1), Set(2), Set(1, 2)).oneOf()
    nondet v = Set(1, 2, 3).oneOf()
    any { join(a, r), leave, frame(r, p, v), read(r, p), read(0, Set()), media(true), media(false), alone }
  }
  val invariants = all {
    s.attendee == 0 implies s.people == Set(),
    Set("missingRead", "ignoredFrame").contains(s.label) implies
      s.people == before.people and s.version == before.version and s.room == before.room,
    Set("frame", "read").contains(s.label) implies s.attendee == before.attendee and s.room == before.room,
    s.label == "alone" implies before.people == Set(1) and not(before.remote),
    s.label == "join" implies s.version == 0 and s.people == Set(1)
  }
}
