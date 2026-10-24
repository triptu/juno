// Which replies of one thread Juno has proven it holds (docs/architecture.md
// 5.5 and 5.6, packages/sync/src/threadRanges.ts). Replies are numbered by
// their ts; the root is 0. Pages of `conversations.replies` hold at most
// `PAGE` replies, oldest first, after an exclusive `oldest` bound (Juno asks
// with `inclusive`, which also returns the bound message, already its range's
// edge) and up to an optional `latest`. Each page proves the range it
// covered, up to its last reply or its `latest` bound; a page that reached
// the newest reply on an unbroken connection has a live tail. Events reach
// Juno in the order Slack sent them, only while the socket is up; a drop (or
// a restart, the same here) loses the ones in flight, and each live range
// closes at the newest reply the socket delivered on that connection
// (`heard`). `message_replied` is left out: it can arrive late or not at
// all, so the root's count is the maximum of what pages said and the
// replies stored.
//
// The view shows two stored replies as continuous only when one page range
// covers both (`shownContinuous`); the unread count is exact only when one
// range of any kind covers the read pointer and reaches the end
// (`countSound`). A getView row (`view`) proves every reply after the read
// pointer, for the count only. A followed thread's live tail is held across
// a drop: the count trusts the reconnect's view to bring the unread replies,
// so `countSound` leaves out the states where the count rests on a held tail
// alone while that view is still due (`viewDue`). Unfollowing ends a held
// tail. The bug modes put back what the store did before: the count trusted
// `reply_count` (`liveCount`), stored replies were shown as continuous
// (`jumpGap`), and coverage outlived a restart (`restartGap`).
module threadranges {
  type Range = { kind: str, from: int, to: int, tail: str }
  type Page = { oldest: int, latest: int, bounded: bool, epoch: int, up: bool, replies: Set[int], more: bool, count: int, rootLatest: int }

  val PAGE = 2
  val MAX_TS = 6
  val END = 100

  // Slack
  var clock: int
  var posted: Set[int]
  // The socket: reply events not yet applied, oldest first
  var events: List[int]
  var up: bool
  var epoch: int
  // Juno
  var stored: Set[int]
  var ranges: Set[Range]
  var inflight: Set[Page]
  var pointer: int
  var latestKnown: int
  var countKnown: int
  var followed: bool
  // The newest reply delivered on the current connection (`hearReply`)
  var heard: int
  // Ghost: a drop left a followed thread's count on a held tail until the reconnect's view
  var viewDue: bool
  // Bug modes
  var trustCounts: bool
  var noRanges: bool
  var keepTails: bool
  var step: int

  pure def mx(a: int, b: int): int = if (a > b) a else b
  pure def mn(a: int, b: int): int = if (a < b) a else b
  pure def shownTo(r: Range): int = if (r.tail == "live") END else r.to
  pure def countedTo(r: Range): int = if (r.tail == "none") r.to else END

  // Ranges merge only where pages of the same kind make them touch: a live tail's later replies came by event.
  pure def merge(rs: Set[Range], n: Range): Set[Range] = {
    val touching = rs.filter(r => r.kind == n.kind and r.from <= n.to and r.to >= n.from)
    val tails = touching.map(r => r.tail).union(Set(n.tail))
    val merged = {
      kind: n.kind,
      from: touching.fold(n.from, (a, r) => mn(a, r.from)),
      to: touching.fold(n.to, (a, r) => mx(a, r.to)),
      tail: if (tails.contains("live")) "live" else if (tails.contains("held")) "held" else "none",
    }
    rs.exclude(touching).union(Set(merged))
  }

  pure def proven(rs: Set[Range], x: int, y: int): bool = rs.exists(r => r.kind == "page" and r.from <= x and y <= shownTo(r))

  pure def exactBy(rs: Set[Range], p: int, latest: int): bool =
    latest <= p or rs.exists(n => n.from <= p and p <= countedTo(n) and (n.tail != "none" or latest <= n.to))

