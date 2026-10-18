// A search page is partial. Root counters can avoid a lookup, but search
// must never erase reactions or decide follow state. A root missing from
// the page still needs the normal lookup. Counts abstract monotone maxima.
//
// A reply stored from a search page is partial too: it has no reactions,
// files or blocks. Opening the thread must not count it as stored, so the
// open fetches the replies page that brings the full reply.
module discovery {
  var rootKnown: bool
  var counters: int
  var reactions: bool
  var followed: bool
  var calls: int
  var finished: bool
  var pageHadRoot: bool
  // The reply is stored, and stored with its full content (from a replies page).
  var replyStored: bool
  var replyFull: bool
  var opened: bool

  action init = all {
    rootKnown' = false, counters' = 0, reactions' = true,
    followed' = true, calls' = 0, finished' = false, pageHadRoot' = false,
    replyStored' = false, replyFull' = false, opened' = false,
  }
  action page(hasRoot: bool, repliesFirst: bool): bool = all {
    not(finished),
    // Apply the root before its reply, even when search returns newest first.
    rootKnown' = true,
    counters' = 2,
    calls' = if (hasRoot and not(repliesFirst)) calls else calls + 1,
    reactions' = reactions,
    followed' = followed,
    pageHadRoot' = hasRoot,
    finished' = true,
    // The match creates the reply's row, without its full content.
    replyStored' = true,
    replyFull' = replyFull,
    opened' = opened,
  }
  // The user opens the thread. It fetches the replies page unless every reply
  // is stored; `countPartial` is the bug that counts a search match as stored.
  action open(countPartial: bool): bool = all {
    finished,
    not(opened),
    replyFull' = (replyFull or not(if (countPartial) replyStored else replyFull)),
    replyStored' = true,
    opened' = true,
    rootKnown' = rootKnown, counters' = counters, reactions' = reactions,
    followed' = followed, calls' = calls, finished' = finished, pageHadRoot' = pageHadRoot,
  }
  action idle = all {
    finished, rootKnown' = rootKnown, counters' = counters,
    reactions' = reactions, followed' = followed, calls' = calls,
    finished' = finished, pageHadRoot' = pageHadRoot,
    replyStored' = replyStored, replyFull' = replyFull, opened' = opened,
  }
  action simulationStep = any { page(true, false), page(false, false), open(false), idle }
  action rootsFirstStep = if (finished) idle else page(true, false)
  action rootsFirstBugStep = if (finished) idle else page(true, true)
  action partialOpenStep = if (not(finished)) page(true, false) else if (not(opened)) open(false) else idle
  action partialOpenBugStep = if (not(finished)) page(true, false) else if (not(opened)) open(true) else idle
  val noRedundantLookup = not(pageHadRoot) or calls == 0
  // An opened thread shows its replies in full, reactions included.
  val openedHasFull = not(opened) or replyFull
  // Juno advances this local cursor when a sweep starts. Slack may index a
  // reply afterwards whose server timestamp is a little older. The five-unit
  // overlap represents the five-minute production margin; this reply is
  // three units behind the cursor and must still be applied.
  val cursor = 10
  val margin = 5
  val lateReplyTs = 7
  action lateIndexedSearch(useMargin: bool): bool = {
    val accepted = lateReplyTs >= cursor - (if (useMargin) margin else 0)
    all {
      not(finished),
      rootKnown' = accepted,
      counters' = if (accepted) 2 else 0,
      reactions' = reactions,
      followed' = followed,
      calls' = calls,
      finished' = true,
      pageHadRoot' = accepted,
      replyStored' = accepted,
      replyFull' = replyFull,
      opened' = opened,
    }
  }
  action lateIndexedStep = if (finished) idle else lateIndexedSearch(true)
  action lateIndexedBugStep = if (finished) idle else lateIndexedSearch(false)
  val lateIndexedKept = not(finished) or replyStored
  val invariants = reactions and followed and noRedundantLookup and openedHasFull and (finished implies rootKnown and counters == 2)
  val reachedAgreement = finished
}
