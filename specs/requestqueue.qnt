// Background dispatch checks the current method deadline after waiting for a
// lane permit. A 429 doubles only that method's spacing and extends its pause.
// Time is abstract: tier intervals 1 and 2, Retry-After 3. HTTP completion,
// interactive permits and network latency are outside this model.
module requestqueue {
  pure val methods = Set(0, 1)
  var now: int
  var nextStart: int -> int
  var paused: int -> int
  var interval: int -> int
  var safe: bool
  var starts: int -> int

  action init = all {
    now' = 0,
    nextStart' = Map(0 -> 0, 1 -> 0),
    paused' = Map(0 -> 0, 1 -> 0),
    interval' = Map(0 -> 1, 1 -> 2),
    starts' = Map(0 -> 0, 1 -> 0),
    safe' = true,
  }
  action tick = all {
    now' = now + 1, nextStart' = nextStart, paused' = paused,
    interval' = interval, starts' = starts, safe' = safe,
  }
  action dispatch(m: int): bool = all {
    now >= nextStart.get(m), now >= paused.get(m),
    nextStart' = nextStart.set(m, now + interval.get(m)),
    starts' = starts.set(m, starts.get(m) + 1),
    safe' = safe and now >= paused.get(m),
    now' = now, paused' = paused, interval' = interval,
  }
  action limited(m: int): bool = all {
    paused' = paused.set(m, now + 3),
    interval' = interval.set(m, if (interval.get(m) < 8) interval.get(m) * 2 else 8),
    now' = now, nextStart' = nextStart, starts' = starts, safe' = safe,
  }
  action simulationStep = {
    nondet m = methods.oneOf()
    any { tick, dispatch(m), limited(m) }
  }
  // The old dispatch path checked the pause before waiting for a lane slot.
  action staleAdmission = all {
    now < paused.get(0),
    safe' = false, starts' = starts.set(0, starts.get(0) + 1),
    now' = now, nextStart' = nextStart, paused' = paused, interval' = interval,
  }
  action pauseWhileQueuedStep =
    if (paused.get(0) == 0) limited(0)
    else if (now < paused.get(0) or now < nextStart.get(0)) tick
    else dispatch(0)
  action pauseWhileQueuedBugStep =
    if (paused.get(0) == 0) limited(0) else staleAdmission
  val respectsPause = safe
  val reachedAgreement = methods.forall(m => starts.get(m) > 0)
  val invariants = safe and methods.forall(m => interval.get(m) >= m + 1)
}
