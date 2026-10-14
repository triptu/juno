// Juno Agent memory, plan v3 WP2. Payload integers stand for exact byte strings;
// provenance sets stand for possible copied content, not semantic truth.
// All durable updates below are single FULL transactions. start/complete/publish
// are separate so appends, redaction, edits and crashes can run between them.
module memoryProtocol {
  const capacity: int
  const workers: int
  const high: int
  const low: int
  const drainLimit: int

  type Key = { a: int, w: int }
  type Ref = { a: int, w: int, v: int }
  type Pin = { id: int, v: int, source: int, from: int, to: int, text: int, owner: bool }
  type Node = { ref: Ref, sources: Set[int], inputs: Set[Ref], context: Set[int],
    deps: Set[int], read: Set[int], words: Set[int], bytes: int, cut: bool, gen: int }
  type Line = { ref: Ref, masked: bool }
  type Head = { rev: int, gen: int, covered: int, lines: List[Line] }
  type Job = { node: Node, rev: int, ready: bool, attempts: int, shortest: int,
    context: Set[int], contextBytes: int, inputBytes: int }
  type Item = { id: int, text: int, kind: int, pair: int, meta: int }
  type Request = { head: Head, pins: Set[Pin], pinRev: int, cutoff: int, h: int,
    tail: Set[int], active: Set[int], omitted: Set[int], items: List[Item],
    deps: Set[int], cost: int, window: int, stamp: bool, path: str }
  type State = {
    accepted: int, n: int, log: int -> int, sizes: int -> int,
    removed: Set[int], gen: int, nodes: Set[Node], head: Head,
    queue: Set[Key], due: Key -> int, jobs: Set[Job], clock: int,
    pins: Set[Pin], pinRev: int, nextPin: int, batch: bool,
    running: bool, h: int, request: Request, signed: Request, requestReady: bool, admitted: bool,
    blocked: bool, sent: int, stampUsed: bool, sentCost: int, sentWindow: int,
    readIds: Set[int], readItems: List[Item], readRemoved: Set[int],
    opened: Set[Ref], queried: Key,
    report: Set[int], reportGen: int, reportReady: bool, visibleReport: Set[int],
    sealed: bool, label: str, target: Key
  }
  var s: State
  var before: State
  var remaining: int
  var pc: int
  var scenario: int

  pure def lineSet(xs: List[Line]): Set[Line] = xs.foldl(Set(), (acc, x) => acc.union(Set(x)))
  pure def itemSet(xs: List[Item]): Set[Item] = xs.foldl(Set(), (acc, x) => acc.union(Set(x)))
  pure def mapLines(xs: List[Line], f: (Line) => Line): List[Line] = xs.foldl(List(), (acc, x) => acc.append(f(x)))
  pure def mapItems(xs: List[Item], f: (Item) => Item): List[Item] = xs.foldl(List(), (acc, x) => acc.append(f(x)))
  pure def reverseLines(xs: List[Line]): List[Line] = xs.foldl(List(), (acc, x) => List(x).concat(acc))
  pure val ids = 0.to(capacity - 1)
  pure val nodeKeys = ids.fold(Set(), (acc, a) => acc.union(
    Set(1, 2, 4, 8).filter(w => a % w == 0 and a + w <= capacity).map(w => { a: a, w: w })))
  pure def key(r: Ref): Key = { a: r.a, w: r.w }
  pure def span(k: Key): Set[int] = k.a.to(k.a + k.w - 1)
  pure def left(k: Key): Key = { a: k.a, w: k.w / 2 }
  pure def right(k: Key): Key = { a: k.a + k.w / 2, w: k.w / 2 }
  pure def original(i: int): int = 1000 + i
  pure def pinText(i: int, from: int): int = original(i) * 1000 + from
  pure def pinBytes(ps: Set[Pin]): int = ps.fold(0, (n, p) => n + p.to - p.from)
  pure val emptyHead: Head = { rev: 0, gen: 0, covered: 0, lines: List() }
  pure val emptyRequest: Request = { head: emptyHead, pins: Set(), pinRev: 0, cutoff: 0, h: 0,
    tail: Set(), active: Set(), omitted: Set(), items: List(), deps: Set(), cost: 0,
    window: 300000, stamp: false, path: "chat" }
  pure val initial: State = {
    accepted: 0, n: 0, log: ids.mapBy(_ => -1), sizes: ids.mapBy(_ => 16000),
    removed: Set(), gen: 0, nodes: Set(), head: emptyHead,
    queue: Set(), due: nodeKeys.mapBy(_ => 0), jobs: Set(), clock: 0,
    pins: Set(), pinRev: 0, nextPin: 0, batch: false,
    running: false, h: 0, request: emptyRequest, signed: emptyRequest, requestReady: false, admitted: false,
    blocked: false, sent: 0, stampUsed: true, sentCost: 0, sentWindow: 300000,
    readIds: Set(), readItems: List(), readRemoved: Set(), opened: Set(), queried: { a: 0, w: 1 },
    report: Set(), reportGen: 0, reportReady: false, visibleReport: Set(),
    sealed: false, label: "init", target: { a: 0, w: 1 }
  }
  action init = all { s' = initial, before' = initial, remaining' = drainLimit, pc' = 0, scenario' = 0 }

  def stored(r: Ref): Set[Node] = s.nodes.filter(n => n.ref == r)
  def clean(n: Node): bool = n.deps.intersect(s.removed) == Set()
  def current(k: Key): Set[Node] = s.nodes.filter(n => key(n.ref) == k and clean(n))
  val logged = ids.filter(i => i < s.n)
  val live = logged.exclude(s.removed)
  def deps(rs: Set[Ref]): Set[int] = s.nodes.filter(n => rs.contains(n.ref)).map(n => n.deps).flatten()
  def bytes(rs: Set[Ref]): int = s.nodes.filter(n => rs.contains(n.ref)).fold(0, (v, n) => v + n.bytes)
  def children(k: Key): Set[Ref] = if (k.w == 1) Set() else
    current(left(k)).union(current(right(k))).map(n => n.ref)
  def available(k: Key): bool = k.a + k.w <= s.n and
    (k.w == 1 or (current(left(k)).size() == 1 and current(right(k)).size() == 1))
  val needed = nodeKeys.filter(k => k.a + k.w <= s.n and current(k) == Set())
  val viewRefs = s.head.lines.select(l => not(l.masked)).lineSet().map(l => l.ref)
  val viewBytes = s.head.lines.foldl(0, (v, l) => v + (if (l.masked) 32 else bytes(Set(l.ref))))
  val masked = s.head.lines.select(l => l.masked).lineSet().map(l => key(l.ref))
  def sourceItem(i: int): Item = { id: i, text: s.log.get(i),
    kind: if (i == 2) 1 else if (i == 3) 2 else 0,
    pair: if (i == 2 or i == 3) 77 else -1, meta: 900 + i }
  def items(is: Set[int]): List[Item] = 0.range(capacity).select(i => i < s.n and is.contains(i)).foldl(List(), (acc, i) => acc.append(sourceItem(i)))

  // The inbox is authoritative. Projection is ordered, and its queue insert
  // and cursor advance are atomic with storing the complete source bytes.
  action accept = all { not(s.sealed), s.accepted < capacity,
    s' = { ...s, accepted: s.accepted + 1, label: "accept" } }
  action project = all { s.n < s.accepted,
    s' = { ...s, n: s.n + 1, log: s.log.set(s.n, original(s.n)),
      queue: s.queue.union(nodeKeys.filter(k => k.a + k.w == s.n + 1)), label: "project" } }

  // Raw archive sources only, newest first, including tail framing.
  def context(k: Key): Set[int] = {
    val selected = 0.range(capacity).select(i => i < k.a).foldl(List(), (acc, i) => List(i).concat(acc))
      .foldl({ refs: Set(), size: 0, full: false }, (acc, i) =>
        if (s.removed.contains(i) or acc.full) acc else
        if (acc.size + s.sizes.get(i) + 64 > 16384) { ...acc, full: true } else
        { refs: acc.refs.union(Set(i)), size: acc.size + s.sizes.get(i) + 64, full: false })
    selected.refs
  }
  // Deliberately broken old design: a bounded window of summaries chains reads.
  def summaryContext(k: Key): Set[int] = {
    val selected = s.head.lines.reverseLines().foldl({ refs: Set(), size: 0, full: false }, (acc, l) =>
      if (l.masked or l.ref.a + l.ref.w > k.a or acc.full) acc else
      if (acc.size + bytes(Set(l.ref)) > 16384) { ...acc, full: true } else
      { refs: acc.refs.union(Set(l.ref)), size: acc.size + bytes(Set(l.ref)), full: false })
    deps(selected.refs)
  }
  def fresh(j: Job): bool = j.node.gen == s.gen and j.node.context.intersect(s.removed) == Set() and
    j.node.sources.intersect(s.removed) == Set() and
    j.node.inputs.forall(r => stored(r).exists(n => clean(n))) and
    current(key(j.node.ref)) == Set()

  def withinCutoff(k: Key): bool = not(s.running) or k.a + k.w <= s.h
  action startWith(k: Key, recordContext: bool, raw: bool, ceiling: bool): bool = {
    val child = children(k)
    val ctx = if (raw) context(k) else summaryContext(k)
    val source = if (k.w == 1) Set(k.a).exclude(s.removed) else Set()
    val input = if (k.w == 1) (if (source == Set()) 0 else s.sizes.get(k.a)) else bytes(child)
    val allDeps = source.union(deps(child)).union(ctx)
    val recorded = if (recordContext) ctx else Set()
    val version = s.gen + 1
    val node: Node = { ref: { a: k.a, w: k.w, v: version }, sources: source, inputs: child,
      context: recorded, deps: source.union(deps(child)).union(recorded),
      read: allDeps, words: Set(), bytes: 0, cut: false, gen: s.gen }
    val job: Job = { node: node, rev: s.head.rev, ready: false,
      attempts: 0, shortest: 1000000, context: ctx, contextBytes: if (raw) ctx.fold(0, (v, i) => v + s.sizes.get(i) + 64) else 16384, inputBytes: input }
    all {
      s.queue.contains(k), available(k), current(k) == Set(),
      not(ceiling) or withinCutoff(k),
      not(s.jobs.exists(j => key(j.node.ref) == k)), s.jobs.size() < workers,
      s.clock >= s.due.get(k), input <= 32768,
      k.w > 1 or needed.filter(x => x.w == 1 and x.a < k.a).size() < workers,
      // Fixed text/framing + raw context + input + output reserve.
      2048 + 16384 + job.contextBytes + input <= 131072,
      s' = { ...s, jobs: s.jobs.union(Set(job)), sent: s.sent + 1,
        sentCost: 2048 + 16384 + job.contextBytes + input,
        sentWindow: 131072, stampUsed: true, target: k, label: "start" }
    }
  }
  action start(k: Key): bool = startWith(k, true, true, true)