  // What one page proved (`pageRange`); empty when nothing. Never past its last reply: a live tail covers the rest.
  pure def pageRange(kind: str, oldest: int, replies: Set[int], more: bool, bounded: bool, latest: int, live: bool): Set[Range] = {
    val last = replies.fold(oldest, (a, r) => mx(a, r))
    val closed: Set[Range] = if (last > oldest) Set({ kind: kind, from: oldest, to: last, tail: "none" }) else Set()
    if (more) closed
    else if (bounded) (if (latest > oldest) Set({ kind: kind, from: oldest, to: latest, tail: "none" }) else Set())
    else if (live) Set({ kind: kind, from: oldest, to: last, tail: "live" })
    else closed
  }

  // Juno's claims, as the store makes them in the current mode.
  def continuousClaim(x: int, y: int): bool = noRanges or proven(ranges, x, y)
  def exactClaim: bool = if (trustCounts) latestKnown <= pointer or stored.size() >= countKnown else exactBy(ranges, pointer, latestKnown)

  def inFlight(p: int): bool = events.foldl(false, (a, e) => a or e == p)
  // The count's proof leans on a held tail: no live tail or closed range proves it alone.
  def heldOnly: bool = not(ranges.exists(n => n.tail != "held" and n.from <= pointer and pointer <= countedTo(n) and (n.tail == "live" or latestKnown <= n.to)))

  // Every reply a range proves is stored.
  val rangesProven = ranges.forall(r => posted.forall(p => (r.from < p and p <= r.to) implies stored.contains(p)))
  // A live tail: every later reply is stored or on its way.
  val liveProven = ranges.forall(r => r.tail != "live" or posted.forall(p => p > r.from implies (stored.contains(p) or inFlight(p))))
  // The view never shows two replies as continuous across a missing one; a reply whose event is still on the
  // socket can come in between for that moment.
  val shownContinuous = Set(0).union(stored).forall(x => stored.forall(y => (x < y and continuousClaim(x, y)) implies posted.forall(p => (x < p and p < y) implies (stored.contains(p) or inFlight(p)))))
  // An exact count misses no reply Juno knows exists, except through a held tail before the reconnect's view.
  val countSound = (exactClaim and (trustCounts or latestKnown <= pointer or not(heldOnly) or not(viewDue))) implies posted.forall(p => (p > pointer and p <= latestKnown) implies (stored.contains(p) or inFlight(p)))
  val invariants = rangesProven and liveProven and shownContinuous and countSound
  val reachedAgreement = stored == posted and events.length() == 0 and inflight.size() == 0 and exactBy(ranges, pointer, latestKnown)

