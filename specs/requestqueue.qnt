// One tick is 125 ms. Each background method has its own clock: method 0
// (history, replies) starts at most every 12 ticks (40/minute), method 1
// (search) every 48 ticks (10/minute). Any two background starts are at
// least 4 ticks apart (120/minute in total), so the methods run side by side.
// Interactive capacity 20 tokens (80 credits), refill one credit/tick (2 tokens/second). Send is unpaced.
// Per-method backoff doubles once per pause, caps at 480 ticks (60 s),
// and halves every 2400 ticks (five quiet minutes), down to the method's base.
// Dispatch is admission after a permit wait; HTTP latency and fairness are abstracted.
module requestqueue {
  pure val methods = Set(0, 1)
  pure val base = Map(0 -> 12, 1 -> 48)
  pure val ceiling = 4
  var now: int
  var nextStart: int -> int
  var paused: int -> int
  var interval: int -> int
  var decayAt: int -> int
  var backgroundNext: int
  var credits: int
  var safe: bool
  var starts: int -> int
  // When each method last started, and whether every start kept its method's base spacing and the total ceiling.
  var lastStart: int -> int
  var lastAny: int
  var spaced: bool

  action init = all {
    now' = 0, nextStart' = Map(0 -> 0, 1 -> 0),
    paused' = Map(0 -> 0, 1 -> 0), interval' = base,
    decayAt' = Map(0 -> 2400, 1 -> 2400), backgroundNext' = 0, credits' = 80,
    starts' = Map(0 -> 0, 1 -> 0), safe' = true,
    lastStart' = Map(0 -> -1000, 1 -> -1000), lastAny' = -1000, spaced' = true,
  }
  action tickWith(delta: int): bool = all {
    now' = now + delta, nextStart' = nextStart, paused' = paused,
    interval' = methods.mapBy(m => if (now + delta >= decayAt.get(m))
      (if (interval.get(m) / 2 < base.get(m)) base.get(m) else interval.get(m) / 2) else interval.get(m)),
    decayAt' = methods.mapBy(m => if (now + delta >= decayAt.get(m)) decayAt.get(m) + 2400 else decayAt.get(m)),
    credits' = if (credits + delta < 80) credits + delta else 80,
    backgroundNext' = backgroundNext, starts' = starts, safe' = safe,
    lastStart' = lastStart, lastAny' = lastAny, spaced' = spaced,
  }
  action tick = tickWith(1)
  // A start, recorded: it reserves the method's next start and the lane's.
  action start(m: int): bool = all {
    nextStart' = nextStart.set(m, now + interval.get(m)),
    backgroundNext' = now + ceiling, credits' = credits, decayAt' = decayAt,
    starts' = starts.set(m, starts.get(m) + 1),
    safe' = (safe and now >= paused.get(m) and now >= backgroundNext and now >= nextStart.get(m)),
    lastStart' = lastStart.set(m, now), lastAny' = now,
    spaced' = (spaced and now - lastStart.get(m) >= base.get(m) and now - lastAny >= ceiling),
    now' = now, paused' = paused, interval' = interval,
  }
  action dispatch(m: int): bool = all {
    now >= nextStart.get(m), now >= paused.get(m), now >= backgroundNext,
    start(m),
  }
  action foreground(m: int, interactive: bool): bool = all {
    now >= paused.get(m), (not(interactive) or credits >= 4),
    credits' = if (interactive) credits - 4 else credits,
    safe' = (safe and now >= paused.get(m) and (not(interactive) or credits >= 4)),
    now' = now, nextStart' = nextStart, paused' = paused, interval' = interval,
    decayAt' = decayAt, backgroundNext' = backgroundNext, starts' = starts,
    lastStart' = lastStart, lastAny' = lastAny, spaced' = spaced,
  }
  action limited(m: int): bool = all {
    paused' = paused.set(m, now + 12),
    interval' = interval.set(m, if (now < paused.get(m)) interval.get(m)
      else if (interval.get(m) * 2 < 480) interval.get(m) * 2 else 480),
    decayAt' = decayAt.set(m, now + 2400),
    now' = now, nextStart' = nextStart, starts' = starts, safe' = safe,
    backgroundNext' = backgroundNext, credits' = credits,
    lastStart' = lastStart, lastAny' = lastAny, spaced' = spaced,
  }
  action simulationStep = {
    nondet m = methods.oneOf()
    any { tick, tickWith(2400), dispatch(m), foreground(m, true), foreground(m, false), limited(m) }
  }
  // The old path checked the pause before waiting for a lane slot.
  action staleAdmission = all {
    now < paused.get(0), safe' = false, starts' = starts.set(0, starts.get(0) + 1),
    now' = now, nextStart' = nextStart, paused' = paused, interval' = interval,
    decayAt' = decayAt, backgroundNext' = backgroundNext, credits' = credits,
    lastStart' = lastStart, lastAny' = lastAny, spaced' = spaced,
  }
  action pauseWhileQueuedStep =
    if (paused.get(0) == 0) limited(0)
    else if (now < paused.get(0) or now < nextStart.get(0) or now < backgroundNext) tick
    else dispatch(0)
  action pauseWhileQueuedBugStep =
    if (paused.get(0) == 0) limited(0) else staleAdmission
  // Method 0 wants to start again at once while method 1 also waits: method 1 goes after the
  // ceiling, method 0 only after its own spacing.
  action methodSpacingStep =
    if (starts.get(0) == 0 and now >= backgroundNext) dispatch(0)
    else if (starts.get(1) == 0 and now >= backgroundNext and now >= nextStart.get(1)) dispatch(1)
    else if (now >= nextStart.get(0) and now >= backgroundNext) dispatch(0)
    else tick
  // The bug: only the total ceiling is checked, so method 0 starts again too soon.
  action methodSpacingBugStep =
    if (now < backgroundNext) tick
    else all { now >= paused.get(0), start(0) }
  val respectsPause = safe
  val methodSpaced = spaced
  val reachedAgreement = methods.forall(m => starts.get(m) > 0)
  val invariants = safe and spaced and credits >= 0 and credits <= 80 and methods.forall(m => interval.get(m) >= base.get(m) and interval.get(m) <= 480)
}