  // An LLM can omit every fact, copy any read source, invent (-1), return an
  // oversized answer, or failJob. No invariant assumes semantic fidelity.
  action completeWith(j: Job, answerSize: int, output: Set[int], cap: bool): bool = all {
    s.jobs.contains(j), not(j.ready), j.attempts == 0 or fresh(j), output.subseteq(j.node.read.union(Set(-1))),
    val shortest = if (answerSize < j.shortest) answerSize else j.shortest
    val answer = if (answerSize < j.shortest) output else j.node.words
    val ready = shortest <= 512 or j.attempts == 4
    val oversized = ready and shortest > 16384 and cap
    val leaf = j.node.ref.w == 1
    s' = { ...s,
      // A shortening attempt reuses the bounded original input, not an
      // accumulated transcript. Revalidate before each additional call.
      sent: s.sent + (if (j.attempts > 0) 1 else 0),
      sentCost: if (j.attempts > 0) 2048 + 16384 + j.contextBytes + j.inputBytes else s.sentCost,
      sentWindow: if (j.attempts > 0) 131072 else s.sentWindow,
      stampUsed: if (j.attempts > 0) fresh(j) else s.stampUsed,
      jobs: s.jobs.exclude(Set(j)).union(Set({ ...j,
      ready: ready, attempts: j.attempts + 1, shortest: shortest,
      node: { ...j.node, bytes: if (oversized) (if (leaf) j.inputBytes else 16384) else shortest,
        words: if (oversized and leaf) j.node.sources else answer, cut: oversized and not(leaf) } })), label: "complete" }
  }
  action complete(j: Job, answerSize: int, output: Set[int]): bool = completeWith(j, answerSize, output, true)
  action abandonStale(j: Job): bool = all { s.jobs.contains(j), not(fresh(j)),
    s' = { ...s, jobs: s.jobs.exclude(Set(j)), label: "discard", target: key(j.node.ref) } }
  action failJob(j: Job): bool = all { s.jobs.contains(j), not(s.sealed),
    s' = { ...s, jobs: s.jobs.exclude(Set(j)), due: s.due.set(key(j.node.ref), s.clock + 2), label: "failJob" } }
  action clockTick = s' = { ...s, clock: s.clock + 1, label: "clock" }

  // Validate digest/generation AND head CAS in the publication transaction.
  // A failed CAS discards the candidate and leaves durable work queued.
  action publishWith(j: Job, validate: bool, cas: bool, insert: bool): bool = {
    val k = key(j.node.ref)
    val valid = (not(validate) or (fresh(j) and withinCutoff(k))) and (not(cas) or j.rev == s.head.rev)
    val replace = s.head.lines.lineSet().exists(l => key(l.ref) == k and l.masked)
    val extend = k.w == 1 and k.a == s.head.covered
    val lines = if (replace) s.head.lines.mapLines(l => if (key(l.ref) == k) { ref: j.node.ref, masked: false } else l)
      else if (extend) s.head.lines.append({ ref: j.node.ref, masked: false }) else s.head.lines
    val changed = replace or extend
    all { s.jobs.contains(j), j.ready,
      s' = if (valid) { ...s,
        nodes: if (insert) s.nodes.union(Set(j.node)) else s.nodes,
        jobs: s.jobs.exclude(Set(j)), queue: s.queue.exclude(Set(k)),
        head: if (changed) { rev: s.head.rev + 1, gen: s.gen,
          covered: s.head.covered + (if (extend) 1 else 0), lines: lines } else s.head,
        batch: s.batch or (changed and viewBytes + j.node.bytes > high),
        target: k, label: "publish" }
      else { ...s, jobs: s.jobs.exclude(Set(j)), label: "discard", target: k }
    }
  }
  action publish(j: Job): bool = publishWith(j, true, true, true)
  // A completed out-of-order leaf becomes visible only when the prefix reaches it.
  action extend = {
    nondet n = current({ a: s.head.covered, w: 1 }).oneOf()
    all { s.head.covered < s.n, not(s.running) or s.head.covered < s.h,
      s' = { ...s, head: { ...s.head, rev: s.head.rev + 1, covered: s.head.covered + 1,
        lines: s.head.lines.append({ ref: n.ref, masked: false }) },
        batch: s.batch or viewBytes + n.bytes > high, label: "extend" } }
  }
  val candidates = nodeKeys.filter(k => k.w > 1 and current(k).size() == 1 and
    s.head.lines.lineSet().exists(l => key(l.ref) == left(k) and not(l.masked)) and
    s.head.lines.lineSet().exists(l => key(l.ref) == right(k) and not(l.masked)))
  pure def dueBefore(p: Key, q: Key, t: int, useLast: bool): bool = {
    val pa = t - (if (useLast) p.a + p.w - 1 else p.a)
    val qa = t - (if (useLast) q.a + q.w - 1 else q.a)
    pa * q.w > qa * p.w or (pa * q.w == qa * p.w and p.a <= q.a)
  }
  action mergeWith(useLast: bool, keepPins: bool): bool = {
    nondet k = candidates.filter(p => candidates.forall(q => dueBefore(p, q, s.n, useLast))).oneOf()
    nondet parent = current(k).oneOf()
    all { s.batch, viewBytes > low,
      s' = { ...s, head: { ...s.head, rev: s.head.rev + 1,
        lines: s.head.lines.select(l => key(l.ref) != right(k)).mapLines(l =>
          if (key(l.ref) == left(k)) { ref: parent.ref, masked: false } else l) },
        pins: if (keepPins) s.pins else Set(), target: k, label: "merge" } }
  }
  action merge = mergeWith(true, true)
  action finishBatch = all { s.batch, viewBytes <= low,
    s' = { ...s, batch: false, label: "finishBatch" } }

  action pinWith(i: int, exact: bool, budget: bool): bool = {
    val p: Pin = { id: s.nextPin, v: 1, source: i, from: 0, to: 280,
      text: if (exact) pinText(i, 0) else -88, owner: false }
    all { not(s.sealed), live.contains(i), i != 2, i != 3, s.running, i >= s.h,
      s' = if (budget and pinBytes(s.pins) + 280 > 4096) { ...s, label: "pinBlocked" } else { ...s, pins: s.pins.union(Set(p)), pinRev: s.pinRev + 1,
        nextPin: s.nextPin + 1, label: "pin" } }
  }
  action pin(i: int): bool = pinWith(i, true, true)
  // An owner edit retains source lineage. A delayed UI save rechecks that
  // lineage, so removal cannot revive a superseded pin.
  action editPin(p: Pin, revalidate: bool): bool = all { not(s.sealed),
    s' = if (revalidate and (s.removed.contains(p.source) or not(s.pins.contains(p))))
      { ...s, label: "rejectPin" }
    else { ...s, pins: s.pins.filter(q => q.id != p.id).union(Set({ ...p, v: p.v + 1,
      owner: true, text: 7000 + p.id })), pinRev: s.pinRev + 1, label: "editPin" }
  }

  // deps is the transitive closure of exact recorded reads, cached on insert.
  // Flattening is sound because nodes are immutable and inputs precede outputs.
  // The ancestry-only bug intentionally ignores cross-interval context edges.
  action redactWith(i: int, closure: bool, queueCurrent: bool): bool = {
    val removed = s.removed.union(Set(i))
    val tainted = s.nodes.filter(n => if (closure) n.deps.intersect(removed) != Set()
      else span(key(n.ref)).intersect(removed) != Set()).map(n => n.ref)
    val dirty = s.nodes.filter(n => tainted.contains(n.ref)).map(n => key(n.ref))
    val rebuild = dirty.filter(k => not(s.nodes.exists(n => key(n.ref) == k and n.deps.intersect(removed) == Set())))
    all { not(s.sealed), live.contains(i),
      s' = { ...s, removed: removed, gen: s.gen + 1, log: s.log.set(i, -1),
        head: { ...s.head, rev: s.head.rev + 1, gen: s.gen + 1,
          lines: s.head.lines.mapLines(l => { ...l, masked: l.masked or tainted.contains(l.ref) }) },
        pins: s.pins.filter(p => p.source != i), pinRev: s.pinRev + (if (s.pins.exists(p => p.source == i)) 1 else 0),
        queue: s.queue.union(if (queueCurrent) rebuild else dirty), requestReady: false, admitted: false,
        visibleReport: if (s.visibleReport.contains(i)) Set() else s.visibleReport, readIds: Set(), readItems: List(), opened: Set(),
        label: "redact" } }
  }
  action redact(i: int): bool = redactWith(i, true, true)
  // Purge removes only unusable versions; the FULL tombstone remains. Other
  // stores, journal rotation, backup nodeKeys and the 24h deadline belong to WP4/16.
  action purge = all { s.nodes.exists(n => not(clean(n))),
    s' = { ...s, nodes: s.nodes.filter(n => clean(n)), label: "purge" } }

  action beginRun = all { not(s.sealed), not(s.running),
    s' = { ...s, running: true, h: s.n, label: "beginRun" } }
  action endRun = s' = { ...s, running: false, requestReady: false, admitted: false, label: "endRun" }

  // The live head cannot pass the run cutoff.
  action prepareWith(overlap: bool, mixed: bool, window: int): bool = {
    val snapHead = s.head
    val refs = snapHead.lines.select(l => not(l.masked)).lineSet().map(l => l.ref)
    val tailIds = ids.filter(i => i >= snapHead.covered and i < (if (overlap) s.n else s.h))
    val active = ids.filter(i => i >= s.h and i < s.n)
    val tailCost = tailIds.exclude(s.removed).fold(0, (v, i) => v + s.sizes.get(i) + 64)
    val omit = if (tailCost > 24576) tailIds else Set()
    val ps = if (mixed) before.pins else s.pins
    val visible = tailIds.exclude(omit).union(active).exclude(s.removed)
    val cost = 2048 + 16384 + pinBytes(ps) + bytes(refs) +
      snapHead.lines.select(l => l.masked).length() * 32 +
      (if (omit == Set()) tailCost else 128) +
      active.exclude(s.removed).fold(0, (v, i) => v + (if (i == 3) 2048 else s.sizes.get(i)) + 64)
    val r: Request = { head: snapHead, pins: ps, pinRev: s.pinRev, cutoff: s.n, h: s.h,
      tail: tailIds, active: active, omitted: omit, items: items(visible),
      deps: deps(refs).union(ps.map(p => p.source)).union(visible),
      cost: cost, window: window, stamp: true, path: "chat" }
    all { s.running,
      s' = { ...s, request: r, signed: r, requestReady: true, admitted: false, blocked: false, label: "prepare" } }
  }
  action prepare(window: int): bool = prepareWith(false, false, window)
  pure def protocol(r: Request): bool = r.items.itemSet().forall(x =>
    x.meta == 900 + x.id and x.pair == (if (x.id == 2 or x.id == 3) 77 else -1)) and
    (r.active.contains(2) == r.active.contains(3)) and
    r.items.select(x => r.active.contains(x.id)).itemSet().forall(x =>
      (x.kind != 1 or r.items.itemSet().exists(y => r.active.contains(y.id) and y.kind == 2 and y.pair == x.pair)) and
      (x.kind != 2 or r.items.itemSet().exists(y => r.active.contains(y.id) and y.kind == 1 and y.pair == x.pair))) and
    r.items.indices().forall(i => r.items.indices().forall(j => i >= j or r.items.nth(i).id < r.items.nth(j).id))
  // The guard also authenticates the rendered payload, model window, rev/gen,
  // and pin revision. `stamp` abstracts a trusted digest, not a model boolean.
  action dispatchWith(bound: bool, generation: bool, stamp: bool, pinRevision: bool): bool = {
    val r = s.request
    val ok = (not(bound) or (r.cost <= r.window and protocol(r))) and
      (not(generation) or (r.head.gen == s.gen and (not(pinRevision) or r.pinRev == s.pinRev) and r.deps.intersect(s.removed) == Set())) and
      (not(stamp) or (r.stamp and r == s.signed)) and r.active.fold(0, (v, i) => v + s.sizes.get(i)) <= 65536
    all { s.requestReady or r.stamp,
      s' = if (ok) { ...s, requestReady: false, admitted: true, blocked: false,
        sent: s.sent + 1, sentCost: r.cost, sentWindow: r.window, stampUsed: r.stamp and r == s.signed, label: "dispatch" }
      else { ...s, requestReady: false, admitted: false, blocked: true, label: "blocked" } }
  }
  action dispatch = dispatchWith(true, true, true, true)
  action rawHook = s' = { ...s, request: { ...s.request, stamp: false }, requestReady: true, label: "rawHook" }
  action breakPair = {
    val malformed = { ...s.request, items: s.request.items.mapItems(x => if (x.id == 3) { ...x, pair: 99 } else x) }
    s' = { ...s, request: malformed, signed: malformed, label: "breakPair" }
  }
  action changePayload = s' = { ...s, request: { ...s.request, cost: s.request.cost + 1 }, label: "changePayload" }


  action startReport = s' = { ...s, report: live, reportGen: s.gen, reportReady: true, label: "startReport" }
  action reportWith(guard: bool): bool = all { s.reportReady,
    s' = { ...s, reportReady: false, visibleReport:
      if (guard and s.reportGen != s.gen) Set() else s.report, label: "report" } }
  // Exact source pages are abstracted by one opaque sourceItem. A parent opens only
  // clean exact child versions; a dirty branch returns unavailable, never text.
  action zoom(k: Key): bool = {
    val permitted = if (k.w == 1) span(k).intersect(live) else Set()
    val opened = if (k.w > 1 and current(k).size() == 1) children(k) else Set()
    all { k.a + k.w <= s.n,
      s' = { ...s, queried: k, readIds: permitted, readItems: items(permitted),
        readRemoved: span(k).intersect(s.removed), opened: opened, label: "zoom" } }
  }

  // Jobs are volatile; queue rows and due times are durable. Restart never
  // reconstructs a different view from the archive.
  action crashWith(keepQueue: bool, keepHead: bool): bool = all { not(s.sealed),
    s' = { ...s, jobs: Set(), requestReady: false, admitted: false,
      queue: if (keepQueue) s.queue else Set(),
      head: if (keepHead) s.head else { ...s.head, covered: 0, lines: List() }, label: "crash" } }
  action crash = crashWith(true, true)
  action seal = all { not(s.sealed), s' = { ...s, sealed: true, running: false, label: "seal" } }

  // Relational invariants use the actual previous committed state, saved by
  // tick. They are not assertions set to true by the action under examination.
  val sourceIdentityStable = s.n >= before.n and s.n <= s.accepted and
    logged.forall(i => s.removed.contains(i) or s.log.get(i) == original(i))
  val retainedSourceExact = live.forall(i => s.log.get(i) == original(i))
  val redactionMonotone = before.removed.subseteq(s.removed) and before.gen <= s.gen
  val nodeIdentityStable = s.nodes.forall(n => before.nodes.forall(old =>
    old.ref != n.ref or old == n))
  val nodeInputsCurrent = (s.label != "start" or s.jobs.exclude(before.jobs).forall(j =>
    j.context == context(key(j.node.ref)) and j.node.context == j.context)) and
    (s.label != "publish" or s.nodes.exclude(before.nodes).forall(n =>
    n.gen == before.gen and n.deps == n.read and n.deps.intersect(before.removed) == Set() and
    before.jobs.exists(j => j.node == n and j.context == n.context and
      j.node.inputs.forall(r => before.nodes.exists(c => c.ref == r and c.deps.intersect(before.removed) == Set())))))
  val treeClosed = s.nodes.filter(n => clean(n)).forall(n => n.ref.w == 1 or
    Set(left(key(n.ref)), right(key(n.ref))).forall(k =>
      n.inputs.exists(r => key(r) == k and stored(r).exists(c => clean(c)))))
  val viewPartition = s.head.covered >= 0 and s.head.covered <= s.n and
    s.head.lines.lineSet().map(l => span(key(l.ref))).flatten() == ids.filter(i => i < s.head.covered) and
    s.head.lines.indices().forall(i => {
      val l = s.head.lines.nth(i)
      nodeKeys.contains(key(l.ref)) and (if (i == 0) l.ref.a == 0 else
        s.head.lines.nth(i - 1).ref.a + s.head.lines.nth(i - 1).ref.w == l.ref.a)
    })
  val viewReferencesValid = s.head.gen == s.gen and s.head.lines.lineSet().forall(l =>
    l.masked or stored(l.ref).exists(n => clean(n)))
  val viewCAS = s.label != "publish" or s.head == before.head or
    before.jobs.exists(j => key(j.node.ref) == s.target and j.rev == before.head.rev and j.node.gen == before.gen)
  val restartPreservesHead = s.label != "crash" or s.head == before.head
  val mergePreservesCoverage = s.label != "merge" or
    (s.head.covered == before.head.covered and s.head.lines.length() + 1 == before.head.lines.length() and
     before.head.lines.lineSet().exists(l => key(l.ref) == left(s.target)) and
     before.head.lines.lineSet().exists(l => key(l.ref) == right(s.target)))
  val mergeDueOrder = s.label != "merge" or nodeKeys.filter(k => k.w > 1 and
    before.nodes.exists(n => key(n.ref) == k and n.deps.intersect(before.removed) == Set()) and
    before.head.lines.lineSet().exists(l => key(l.ref) == left(k) and not(l.masked)) and
    before.head.lines.lineSet().exists(l => key(l.ref) == right(k) and not(l.masked))).forall(q => dueBefore(s.target, q, before.n, true))
  val prefixBetweenBatches = (Set("merge", "redact").contains(s.label) or
    (s.label == "publish" and before.head.lines.lineSet().exists(l => l.masked))) or
    s.head.lines.length() >= before.head.lines.length() and
    s.head.lines.slice(0, before.head.lines.length()) == before.head.lines
  val pinAuthorityExact = (s.label != "pin" or s.pins.exclude(before.pins).forall(p =>
    before.running and p.source >= before.h and p.v == 1)) and s.pins.forall(p => live.contains(p.source) and p.source != 2 and p.source != 3 and
    p.from >= 0 and p.to <= s.sizes.get(p.source) and
    (if (p.owner) p.text == 7000 + p.id else p.text == pinText(p.source, p.from)))
  val pinBudget = pinBytes(s.pins) <= 4096 and s.pins.forall(p => p.to - p.from <= 280 and p.to > p.from)
  val pinsSurviveCompaction = not(Set("start", "complete", "publish", "merge", "crash").contains(s.label)) or s.pins == before.pins
  val redactionExcludesReads = s.pins.map(p => p.source).intersect(s.removed) == Set() and
    s.visibleReport.intersect(s.removed) == Set() and s.readIds.intersect(s.removed) == Set() and
    viewRefs.forall(r => stored(r).forall(n => n.read.intersect(s.removed) == Set())) and
    (s.label != "dispatch" or s.request.deps.intersect(s.removed) == Set())
  val retrievalSound = s.label != "zoom" or
    (s.readIds.subseteq(span(s.queried).intersect(live)) and s.readItems == items(s.readIds) and
      s.opened.forall(r => Set(left(s.queried), right(s.queried)).contains(key(r)) and stored(r).exists(n => clean(n))) and
      (s.opened == Set() or s.opened.map(r => span(key(r))).flatten() == span(s.queried)))
  val requestSnapshotConsistent =
    (s.label != "prepare" or (s.request.pins == before.pins and s.request.pinRev == before.pinRev and
      s.request.head.rev == before.head.rev and s.request.head.gen == before.gen and s.request.cutoff == before.n and
      s.request.head == before.head)) and
    (s.label != "dispatch" or (s.request.head.gen == s.gen and s.request.pinRev == s.pinRev))
  val requestCoverageDeclared = not(s.requestReady or s.admitted) or {
    val r = s.request
    val v = r.head.lines.lineSet().map(l => span(key(l.ref))).flatten()
    v.intersect(r.tail) == Set() and v.intersect(r.active) == Set() and r.tail.intersect(r.active) == Set() and
    v.union(r.tail).union(r.active) == ids.filter(i => i < r.cutoff) and r.omitted.subseteq(r.tail) and
    r.items.itemSet().map(x => x.id) == r.tail.exclude(r.omitted).union(r.active).intersect(r.deps)
  }
  val requestProtocolValid = s.label != "dispatch" or protocol(s.request)
  val requestBounded = s.sentCost <= s.sentWindow and (s.label != "blocked" or s.sent == before.sent)
  val mandatoryPinsIncluded = s.label != "dispatch" or s.request.pins == s.pins
  val compactorLimits = s.jobs.size() <= workers and s.jobs.forall(j =>
    j.contextBytes <= 16384 and j.inputBytes <= 32768 and j.attempts <= 5) and
    (s.label != "start" or s.target.w > 1 or nodeKeys.filter(k => k.w == 1 and k.a < s.target.a and
      k.a < before.n and not(before.nodes.exists(n => key(n.ref) == k and n.deps.intersect(before.removed) == Set()))).size() < workers)
  val pendingWorkRecoverable = needed == s.queue
  val taintClosureExact = s.label != "redact" or s.head.lines.lineSet().forall(l =>
    l.masked == (before.head.lines.lineSet().exists(old => key(old.ref) == key(l.ref) and old.masked) or
      before.nodes.exists(n => n.ref == l.ref and n.deps.intersect(s.removed) != Set())))
  val viewWithinCutoff = not(s.running) or s.head.covered <= s.h
  val nodeBounded = s.nodes.forall(n => n.bytes <= 16384)
  val parentInputFits = nodeKeys.filter(k => k.w > 1 and available(k)).forall(k => bytes(children(k)) <= 32768)
  val pinEditCurrent = s.label != "editPin" or s.pins.exclude(before.pins).forall(p =>
    before.pins.exists(old => old.id == p.id and old.v + 1 == p.v and old.source == p.source) and
    not(s.removed.contains(p.source)) and s.pins.filter(q => q.id == p.id).size() == 1) and
    (s.label != "editPin" or s.pins != before.pins)
  // Test only nodes affected by this removal, not previously queued work.
  val taintLocal = s.label != "redact" or {
    val removedNow = s.removed.exclude(before.removed)
    before.nodes.filter(n => n.deps.intersect(removedNow) != Set()).forall(n => removedNow.forall(m =>
      not(n.deps.contains(m)) or span(key(n.ref)).contains(m) or
      (n.ref.a > m and m.to(n.ref.a - 1).exclude(before.removed).fold(0, (v, i) => v + before.sizes.get(i)) <= 16384)))
  }
  val guardStampRequired = s.stampUsed
  val safety = sourceIdentityStable and retainedSourceExact and redactionMonotone and nodeIdentityStable and
    nodeInputsCurrent and treeClosed and viewPartition and viewReferencesValid and viewCAS and restartPreservesHead and
    mergePreservesCoverage and mergeDueOrder and prefixBetweenBatches and pinAuthorityExact and pinBudget and
    pinsSurviveCompaction and redactionExcludesReads and retrievalSound and requestSnapshotConsistent and
    requestCoverageDeclared and requestProtocolValid and requestBounded and mandatoryPinsIncluded and
    compactorLimits and pendingWorkRecoverable and taintClosureExact and guardStampRequired and taintLocal and viewWithinCutoff and
    pinEditCurrent and nodeBounded and parentInputFits

  val settled = s.n == s.accepted and needed == Set() and s.jobs == Set() and
    s.head.covered == s.n and masked == Set() and s.nodes.forall(n => clean(n))
  // A batch can be irreducible (popcount, unavailable parents).
  // Progress promises finishing only when the required low partition is feasible.
  val batchFeasible = s.head.covered == s.n and s.n == 4 and
    current({ a: 0, w: 4 }).exists(n => n.bytes <= low)
  val reachedAgreement = s.label == "finished" and s.sealed and settled and (not(batchFeasible) or not(s.batch))
  val drainBound = remaining > 0 or reachedAgreement
  val invariants = safety and drainBound

  // Drain prioritizes real recovery transitions, never assigns a finished
  // memory. Quiet means clock, storage, allowance and model success recover.
  action progress =
    if (s.n < s.accepted) project else
    if (s.jobs != Set()) {
      nondet j = s.jobs.oneOf()
      if (not(fresh(j))) abandonStale(j) else if (j.ready) publish(j) else complete(j, 512, Set())
    } else if (needed.exists(k => available(k) and s.clock >= s.due.get(k))) {
      nondet k = needed.filter(k => available(k) and s.clock >= s.due.get(k) and
        (k.w > 1 or needed.filter(x => x.w == 1 and x.a < k.a).size() < workers)).oneOf()
      start(k)
    } else if (needed != Set()) clockTick else
    if (s.head.covered < s.n) extend else
    if (s.nodes.exists(n => not(clean(n)))) purge else
    if (s.batch and viewBytes <= low) finishBatch else
    if (s.batch and candidates != Set()) merge else s' = { ...s, label: if (settled) "finished" else "idle" }
  action input = any {
    all { s.accepted < 4, accept }, project, beginRun, endRun, crash, seal, clockTick, extend, merge, finishBatch, purge,
    { nondet k = nodeKeys.oneOf(); any { start(k), zoom(k) } },
    { nondet j = s.jobs.oneOf(); nondet answerSize = Set(512, 2048, 8192, 20000).oneOf();
      nondet output = j.node.read.union(Set(-1)).powerset().oneOf(); any { complete(j, answerSize, output), publish(j), failJob(j), abandonStale(j) } },
    { nondet i = live.oneOf(); any { pin(i), redact(i) } },
    { nondet p = s.pins.oneOf(); editPin(p, true) },
    prepare(300000), prepare(20000), dispatch, startReport, reportWith(true)
  }
  action tick(a: bool): bool = all { a, before' = s, pc' = pc + 1, scenario' = scenario,
    remaining' = if (s.sealed and not(reachedAgreement)) remaining - 1 else remaining }
  action step = tick(if (s.sealed) progress else input)
  action simulationStep = all { not(reachedAgreement), step }
  temporal eventuallyProjected = progress.weakFair(s).implies(eventually(always(s.sealed)).implies(eventually(s.n == s.accepted)))
  temporal eventuallySummarized = progress.weakFair(s).implies(eventually(always(s.sealed)).implies(eventually(settled)))
  temporal retryEventuallyRuns = progress.weakFair(s).implies(eventually(always(s.sealed)).implies(eventually(s.queue == Set())))
  temporal redactionEventuallySettles = progress.weakFair(s).implies(eventually(always(s.sealed)).implies(eventually(masked == Set() and s.nodes.forall(n => clean(n)))))
  temporal batchEventuallyFinishes = progress.weakFair(s).implies(eventually(always(s.sealed and batchFeasible)).implies(eventually(not(s.batch))))

  // Script commands call the same actions as random exploration. pc is a ghost
  // program counter; a rejected stale result still takes its scheduled step.
  type Command = { op: str, a: int, w: int }
  pure def c(op: str, a: int, w: int): Command = { op: op, a: a, w: w }
  pure val one = List(c("accept", 0, 1), c("project", 0, 1))
  pure def build(a: int, w: int): List[Command] = List(c("start", a, w), c("complete", a, w), c("publish", a, w))
  pure val two = one.concat(one)
  pure val twoBuilt = one.concat(build(0, 1)).concat(one).concat(build(1, 1))
  pure val fourBuilt = twoBuilt.concat(one).concat(build(2, 1)).concat(one).concat(build(3, 1))
  action execute(cmd: Command, bug: str): bool = {
    val k = { a: cmd.a, w: cmd.w }
    val op = cmd.op
    if (op == "ceilingStart") {
      if (bug == "pastCutoff") startWith(k, true, true, false) else
      all { not(withinCutoff(k)), s' = { ...s, label: "cutoffRefused" } }
    } else
    if (op == "ceilingComplete" or op == "ceilingPublish") {
      if (bug != "pastCutoff") s' = { ...s, label: "cutoffRefused" } else {
        nondet j = s.jobs.oneOf()
        if (op == "ceilingComplete") complete(j, 512, j.node.read) else publishWith(j, false, true, true)
      }
    } else
    if (op == "accept") accept else
    if (op == "project") project else
    if (op == "start") startWith(k, bug != "unrecordedContext", bug != "summaryContext", bug != "pastCutoff") else
    if (op == "complete") { nondet j = s.jobs.filter(j => key(j.node.ref) == k).oneOf(); complete(j, 512, j.node.read) } else
    if (op == "huge") { nondet j = s.jobs.filter(j => key(j.node.ref) == k).oneOf(); completeWith(j, 20000, j.node.read, bug != "noCap") } else
    if (op == "oversize") { nondet j = s.jobs.filter(j => key(j.node.ref) == k).oneOf(); complete(j, 2048, j.node.read.union(Set(-1))) } else
    if (op == "publish") { nondet j = s.jobs.filter(j => key(j.node.ref) == k).oneOf();
      publishWith(j, bug != "stalePublish" and bug != "pastCutoff", bug != "staleCAS" and bug != "stalePublish", bug != "missingParent") } else
    if (op == "failJob") { nondet j = s.jobs.filter(j => key(j.node.ref) == k).oneOf(); failJob(j) } else
    if (op == "redact") redactWith(cmd.a, bug != "ancestry", bug != "queueAll") else
    if (op == "begin") beginRun else
    if (op == "end") endRun else
    if (op == "pin") pinWith(cmd.a, bug != "pinText", bug != "pinBudget") else
    if (op == "edit") { nondet p = s.pins.oneOf(); editPin(p, true) } else
    if (op == "lateEdit") { nondet p = before.pins.oneOf(); editPin(p, bug != "stalePin") } else
    if (op == "prepare") prepareWith(bug == "overlap", bug == "mixed", cmd.a) else
    if (op == "dispatch") dispatchWith(bug != "unbounded" and bug != "toolPair", bug != "staleRequest", bug != "rawHook" and bug != "hash", bug != "genOnly") else
    if (op == "crash") crashWith(bug != "lostQueue", bug != "restartView") else
    if (op == "raw") rawHook else
    if (op == "pair") breakPair else
    if (op == "mutate") changePayload else
    if (op == "startReport") startReport else
    if (op == "report") reportWith(bug != "staleReport") else
    if (op == "merge") mergeWith(bug != "dueFirst", bug != "lostPins") else
    if (op == "nonSiblings") {
      if (bug != "nonSiblings") merge else {
        nondet parent = current({ a: 0, w: 2 }).oneOf()
        s' = { ...s, head: { ...s.head, rev: s.head.rev + 1,
          lines: s.head.lines.select(l => l.ref.a != 2).mapLines(l =>
            if (l.ref.a == 1) { ref: parent.ref, masked: false } else l) },
          target: { a: 0, w: 2 }, label: "merge" }
      }
    } else s' = { ...s, label: "idle" }
  }
  action script(commands: List[Command], bug: str): bool = all {
    not(reachedAgreement),
    tick(if (pc < commands.length()) execute(commands.nth(pc), bug) else
      if (not(s.sealed)) seal else
      if (bug == "retryNeedsInput" and needed != Set()) s' = { ...s, label: "idle" } else progress)
  }

  // Plan #6: digest checked before, rather than inside, the commit transaction.
  pure val redactionRace = one.concat(List(c("start", 0, 1), c("complete", 0, 1), c("redact", 0, 1), c("publish", 0, 1)))
  action redactionRaceStep = script(redactionRace, "")
  action redactionRaceBugStep = script(redactionRace, "stalePublish")
  // Plan #7: node 1 reads source 0 despite not containing its interval.
  pure val contextRace = twoBuilt.concat(List(c("redact", 0, 1)))
  action contextRaceStep = script(contextRace, "")
  action contextRaceBugStep = script(contextRace, "ancestry")
  action unrecordedContextStep = script(contextRace, "")
  action unrecordedContextBugStep = script(contextRace, "unrecordedContext")
  // Plan #8, all three ingress paths, rather than one representative callback.
  pure val lateReport = one.concat(List(c("startReport", 0, 1), c("redact", 0, 1), c("report", 0, 1)))
  action lateReportStep = script(lateReport, "")
  action lateReportBugStep = script(lateReport, "staleReport")
  pure val latePin = List(c("begin", 0, 1)).concat(one).concat(List(c("pin", 0, 1), c("redact", 0, 1), c("lateEdit", 0, 1)))
  action latePinStep = script(latePin, "")
  action latePinBugStep = script(latePin, "stalePin")
  pure val lateRequest = List(c("begin", 0, 1)).concat(one).concat(List(c("prepare", 300000, 1), c("redact", 0, 1), c("dispatch", 0, 1)))
  action lateRequestStep = script(lateRequest, "")
  action lateRequestBugStep = script(lateRequest, "staleRequest")
  // A rejected stale request is a visible blocked turn, not a disabled action.
  // Keep the prepared object after invalidation so the provider guard can reject it.

  // Plan #9: five shortening attempts still leave a node above target; pins
  // plus that view exceed the final fallback on a small model.
  pure val overflow = List(c("begin", 0, 1)).concat(one).concat(List(c("pin", 0, 1), c("end", 0, 1), c("start", 0, 1),
    c("oversize", 0, 1), c("oversize", 0, 1), c("oversize", 0, 1), c("oversize", 0, 1), c("oversize", 0, 1),
    c("publish", 0, 1), c("end", 0, 1), c("begin", 0, 1), c("prepare", 20000, 1), c("dispatch", 0, 1)))
  action overflowStep = script(overflow, "")
  action overflowBugStep = script(overflow, "unbounded")
  // Plan #10: the tail must stop at the run cutoff.
  pure val overlap = List(c("begin", 0, 1)).concat(one).concat(List(c("prepare", 300000, 1), c("dispatch", 0, 1)))
  action overlapStep = script(overlap, "")
  action overlapBugStep = script(overlap, "overlap")
  // A refused start is observed explicitly; the corrected schedule resumes after endRun.
  pure val fastCompactor = List(c("begin", 0, 1)).concat(one).concat(List(c("ceilingStart", 0, 1), c("ceilingComplete", 0, 1), c("ceilingPublish", 0, 1), c("end", 0, 1)))
  action fastCompactorStep = script(fastCompactor, "")
  action fastCompactorBugStep = script(fastCompactor, "pastCutoff")
  pure val editedRequest = List(c("begin", 0, 1)).concat(one).concat(List(c("pin", 0, 1),
    c("prepare", 300000, 1), c("edit", 0, 1), c("dispatch", 0, 1)))
  action editedRequestStep = script(editedRequest, "")
  action editedRequestBugStep = script(editedRequest, "genOnly")
  pure val doubleEdit = List(c("begin", 0, 1)).concat(one).concat(List(c("pin", 0, 1),
    c("snapshot", 0, 1), c("lateEdit", 0, 1), c("lateEdit", 0, 1)))
  action doubleEditStep = script(doubleEdit, "")
  action doubleEditBugStep = script(doubleEdit, "stalePin")
  pure val localTaint = fourBuilt.concat(one).concat(build(4, 1)).concat(one).concat(build(5, 1)).concat(List(c("redact", 0, 1)))
  action localTaintStep = script(localTaint, "")
  action localTaintBugStep = script(localTaint, "summaryContext")
  pure def hugeBuild(a: int, w: int): List[Command] = List(c("start", a, w)).concat(
    0.range(5).foldl(List(), (acc, _) => acc.append(c("huge", a, w)))).append(c("publish", a, w))
  pure val oversizeParent = one.concat(hugeBuild(0, 1)).concat(one).concat(hugeBuild(1, 1)).concat(hugeBuild(0, 2))
  action oversizeParentStep = script(oversizeParent, "")
  action oversizeParentBugStep = script(oversizeParent, "noCap")
  // Two workers read the same head. The later one may not overwrite it.
  pure val casRace = two.concat(List(c("start", 0, 1), c("start", 1, 1), c("complete", 0, 1), c("complete", 1, 1),
    c("publish", 0, 1), c("publish", 1, 1)))
  action casRaceStep = script(casRace, "")
  action casRaceBugStep = script(casRace, "staleCAS")
  pure val atomicPublish = one.concat(build(0, 1)).concat(List(c("crash", 0, 1)))
  action atomicPublishStep = script(atomicPublish, "")
  action atomicPublishBugStep = script(atomicPublish, "missingParent")
  action restartStep = script(atomicPublish, "")
  action restartBugStep = script(atomicPublish, "restartView")
  pure val crashTail = one.concat(List(c("start", 0, 1))).concat(one).concat(List(c("crash", 0, 1)))
  action crashTailStep = script(crashTail, "")
  action crashTailBugStep = script(crashTail, "lostQueue")
  pure val retryQuiet = one.concat(List(c("start", 0, 1), c("failJob", 0, 1), c("crash", 0, 1)))
  action retryQuietStep = script(retryQuiet, "")
  action retryQuietBugStep = script(retryQuiet, "retryNeedsInput")
  pure val rawRequest = List(c("begin", 0, 1)).concat(one).concat(List(c("prepare", 300000, 1), c("raw", 0, 1), c("dispatch", 0, 1)))
  action rawRequestStep = script(rawRequest, "")
  action rawRequestBugStep = script(rawRequest, "rawHook")
  pure val alteredRequest = List(c("begin", 0, 1)).concat(one).concat(List(c("prepare", 300000, 1), c("mutate", 0, 1), c("dispatch", 0, 1)))
  action alteredRequestStep = script(alteredRequest, "")
  action alteredRequestBugStep = script(alteredRequest, "hash")
  pure val mixedSnapshot = List(c("begin", 0, 1)).concat(one).concat(List(c("pin", 0, 1), c("prepare", 300000, 1)))
  action mixedSnapshotStep = script(mixedSnapshot, "")
  action mixedSnapshotBugStep = script(mixedSnapshot, "mixed")
  pure val badPin = List(c("begin", 0, 1)).concat(one).concat(List(c("pin", 0, 1)))
  action pinTextStep = script(badPin, "")
  action pinTextBugStep = script(badPin, "pinText")
  // Atomic admission returns a refusal for the fifteenth 280-byte pin.
  pure val manyPins = List(c("begin", 0, 1)).concat(one).concat(0.range(15).foldl(List(), (acc, _) => acc.append(c("pin", 0, 1))))
  action pinBudgetStep = script(manyPins, "")
  action pinBudgetBugStep = script(manyPins, "pinBudget")
  pure val toolPair = List(c("begin", 0, 1)).concat(two).concat(two).concat(List(c("prepare", 300000, 1), c("pair", 0, 1), c("dispatch", 0, 1)))
  action toolPairStep = script(toolPair, "")
  action toolPairBugStep = script(toolPair, "toolPair")

  // A second removal before purge must not queue a clean rebuilt version just
  // because an obsolete version of the same key is still awaiting deletion.
  pure val queueCurrent = twoBuilt.concat(List(c("redact", 0, 1))).concat(build(0, 1)).concat(build(1, 1)).concat(List(c("redact", 1, 1)))
  action queueCurrentStep = script(queueCurrent, "")
  action queueCurrentBugStep = script(queueCurrent, "queueAll")

  // T=10's starting partition is a valid persisted head from earlier batches.
  // Seed only the initial state; the choices under test use the real merge.
  pure val fixtureNodes: Set[Node] = nodeKeys.filter(k => k.a + k.w <= 10).map(k => {
    ref: { a: k.a, w: k.w, v: 1 },
    sources: if (k.w == 1) span(k) else Set(),
    inputs: if (k.w == 1) Set() else Set({ a: k.a, w: k.w / 2, v: 1 }, { a: k.a + k.w / 2, w: k.w / 2, v: 1 }),
    context: if (k.a == 0) Set() else Set(k.a - 1),
    deps: span(k).union(if (k.a == 0) Set() else Set(k.a - 1)),
    read: span(k).union(if (k.a == 0) Set() else Set(k.a - 1)),
    words: span(k), bytes: 512, cut: false, gen: 0 })
  pure def fixture(lines: List[Line], n: int): State = { ...initial, n: n, accepted: n,
    log: ids.mapBy(i => if (i < n) original(i) else -1),
    nodes: fixtureNodes.filter(x => x.ref.a + x.ref.w <= n),
    head: { rev: 32, gen: 0, covered: n, lines: lines }, batch: true }
  pure def line(a: int, w: int): Line = { ref: { a: a, w: w, v: 1 }, masked: false }
  pure val dueState = fixture(List(line(0, 4), line(4, 4), line(8, 1), line(9, 1)), 10)
  action dueInit = all { s' = dueState, before' = dueState, pc' = 0, scenario' = 0, remaining' = drainLimit }
  action dueOrderStep = script(List(c("merge", 0, 1)), "")
  action dueOrderBugStep = script(List(c("merge", 0, 1)), "dueFirst")
  pure val siblingBase = fixture(List(line(0, 1), line(1, 1), line(2, 1), line(3, 1)), 4)
  pure val siblingState = { ...siblingBase, nodes: siblingBase.nodes.map(n =>
    if (n.ref.w == 1) { ...n, bytes: 768 } else n) }
  action siblingInit = all { s' = siblingState, before' = siblingState, pc' = 0, scenario' = 0, remaining' = drainLimit }
  action siblingsStep = script(List(c("nonSiblings", 0, 1)), "")
  action siblingsBugStep = script(List(c("nonSiblings", 0, 1)), "nonSiblings")
  pure val pinnedState = { ...siblingState, pins: Set({ id: 0, v: 1, source: 0, from: 0, to: 280, text: pinText(0, 0), owner: false }), nextPin: 1, pinRev: 1 }
  action pinnedInit = all { s' = pinnedState, before' = pinnedState, pc' = 0, scenario' = 0, remaining' = drainLimit }
  action compactionPinsStep = script(List(c("merge", 0, 1)), "")
  action compactionPinsBugStep = script(List(c("merge", 0, 1)), "lostPins")

  // One simulator startup covers every corrected schedule. The runner requires
  // a completed witness for each case, so sampling cannot silently omit one.
  action suiteInit = {
    nondet which = 0.to(27).oneOf()
    val state = if (which == 21) dueState else if (which == 22) siblingState else
      if (which == 23) pinnedState else initial
    all { s' = state, before' = state, pc' = 0, scenario' = which, remaining' = drainLimit }
  }
  val suiteCommands = List(
    redactionRace,
    contextRace,
    contextRace,
    lateReport,
    latePin,
    lateRequest,
    overflow,
    overlap,
    fastCompactor,
    editedRequest,
    casRace,
    atomicPublish,
    atomicPublish,
    crashTail,
    retryQuiet,
    rawRequest,
    alteredRequest,
    mixedSnapshot,
    badPin,
    manyPins,
    toolPair,
    List(c("merge", 0, 1)),
    List(c("nonSiblings", 0, 1)),
    List(c("merge", 0, 1)),
    queueCurrent, localTaint, doubleEdit, oversizeParent).nth(scenario)
  action suiteStep = script(suiteCommands, "")
  val case0 = scenario == 0 and reachedAgreement
  val case1 = scenario == 1 and reachedAgreement
  val case2 = scenario == 2 and reachedAgreement
  val case3 = scenario == 3 and reachedAgreement
  val case4 = scenario == 4 and reachedAgreement
  val case5 = scenario == 5 and reachedAgreement
  val case6 = scenario == 6 and reachedAgreement
  val case7 = scenario == 7 and reachedAgreement
  val case8 = scenario == 8 and reachedAgreement
  val case9 = scenario == 9 and reachedAgreement
  val case10 = scenario == 10 and reachedAgreement
  val case11 = scenario == 11 and reachedAgreement
  val case12 = scenario == 12 and reachedAgreement
  val case13 = scenario == 13 and reachedAgreement
  val case14 = scenario == 14 and reachedAgreement
  val case15 = scenario == 15 and reachedAgreement
  val case16 = scenario == 16 and reachedAgreement
  val case17 = scenario == 17 and reachedAgreement
  val case18 = scenario == 18 and reachedAgreement
  val case19 = scenario == 19 and reachedAgreement
  val case20 = scenario == 20 and reachedAgreement
  val case21 = scenario == 21 and reachedAgreement
  val case22 = scenario == 22 and reachedAgreement
  val case23 = scenario == 23 and reachedAgreement
  val case24 = scenario == 24 and reachedAgreement

  val case25 = scenario == 25 and reachedAgreement
  val case26 = scenario == 26 and reachedAgreement
  val case27 = scenario == 27 and reachedAgreement

  // Archive and removal exploration is deliberately separate from the longer
  // job race. These are the same transactions, with no symbolic script decoder.
  action boundedStep = tick(any {
    accept, project, crash,
    { nondet i = live.oneOf(); redact(i) }
  })
  val boundedSafety = sourceIdentityStable and retainedSourceExact and redactionMonotone and
    viewPartition and viewReferencesValid and restartPreservesHead and pendingWorkRecoverable
  action boundedRace(guard: bool): bool = tick(
    if (pc == 0) accept else
    if (pc == 1) project else
    if (pc == 2) start({ a: 0, w: 1 }) else
    if (pc == 3) { nondet j = s.jobs.oneOf(); complete(j, 512, j.node.read) } else
    if (pc == 4) redact(0) else
    if (pc == 5) { nondet j = s.jobs.oneOf(); publishWith(j, guard, guard, true) } else
    s' = { ...s, label: "idle" })
  action boundedRaceStep = boundedRace(true)
  action boundedRaceBugStep = boundedRace(false)

}
module agent_memory_bounded {
  import memoryProtocol(capacity = 2, workers = 2, high = 2048, low = 1024, drainLimit = 64).*
}
module agent_memory {
  import memoryProtocol(capacity = 10, workers = 8, high = 2048, low = 1024, drainLimit = 64).*
}