  action keepModes = all { trustCounts' = trustCounts, noRanges' = noRanges, keepTails' = keepTails }
  action keepSlack = all { clock' = clock, posted' = posted, events' = events, up' = up, epoch' = epoch }
  action keepJuno = all {
    stored' = stored, ranges' = ranges, inflight' = inflight, pointer' = pointer,
    latestKnown' = latestKnown, countKnown' = countKnown, followed' = followed, heard' = heard, viewDue' = viewDue,
  }

  action initWith(start: Set[int], follow: bool, counts: bool, gaps: bool, tails: bool): bool = all {
    clock' = start.fold(0, (a, p) => mx(a, p)), posted' = start, events' = [], up' = true, epoch' = 0,
    stored' = Set(), ranges' = Set(), inflight' = Set(), pointer' = 0, latestKnown' = 0, countKnown' = 0,
    followed' = follow, heard' = 0, viewDue' = false, trustCounts' = counts, noRanges' = gaps, keepTails' = tails,
  }
  action init = {
    nondet follow = Set(true, false).oneOf()
    all { initWith(Set(), follow, false, false, false), step' = 0 }
  }

  // Someone replies. While the socket is up its event is on the way.
  action post = all {
    clock < MAX_TS,
    clock' = clock + 1, posted' = posted.union(Set(clock + 1)),
    events' = if (up) events.append(clock + 1) else events,
    up' = up, epoch' = epoch, keepJuno, keepModes,
  }

  // The next event lands. The root's count never goes below the replies stored.
  action deliver = {
    val e = events.head()
    all {
      events.length() > 0,
      stored' = stored.union(Set(e)), events' = events.tail(), heard' = mx(heard, e),
      latestKnown' = mx(latestKnown, e), countKnown' = mx(countKnown, stored.union(Set(e)).size()),
      ranges' = ranges, inflight' = inflight, pointer' = pointer, followed' = followed, viewDue' = viewDue,
      clock' = clock, posted' = posted, up' = up, epoch' = epoch, keepModes,
    }
  }

  // The socket drops, or the app closes and opens again: events in flight are lost, and no live tail holds
  // (`endEventCoverage`). A live range closes at the newest reply heard on that connection.
  action drop = all {
    up,
    up' = false, epoch' = epoch + 1, events' = [], heard' = 0,
    ranges' = if (keepTails) ranges else ranges.map(r =>
      if (r.tail == "none") r
      else { ...r, to: if (r.tail == "live" and heard > r.to) heard else r.to, tail: if (followed) "held" else "none" }),
    viewDue' = (followed and not(keepTails)),
    clock' = clock, posted' = posted,
    stored' = stored, inflight' = inflight, pointer' = pointer, latestKnown' = latestKnown, countKnown' = countKnown,
    followed' = followed, keepModes,
  }

  action reconnect = all {
    not(up),
    up' = true, epoch' = epoch, events' = events, clock' = clock, posted' = posted, keepJuno, keepModes,
  }

  // The user follows the thread, or stops: a held tail rested on getView, which no longer lists it.
  action toggleFollow = all {
    followed' = not(followed),
    ranges' = if (followed) ranges.map(r => if (r.tail == "held") { ...r, tail: "none" } else r) else ranges,
    viewDue' = false,
    stored' = stored, inflight' = inflight, pointer' = pointer, latestKnown' = latestKnown, countKnown' = countKnown, heard' = heard,
    keepSlack, keepModes,
  }

  // A `conversations.replies` request; Slack answers from what it holds now. A `latest` bound is a stored
  // message, so never later than now.
  action requestWith(oldest: int, latest: int, bounded: bool): bool = {
    val after = posted.filter(p => p > oldest and (not(bounded) or p <= latest))
    val page = after.filter(p => after.filter(q => q < p).size() < PAGE)
    val pg = { oldest: oldest, latest: latest, bounded: bounded, epoch: epoch, up: up, replies: page,
      more: after.size() > PAGE, count: posted.size(), rootLatest: posted.fold(0, (a, p) => mx(a, p)) }
    all {
      inflight.size() < 2, oldest <= clock, not(bounded) or (latest > oldest and latest <= clock),
      inflight' = inflight.union(Set(pg)),
      stored' = stored, ranges' = ranges, pointer' = pointer, latestKnown' = latestKnown, countKnown' = countKnown,
      followed' = followed, heard' = heard, viewDue' = viewDue, keepSlack, keepModes,
    }
  }
  action request = {
    nondet oldest = 0.to(MAX_TS).oneOf()
    nondet latest = 0.to(MAX_TS).oneOf()
    nondet bounded = Set(true, false).oneOf()
    requestWith(oldest, latest, bounded)
  }

  // A page lands with the range it proved, live only on the connection it was asked on.
  action landWith(pg: Page): bool = {
    val live = pg.up and up and pg.epoch == epoch and not(pg.bounded) and not(pg.more)
    val now = stored.union(pg.replies)
    all {
      inflight.contains(pg),
      inflight' = inflight.exclude(Set(pg)), stored' = now,
      ranges' = pageRange("page", pg.oldest, pg.replies, pg.more, pg.bounded, pg.latest, live).fold(ranges, (rs, n) => merge(rs, n)),
      latestKnown' = mx(latestKnown, pg.rootLatest), countKnown' = mx(countKnown, mx(pg.count, now.size())),
      pointer' = pointer, followed' = followed, heard' = heard, viewDue' = viewDue, keepSlack, keepModes,
    }
  }
  action land = {
    nondet pg = inflight.oneOf()
    all { inflight.size() > 0, landWith(pg) }
  }

  // A getView row for a followed thread: every reply after Slack's pointer (Juno's here), for the count only.
  action view = {
    val unread = posted.filter(p => p > pointer)
    all {
      followed, up,
      stored' = stored.union(unread),
      ranges' = pageRange("view", pointer, unread, false, false, 0, true).fold(ranges, (rs, n) => merge(rs, n)),
      latestKnown' = mx(latestKnown, clock), countKnown' = mx(countKnown, posted.size()), viewDue' = false,
      inflight' = inflight, pointer' = pointer, followed' = followed, heard' = heard, keepSlack, keepModes,
    }
  }

  // The user reads up to a stored reply.
  action markRead = {
    nondet p = stored.filter(q => q > pointer).oneOf()
    all {
      stored.exists(q => q > pointer),
      pointer' = p,
      stored' = stored, ranges' = ranges, inflight' = inflight, latestKnown' = latestKnown, countKnown' = countKnown,
      followed' = followed, heard' = heard, viewDue' = viewDue, keepSlack, keepModes,
    }
  }

  action stay = all { keepSlack, keepJuno, keepModes }

  action simulationStep = all {
    any { post, deliver, drop, reconnect, toggleFollow, request, land, view, markRead },
    step' = step + 1,
  }

  // The one in-flight page, for the directed schedules.
  action landOnly = all { inflight.size() == 1, landWith(inflight.fold({ oldest: 0, latest: 0, bounded: false, epoch: 0, up: false, replies: Set(), more: false, count: 0, rootLatest: 0 }, (a, p) => p)) }
  action done = all { assert(reachedAgreement), stay }

  // A reply lost in a drop, then a live one: the stored replies reach the count, so the old rule called it exact.
  action liveCountWith(counts: bool): bool = all {
    if (step == 0) initWith(Set(), false, counts, false, false)
    else if (step == 1) post
    else if (step == 2) deliver
    else if (step == 3) requestWith(0, 0, false)
    else if (step == 4) landOnly
    else if (step == 5) drop
    else if (step == 6) post
    else if (step == 7) reconnect
    else if (step == 8) post
    else if (step == 9) deliver
    else if (step == 10) requestWith(1, 0, false)
    else if (step == 11) landOnly
    else done,
    step' = step + 1,
  }
  action liveCountStep = liveCountWith(false)
  action liveCountBugStep = liveCountWith(true)

  // A jump deep into a thread the store holds only the start of, then a step up from it.
  action jumpGapWith(gaps: bool): bool = all {
    if (step == 0) initWith(1.to(6), false, false, gaps, false)
    else if (step == 1) requestWith(0, 0, false)
    else if (step == 2) landOnly
    else if (step == 3) requestWith(4, 0, false)
    else if (step == 4) landOnly
    else if (step == 5) requestWith(2, 4, true)
    else if (step == 6) landOnly
    else done,
    step' = step + 1,
  }
  action jumpGapStep = jumpGapWith(false)
  action jumpGapBugStep = jumpGapWith(true)

  // The app closes, a reply comes, the app opens again: old builds kept the thread's coverage across it.
  // The corrected open after the start proves the gap.
  action restartGapWith(tails: bool): bool = all {
    if (step == 0) initWith(Set(1), false, false, false, tails)
    else if (step == 1) requestWith(0, 0, false)
    else if (step == 2) landOnly
    else if (step == 3) drop
    else if (step == 4) post
    else if (step == 5) reconnect
    else if (step == 6) post
    else if (step == 7) deliver
    else if (step == 8) requestWith(1, 0, false)
    else if (step == 9) landOnly
    else done,
    step' = step + 1,
  }
  action restartGapStep = restartGapWith(false)
  action restartGapBugStep = restartGapWith(true)

  // A followed thread across a drop: its held tail, then the reconnect's view.
  action followedDropStep = all {
    if (step == 0) initWith(Set(1), true, false, false, false)
    else if (step == 1) requestWith(0, 0, false)
    else if (step == 2) landOnly
    else if (step == 3) drop
    else if (step == 4) post
    else if (step == 5) reconnect
    else if (step == 6) view
    else done,
    step' = step + 1,
  }
}
