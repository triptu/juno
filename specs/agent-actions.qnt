// Plan v3 WP3. FULL transactions are atomic. Transport handoff, remote
// acceptance and evidence commits are deliberately separate crash points.
module actionsProtocol {
  const children: int
  const drainLimit: int
  type Payload = { connection: int, account: int, destination: int, tool: int,
    schema: int, args: int, precondition: int, ops: List[int] }
  type Intent = { id: int, rev: int, payload: Payload, tier: int, deduped: bool, source: int }
  type Approval = { id: int, child: int, rev: int, digest: Payload, batch: int }
  type Authorization = { id: int, intent: Intent, approval: int, consumed: bool, epoch: int, grant: bool }
  type Attempt = { id: int, auth: int, child: int, payload: Payload, key: int }
  type Receipt = { attempt: int, child: int, payload: Payload }
  // `pauses` is how many Pauses had happened when it was minted: Pause revokes
  // every grant, and Resume restores none (SPEC 13.9).
  type Grant = { target: int, opClass: int, source: int, rev: int, pauses: int }
  type Occurrence = { schedule: int, rev: int, due: int }
  // One spend reservation (WP9 `spend_reservations`). `actual` counts once
  // settled. `charged` is a ghost: what the provider really billed.
  type Spend = { id: int, day: int, compact: bool, amount: int, state: str, actual: int, charged: int }
  type Raise = { click: int, day: int }
  type State = {
    batchId: int, batchOrder: List[Intent], expanded: List[Intent],
    intents: Set[Intent], current: int -> int, approvals: Set[Approval], auths: Set[Authorization],
    attempts: List[Attempt], accepted: Set[int], effects: int -> int, keys: Set[int], receipts: Set[Receipt],
    unknown: Set[int], failed: Set[int], explained: Set[int], cancelled: Set[int], cancelRequested: bool,
    nextAuth: int, nextApproval: int, schema: int, account: int, connection: int, precondition: int,
    invalid: bool, expired: bool, gen: int, epoch: int, localEpoch: int, active: bool,
    paused: bool, off: bool, pauses: int, crashed: bool, resumed: bool,
    ownerRun: bool, clean: bool, sourceInRun: bool, grants: Set[Grant],
    schedule: bool, scheduleRev: int, scheduleAuthority: str, scheduleProposal: int, scheduleApproved: int, wake: Occurrence,
    queued: bool, admissions: List[Occurrence], starts: List[Occurrence],
    quiet: bool, deliverNow: bool, notifications: int,
    spends: Set[Spend], nextSpend: int, day: int, caps: int -> int, raiseLog: List[Raise], overCapAdmissions: int,
    sealed: bool, label: str, target: int
  }
  var s: State
  var before: State
  var pc: int
  var remaining: int
  var scenario: int
  pure def listSet(xs) = xs.foldl(Set(), (acc, x) => acc.union(Set(x)))
  pure def isEmpty(xs) = xs == Set()
  pure val ids = 0.to(children - 1)
  pure def payload(k: int): Payload = { connection: 1, account: 1, destination: k,
    tool: 1, schema: 1, args: 1, precondition: 1, ops: List(k) }
  pure val initial: State = {
    batchId: 0, batchOrder: List(), expanded: List(),
    intents: Set(), current: ids.mapBy(_ => 0), approvals: Set(), auths: Set(), attempts: List(),
    accepted: Set(), effects: ids.mapBy(_ => 0), keys: Set(), receipts: Set(), unknown: Set(),
    failed: Set(), explained: Set(), cancelled: Set(), cancelRequested: false,
    nextAuth: 1, nextApproval: 1, schema: 1, account: 1, connection: 1, precondition: 1,
    invalid: false, expired: false, gen: 0, epoch: 1, localEpoch: 1, active: true,
    paused: false, off: false, pauses: 0, crashed: false, resumed: false,
    ownerRun: true, clean: true, sourceInRun: true, grants: Set(),
    schedule: false, scheduleRev: 1, scheduleAuthority: "none", scheduleProposal: 0, scheduleApproved: 0,
    wake: { schedule: 1, rev: 1, due: 1 }, queued: false, admissions: List(), starts: List(),
    quiet: false, deliverNow: false, notifications: 0,
    spends: Set(), nextSpend: 1, day: 0, caps: days.mapBy(_ => 8), raiseLog: List(), overCapAdmissions: 0, sealed: false, label: "init", target: 0
  }
  pure val days = 0.to(2)
  // A dollar is 4 units; the default cap is $2.
  pure val dollar = 4
  action init = all { s' = initial, before' = initial, pc' = 0, remaining' = drainLimit, scenario' = 0 }
  def currentIntent(k: int): Set[Intent] = s.intents.filter(i => i.id == k and i.rev == s.current.get(k))
  def done(k: int): bool = s.receipts.exists(r => r.child == k)
  def evidenced(a: int): bool = s.receipts.exists(r => s.attempts.listSet().exists(t => t.id == r.attempt and t.auth == a))
  def sent(a: int): bool = s.attempts.listSet().exists(t => t.auth == a)
  def valid(i: Intent): bool = i.rev == s.current.get(i.id) and not(s.invalid) and not(s.expired) and
    i.source == s.gen and i.payload.schema == s.schema and i.payload.account == s.account and
    i.payload.connection == s.connection and i.payload.precondition == s.precondition
  val mayAuthorize = s.active and s.epoch == s.localEpoch and not(s.paused or s.off or s.crashed)
  def liveGrant(k: int): bool = s.grants.exists(g => g.target == k and g.opClass == 2 and g.source == s.gen)
  action idle = s' = { ...s, label: "blocked" }
  action propose(k: int, tier: int, deduped: bool): bool = {
    val rev = s.current.get(k) + 1
    val p = { ...payload(k), args: rev, schema: s.schema, account: s.account,
      connection: s.connection, precondition: s.precondition }
    s' = { ...s, intents: s.intents.union(Set({ id: k, rev: rev, payload: p, tier: tier, deduped: deduped, source: s.gen })),
      current: s.current.set(k, rev), label: "propose", target: k }
  }
  // A click identifies one immutable child. A batch click is the ordered
  // expansion into these child clicks, never a reusable batch transport token.
  // A card runs once and has no retry button, so a click on a child that was
  // already authorized is never honoured unless its destination deduplicates
  // (`noRepeatAuthorization`). The owner asks Juno for a new card instead.
  action click(k: int): bool = {
    nondet i = currentIntent(k).oneOf()
    s' = { ...s, approvals: s.approvals.union(Set({ id: s.nextApproval, child: k,
      rev: i.rev, digest: i.payload, batch: 0 })), nextApproval: s.nextApproval + 1,
      label: "click", target: k }
  }
  action clickBatch = {
    nondet first = currentIntent(0).oneOf()
    nondet second = currentIntent(1).oneOf()
    if (s.batchId != 0) idle else s' = { ...s, batchId: s.nextApproval, batchOrder: List(first, second),
      approvals: s.approvals.union(Set(
        { id: s.nextApproval, child: 0, rev: first.rev, digest: first.payload, batch: s.nextApproval },
        { id: s.nextApproval + 1, child: 1, rev: second.rev, digest: second.payload, batch: s.nextApproval })),
      nextApproval: s.nextApproval + 2, label: "clickBatch" }
  }
  action expandBatch = s' = { ...s, expanded: s.batchOrder, label: "expandBatch" }
  action reorderBatch = s' = { ...s, expanded: s.expanded.foldl(List(), (xs, x) => List(x).concat(xs)), label: "reorderBatch" }
  action authorizeWith(k: int, bug: str): bool = {
    nondet i = currentIntent(k).oneOf()
    val used = s.auths.map(a => a.approval)
    val approvals = s.approvals.filter(a => a.child == k and
      (a.batch == 0 or bug == "batchOrder" or s.expanded == s.batchOrder) and
      (bug == "edit" or (a.rev == i.rev and a.digest == i.payload)) and
      (bug == "reuse" or not(used.contains(a.id))) and
      (bug == "retry" or not(s.auths.exists(a => a.intent.id == k)) or i.deduped))
    val grant = i.tier == 2 and s.ownerRun and s.clean and liveGrant(k)
    val allowed = (mayAuthorize or bug == "owner" or bug == "pause") and
      (valid(i) or bug == "current") and
      (not(i.deduped) or s.auths.forall(a => a.intent.id != k or a.intent.payload == i.payload)) and (i.tier < 4 or bug == "tier4") and
      (not(done(k)) or bug == "batch") and
      (approvals != Set() or grant or bug == "grant" or bug == "tier4" or bug == "batch")
    if (allowed) {
      nondet approval = (if (approvals == Set()) Set(0) else approvals.map(a => a.id)).oneOf()
      s' = { ...s, auths: s.auths.union(Set({ id: s.nextAuth, intent: i, approval: approval,
        consumed: bug != "consume", epoch: s.localEpoch, grant: approval == 0 })),
        nextAuth: s.nextAuth + 1, label: "authorize", target: k }
    } else idle
  }
  action authorizeDispatch(k: int): bool = authorizeWith(k, "")
  action sendWith(k: int, bug: str): bool = {
    val available = s.auths.filter(a => a.intent.id == k and (not(sent(a.id)) or bug == "hidden") and
      not(s.unknown.contains(a.id)) and not(s.cancelled.contains(a.id)))
    if (available == Set()) idle else {
      nondet a = available.oneOf()
      val p = if (bug == "payload") { ...a.intent.payload, args: 99 } else a.intent.payload
      val key = if (bug == "key") s.attempts.length() + 10 else k
      s' = { ...s, attempts: s.attempts.append({ id: s.attempts.length() + 1,
        auth: a.id, child: k, payload: p, key: key }), label: "send", target: k }
    }
  }
  action transportSend(k: int): bool = sendWith(k, "")
  action acceptWith(k: int, guard: bool): bool = {
    val pending = s.attempts.select(t => t.child == k and not(s.accepted.contains(t.id)) and not(s.failed.contains(t.auth)))
    if (pending.length() == 0) idle else {
      val t = pending.head()
      nondet a = s.auths.filter(a => a.id == t.auth).oneOf()
      val already = a.intent.deduped and s.keys.contains(t.key)
      s' = { ...s, accepted: s.accepted.union(Set(t.id)), keys: s.keys.union(Set(t.key)),
        effects: s.effects.set(k, s.effects.get(k) + (if (guard and already) 0 else 1)), label: "accept", target: k }
    }
  }
  action destinationAccept(k: int): bool = acceptWith(k, true)
  action receiptWith(k: int, exact: bool): bool = {
    val ts = s.attempts.select(t => t.child == k and s.accepted.contains(t.id) and not(s.receipts.exists(r => r.attempt == t.id)))
    if (ts.length() == 0) idle else {
      val t = ts.head()
      s' = { ...s, receipts: s.receipts.union(Set({ attempt: t.id, child: k,
        payload: if (exact) t.payload else { ...t.payload, destination: 99 } })),
        unknown: s.unknown.exclude(Set(t.auth)), label: "receipt", target: k }
    }
  }
  action recordReceipt(k: int): bool = receiptWith(k, true)
  action reject(k: int): bool = {
    val ts = s.attempts.select(t => t.child == k and not(s.accepted.contains(t.id)))
    if (ts.length() == 0) idle else {
      val t = ts.head()
      s' = { ...s, failed: s.failed.union(Set(t.auth)), unknown: s.unknown.exclude(Set(t.auth)), label: "reject", target: k }
    }
  }
  action lose(k: int): bool = s' = { ...s,
    unknown: s.unknown.union(s.auths.filter(a => a.intent.id == k and not(evidenced(a.id)) and not(s.failed.contains(a.id))).map(a => a.id)),
    label: "lose", target: k }
  action reconcile(k: int, positive: bool, guard: bool): bool =
    if (positive) recordReceipt(k) else s' = { ...s,
      failed: if (guard) s.failed else s.failed.union(s.unknown),
      unknown: if (guard) s.unknown else Set(), explained: s.explained.union(s.unknown), label: "negative", target: k }
  action crash = s' = { ...s, crashed: true, resumed: false, label: "crash" }
  action startup(guard: bool): bool = s' = { ...s, crashed: false, resumed: true,
    unknown: if (guard) s.unknown.union(s.auths.filter(a => not(evidenced(a.id)) and not(s.cancelled.contains(a.id)) and not(s.failed.contains(a.id))).map(a => a.id)) else s.unknown,
    label: "startup" }
  action startupByChild = s' = { ...s, crashed: false, resumed: true,
    unknown: s.unknown.union(s.auths.filter(a => not(done(a.intent.id)) and
      not(s.cancelled.contains(a.id)) and not(s.failed.contains(a.id))).map(a => a.id)), label: "startup" }
  // `keepGrants` is the bug that leaves what the conversation allowed in place.
  action pauseWith(kind: str, keepGrants: bool): bool = s' = { ...s, paused: kind == "pause" or s.paused,
    off: kind == "off" or s.off, pauses: s.pauses + 1,
    grants: if (keepGrants) s.grants else Set(), schedule: if (keepGrants) s.schedule else false, cancelRequested: true, label: "pause" }
  action pause(kind: str): bool = pauseWith(kind, false)
  // Resume, or AI assist back on. Clicks that waited through the pause may
  // now be authorized, each once; no grant comes back.
  action resume = if (not(s.paused or s.off)) idle else s' = { ...s, paused: false, off: false, label: "resume" }
  action cancel(guard: bool): bool = s' = { ...s,
    cancelled: s.cancelled.union(s.auths.filter(a => not(sent(a.id))).map(a => a.id)),
    unknown: s.unknown.union(s.auths.filter(a => sent(a.id) and not(evidenced(a.id))).map(a => a.id)),
    receipts: if (guard) s.receipts else Set(), cancelRequested: false, label: "cancel" }
  action taint(owner: bool): bool = s' = { ...s, clean: false, ownerRun: owner, label: "taint" }
  action grantWith(k: int, guard: bool): bool =
    if (guard and not(s.ownerRun and s.clean and s.sourceInRun and mayAuthorize)) idle else
    s' = { ...s, grants: s.grants.union(Set({ target: k, opClass: 2, source: s.gen, rev: 1, pauses: s.pauses })), label: "grant", target: k }
  action grantClick(k: int): bool =
    if (not(currentIntent(k).exists(i => valid(i) and s.approvals.exists(p =>
      p.child == k and p.rev == i.rev and p.digest == i.payload)))) idle else
    s' = { ...s, grants: s.grants.union(Set({ target: k, opClass: 2, source: s.gen, rev: 1, pauses: s.pauses })), label: "grantClick", target: k }
  action scheduleWith(guard: bool): bool =
    if (guard and not(s.ownerRun and s.clean and s.sourceInRun and mayAuthorize)) idle else
    s' = { ...s, schedule: true, scheduleAuthority: if (s.ownerRun and s.clean and s.sourceInRun) "clean" else "none",
      grants: s.grants.union(Set({ target: 1, opClass: 1, source: s.gen, rev: s.scheduleRev, pauses: s.pauses })), label: "schedule" }
  action proposeSchedule =
    if (not(s.ownerRun)) idle else s' = { ...s, scheduleProposal: s.scheduleProposal + 1, label: "proposeSchedule" }
  action clickSchedule =
    if (s.scheduleProposal == 0) idle else s' = { ...s, scheduleApproved: s.scheduleProposal, label: "clickSchedule" }
  action scheduleFromClick(guard: bool): bool =
    if (guard and not(s.scheduleProposal > 0 and s.scheduleApproved == s.scheduleProposal and mayAuthorize)) idle else
    s' = { ...s, schedule: true, scheduleAuthority: "click", scheduleApproved: 0,
      grants: s.grants.union(Set({ target: 1, opClass: 1, source: s.gen, rev: s.scheduleRev, pauses: s.pauses })), label: "scheduleClick" }
  // "Tell me if nobody replies" in a message's menu (SPEC 13.6). The owner's
  // click enters through the inbox and creates the watch with no run, so what
  // the chat has read does not matter. The item is disabled while Juno is
  // paused, off or owned by another Mac, so no watch is created then.
  action scheduleFromMenu(guard: bool): bool =
    if (guard and not(mayAuthorize)) idle else
    s' = { ...s, schedule: true, scheduleAuthority: "menu",
      grants: s.grants.union(Set({ target: 1, opClass: 1, source: s.gen, rev: s.scheduleRev, pauses: s.pauses })), label: "scheduleMenu" }
  val scheduleValid = s.schedule and s.grants.exists(g => g.target == 1 and g.opClass == 1 and
    g.rev == s.scheduleRev and g.source == s.gen)
  action queueWake = s' = { ...s, queued: true, wake: { schedule: 1, rev: s.scheduleRev, due: 1 }, label: "queue" }
  action deleteSchedule = s' = { ...s, schedule: false, scheduleRev: s.scheduleRev + 1,
    grants: s.grants.filter(g => g.opClass != 1), label: "delete" }
  action admitWake(bug: str): bool =
    if (s.queued and (bug == "cancel" or (scheduleValid and s.wake.rev == s.scheduleRev)) and
      (bug == "occurrence" or not(s.admissions.listSet().contains(s.wake))))
    s' = { ...s, admissions: s.admissions.append(s.wake), label: "admit" } else idle
  action startWake(guard: bool): bool =
    if (s.admissions.listSet().contains(s.wake) and not(s.starts.listSet().contains(s.wake)) and
      (not(guard) or (scheduleValid and s.wake.rev == s.scheduleRev)))
    s' = { ...s, starts: s.starts.append(s.wake), ownerRun: false, clean: false, label: "wake" } else idle
  action notify(guard: bool): bool =
    if (s.off or (guard and s.quiet and not(s.deliverNow))) idle else
    s' = { ...s, notifications: s.notifications + 1, label: "notify" }
  // The spend ledger (packages/agent/src/spend). All model paths share one
  // reservation transaction, per local day. Open and unknown reservations
  // count their full amount; a settled one counts its true cost, compaction
  // included, even when that is more than it reserved. Unknown usage keeps
  // its reservation on its day for good. Once the day is at or over its cap,
  // every new reservation is refused until the next day or a raise. A second
  // sub-budget never expands the owner's total cap.
  def sumOn(d: int, f: Spend => int): int = s.spends.filter(r => r.day == d).fold(0, (acc, r) => acc + f(r))
  def reservedOn(d: int): int = sumOn(d, r => if (r.state != "settled") r.amount else 0)
  def actualOn(d: int): int = sumOn(d, r => if (r.state == "settled") r.actual else 0)
  // `compactionReleased` is the bug that forgets a settled compaction's actual cost.
  def compactionOn(d: int, bug: str): int = sumOn(d, r =>
    if (not(r.compact)) 0 else if (r.state != "settled") r.amount else if (bug == "compactionReleased") 0 else r.actual)
  // The limit the ledger sees: each recorded raise adds a dollar.
  def limitOn(d: int): int = s.caps.get(d) + dollar * s.raiseLog.select(x => x.day == d).length()
  // The limit the owner granted: one dollar per distinct click.
  def grantedOn(d: int): int = s.caps.get(d) + dollar * s.raiseLog.select(x => x.day == d).foldl(Set(), (acc, x) => acc.union(Set(x.click))).size()
  def totalOn(d: int): int = reservedOn(d) + actualOn(d)
  // What settled reservations reported beyond what they reserved.
  def overReportOn(d: int, compactOnly: bool): int = sumOn(d, r =>
    if (r.state == "settled" and r.actual > r.amount and (r.compact or not(compactOnly))) r.actual - r.amount else 0)
  // `zeroAtCap` is the rule before the change: only the sum is checked, so a
  // zero-cost reservation is admitted on a day exactly at its cap.
  def fits(compact: bool, amount: int, bug: str): bool =
    (bug == "zeroAtCap" or totalOn(s.day) < limitOn(s.day)) and
    totalOn(s.day) + amount <= limitOn(s.day) and
    (not(compact) or compactionOn(s.day, bug) + amount <= limitOn(s.day) / 4)
  action reserve(compact: bool, amount: int, guard: bool, bug: str): bool =
    if (guard and not(fits(compact, amount, bug))) s' = { ...s, label: "budgetBlocked" } else
    s' = { ...s, spends: s.spends.union(Set({ id: s.nextSpend, day: s.day, compact: compact, amount: amount, state: "reserved", actual: 0, charged: 0 })),
      nextSpend: s.nextSpend + 1, overCapAdmissions: s.overCapAdmissions + (if (totalOn(s.day) >= grantedOn(s.day)) 1 else 0),
      label: "reserve" }
  // Settles the oldest open reservation on its own day. `outcome` is what the
  // guard saw: "done" (reported cost `cost`), "refused" (refused before any
  // output: a known zero) or "lost" (anything else: unknown, kept in full).
  val oldestOpen: Set[Spend] = s.spends.filter(r => r.state == "reserved" and
    s.spends.forall(o => o.state != "reserved" or o.id >= r.id))
  action settle(outcome: str, cost: int, charge: int, bug: str): bool =
    if (oldestOpen == Set()) idle else {
      nondet r = oldestOpen.oneOf()
      val known = outcome != "lost" or bug == "spend"
      val settled = { ...r, state: if (known) "settled" else "unknown", actual: if (outcome == "done") cost else 0,
        // Unknown usage is never reported, so the ledger can only assume the
        // provider billed at most the reservation.
        charged: if (outcome == "lost" and charge > r.amount) r.amount else charge,
        day: if (bug == "settleToday") s.day else r.day }
      s' = { ...s, spends: s.spends.exclude(Set(r)).union(Set(settled)), label: "spend" }
    }
  // "Allow $1 more today": a trusted click, keyed by its operation id.
  action allowDollar(click: int, guard: bool): bool =
    if (guard and s.raiseLog.select(x => x.click == click).length() > 0) s' = { ...s, label: "raise" } else
    s' = { ...s, raiseLog: s.raiseLog.append({ click: click, day: s.day }), label: "raise" }
  // The local date changes. The new day starts at the default cap.
  action newDay = if (s.day >= 2) idle else s' = { ...s, day: s.day + 1, label: "newDay" }
  // Settings may lower today's cap only as far as today's obligations.
  action setCap(amount: int): bool = {
    val limit = amount + limitOn(s.day) - s.caps.get(s.day)
    if (reservedOn(s.day) + actualOn(s.day) > limit or compactionOn(s.day, "") > limit / 4) idle else
    s' = { ...s, caps: s.caps.set(s.day, amount), label: "setCap" }
  }
  action invalidate(kind: str): bool = s' = { ...s,
    schema: s.schema + (if (kind == "schema") 1 else 0), account: s.account + (if (kind == "account") 1 else 0),
    connection: s.connection + (if (kind == "connection") 1 else 0),
    precondition: s.precondition + (if (kind == "precondition") 1 else 0),
    sourceInRun: s.sourceInRun and kind != "redact", invalid: s.invalid or kind == "redact", expired: s.expired or kind == "expire",
    gen: s.gen + (if (kind == "redact") 1 else 0), grants: if (kind == "redact") Set() else s.grants,
    scheduleProposal: if (kind == "redact") 0 else s.scheduleProposal,
    scheduleApproved: if (kind == "redact") 0 else s.scheduleApproved,
    schedule: if (kind == "redact") false else s.schedule, label: "invalidate" }

  val newAuths = s.auths.exclude(before.auths)
  val intentBeforeDispatch = newAuths.forall(a => before.intents.contains(a.intent)) and before.intents.subseteq(s.intents)
  val approvalExact = newAuths.forall(a => a.grant or before.approvals.exists(p =>
    p.id == a.approval and p.child == a.intent.id and p.rev == a.intent.rev and p.digest == a.intent.payload and
    (p.batch == 0 or (p.batch == before.batchId and before.expanded == before.batchOrder and before.batchOrder.listSet().contains(a.intent)))))
  val approvalCurrentAtAuthorization = newAuths.forall(a => a.intent.rev == before.current.get(a.intent.id) and
    not(before.invalid or before.expired) and a.intent.source == before.gen and
    a.intent.payload.schema == before.schema and a.intent.payload.account == before.account and
    a.intent.payload.connection == before.connection and a.intent.payload.precondition == before.precondition)
  val approvalConsumption = s.auths.forall(a => a.consumed) and s.auths.forall(a => a.approval == 0 or
    s.auths.filter(b => b.approval == a.approval).size() <= 1) and before.auths.subseteq(s.auths)
  val noHiddenRetry = s.auths.forall(a => s.attempts.select(t => t.auth == a.id).length() <= 1)
  // A child whose destination does not deduplicate is authorized at most once,
  // whatever happened to the first attempt: rejected, cancelled or unknown.
  val noRepeatAuthorization = newAuths.forall(a => a.intent.deduped or
    not(before.auths.exists(b => b.intent.id == a.intent.id)))
  val unknownPreserved = (s.label == "negative" implies before.unknown.subseteq(s.unknown)) and
    (s.label == "startup" implies s.auths.forall(a => evidenced(a.id) or s.failed.contains(a.id) or s.cancelled.contains(a.id) or s.unknown.contains(a.id)))
  val dedupeIdentityStable = s.attempts.listSet().forall(t => s.auths.exists(a => a.id == t.auth and
    t.payload == a.intent.payload and (not(a.intent.deduped) or (t.key == a.intent.id and
      s.attempts.listSet().forall(u => u.child != t.child or u.payload == t.payload)))))
  val dedupedEffectOnce = ids.forall(k => s.intents.exists(i => i.id == k and i.deduped) implies s.effects.get(k) <= 1)
  val receiptMatchesAction = s.receipts.forall(r => s.attempts.listSet().exists(t => t.id == r.attempt and
    t.child == r.child and t.payload == r.payload and s.accepted.contains(t.id)))
  val scopedNoClickGrant = newAuths.forall(a => not(a.grant) or
    (a.intent.tier == 2 and before.grants.exists(g => g.target == a.intent.id and g.opClass == 2 and g.source == before.gen)))
  val untrustedCannotGrant = s.grants.exclude(before.grants).isEmpty() or
    (before.ownerRun and before.clean and before.sourceInRun) or
    (s.label == "grantClick" and before.approvals.exists(p => p.child == s.target and
      before.intents.exists(i => i.id == p.child and i.rev == p.rev and i.payload == p.digest))) or
    (s.label == "scheduleClick" and before.scheduleProposal > 0 and before.scheduleApproved == before.scheduleProposal) or
    (s.label == "scheduleMenu" and beforeMayAuthorize)
  val tier4NeverDispatched = s.auths.forall(a => a.intent.tier < 4)
  val allWritesGated = s.attempts.listSet().forall(t => s.auths.exists(a => a.id == t.auth and a.consumed and a.intent.payload == t.payload))
  // This is the local ownership authority only. WP4 deliberately disproves
  // the stronger cross-device interpretation without an external fence.
  val currentOwnerAuthorizes = newAuths.forall(a => before.active and a.epoch == before.epoch)
  val pauseBlocksAuthorization = newAuths.isEmpty() or not(before.paused or before.off)
  // Every live grant was minted since the last Pause (SPEC 13.9: after Resume,
  // steering a job needs a card again).
  val pauseRevokesGrants = s.grants.forall(g => g.pauses == s.pauses)
  val quietHoursHoldNotifications = s.notifications == before.notifications or (not(before.off) and (not(before.quiet) or before.deliverNow))
  val scheduleGrantValid = not(s.schedule) or scheduleValid
  val occurrenceAdmissionOnce = s.admissions.listSet().forall(w => s.admissions.select(v => v == w).length() == 1)
  val cancelWinsBeforeAdmission = (s.label == "admit" or s.label == "wake") implies
    (before.schedule and before.wake.rev == before.scheduleRev and before.grants.exists(g =>
      g.opClass == 1 and g.rev == before.scheduleRev and g.source == before.gen))
  val batchEffectsIndependent = newAuths.forall(a => not(before.receipts.exists(r => r.child == a.intent.id)))
  val outcomeEvidenceStable = before.receipts.subseteq(s.receipts) and before.auths.subseteq(s.auths)
  val beforeMayAuthorize = before.active and before.epoch == before.localEpoch and not(before.paused or before.off or before.crashed)
  val scheduleFromOwnerAuthority = not(s.schedule) or s.scheduleAuthority == "clean" or
    (s.scheduleAuthority == "click" and (s.label != "scheduleClick" or
      (before.scheduleProposal > 0 and before.scheduleApproved == before.scheduleProposal))) or
    (s.scheduleAuthority == "menu" and (s.label != "scheduleMenu" or beforeMayAuthorize))
  val cleanRunForNoClick = newAuths.forall(a => not(a.grant) or (before.ownerRun and before.clean))
  // Per day: what the ledger holds stays within the cap and the owner's raises,
  // compaction within a quarter of it, and no reservation records less than
  // the provider charged.
  // The ledger records at least what the provider charged. No reservation is
  // admitted while the day is at or over its cap. The day, and its compaction
  // share, exceed the owner's limit by at most what settled requests reported
  // beyond their reservations: requests already in flight when it filled.
  val noAdmissionOverCap = s.overCapAdmissions == 0
  val capHard = noAdmissionOverCap and
    s.spends.forall(r => r.charged <= (if (r.state == "settled") r.actual else r.amount)) and
    days.forall(d => totalOn(d) <= grantedOn(d) + overReportOn(d, false) and
      compactionOn(d, "") <= grantedOn(d) / 4 + overReportOn(d, true))
  // The rule before the over-report decision: the cap is never passed. It does
  // not hold once a request reports more than it reserved (`overReportStep`).
  val strictCap = days.forall(d => totalOn(d) <= grantedOn(d))
  val oneRaisePerClick = s.raiseLog.indices().forall(i => s.raiseLog.indices().forall(j =>
    i == j or s.raiseLog.nth(i).click != s.raiseLog.nth(j).click))
  val safety = intentBeforeDispatch and approvalExact and approvalCurrentAtAuthorization and approvalConsumption and
    noHiddenRetry and noRepeatAuthorization and unknownPreserved and dedupeIdentityStable and dedupedEffectOnce and
    receiptMatchesAction and scopedNoClickGrant and untrustedCannotGrant and tier4NeverDispatched and allWritesGated and
    currentOwnerAuthorizes and pauseBlocksAuthorization and quietHoursHoldNotifications and scheduleGrantValid and
    occurrenceAdmissionOnce and cancelWinsBeforeAdmission and batchEffectsIndependent and outcomeEvidenceStable and
    scheduleFromOwnerAuthority and cleanRunForNoClick and capHard and oneRaisePerClick and pauseRevokesGrants

  val pendingApproved = ids.filter(k => not(done(k)) and currentIntent(k).exists(i => valid(i) and
    s.approvals.exists(p => p.child == k and p.rev == i.rev and p.digest == i.payload and
      (p.batch == 0 or s.expanded == s.batchOrder) and not(s.auths.exists(a => a.approval == p.id)) and (not(s.auths.exists(a => a.intent.id == k)) or i.deduped))))
  val unsettled = s.auths.filter(a => not(evidenced(a.id)) and not(s.unknown.contains(a.id)) and not(s.cancelled.contains(a.id)) and not(s.failed.contains(a.id)))
  val wakeDue = s.queued and scheduleValid and s.wake.rev == s.scheduleRev and not(s.admissions.listSet().contains(s.wake))
  val settled = not(s.crashed) and unsettled.isEmpty() and s.unknown.subseteq(s.explained) and
    (not(mayAuthorize) or pendingApproved.isEmpty()) and not(wakeDue) and not(s.cancelRequested)
  val reachedAgreement = s.sealed and s.label == "finished" and settled
  val drainBound = remaining > 0 or reachedAgreement
  val invariants = safety and drainBound
  action seal = s' = { ...s, sealed: true, label: "seal" }
  action progress =
    if (s.crashed) startup(true) else
    if (s.cancelRequested) cancel(true) else
    if (not(s.unknown.subseteq(s.explained))) {
      nondet a = s.auths.filter(a => s.unknown.contains(a.id) and not(s.explained.contains(a.id))).oneOf()
      reconcile(a.intent.id, false, true)
    } else if (wakeDue) admitWake("") else
    if (mayAuthorize and not(pendingApproved.isEmpty())) { nondet k = pendingApproved.oneOf(); authorizeDispatch(k) } else
    if (not(unsettled.isEmpty())) {
      nondet a = unsettled.oneOf()
      if (not(sent(a.id))) transportSend(a.intent.id) else
      if (s.attempts.listSet().exists(t => t.auth == a.id and not(s.accepted.contains(t.id)))) destinationAccept(a.intent.id)
      else recordReceipt(a.intent.id)
    } else s' = { ...s, label: "finished" }
  action tick(a: bool): bool = all { a, before' = s, pc' = pc + 1, scenario' = scenario,
    remaining' = if (s.sealed and not(reachedAgreement)) remaining - 1 else remaining }
  action input = {
    nondet k = ids.oneOf()
    any { all { s.current.get(k) == 0, propose(k, 3, false) },
      all { currentIntent(k) != Set(), s.nextApproval < 5, click(k) },
      authorizeDispatch(k), transportSend(k), destinationAccept(k), recordReceipt(k), lose(k), reject(k), reconcile(k, true, true),
      crash, startup(true), pause("pause"), resume, cancel(true), taint(true), grantWith(k, true),
      proposeSchedule, clickSchedule, scheduleFromClick(true), scheduleWith(true), scheduleFromMenu(true), queueWake, deleteSchedule, admitWake(""), startWake(true),
      invalidate("redact"), invalidate("schema"), seal,
      all { s.nextSpend < 8, reserve(false, 2, true, "") }, all { s.nextSpend < 8, reserve(true, 2, true, "") },
      all { s.nextSpend < 8, reserve(false, 0, true, "") },
      { nondet cost = 0.to(3).oneOf(); settle("done", cost, cost, "") }, settle("refused", 0, 0, ""),
      { nondet charge = 0.to(2).oneOf(); settle("lost", 0, charge, "") },
      { nondet click = 1.to(2).oneOf(); allowDollar(click, true) }, newDay, setCap(4) }
  }
  action simulationStep = all { not(reachedAgreement), tick(if (s.sealed) progress else input) }
  temporal unknownEventuallyExplained = progress.weakFair(s).implies(eventually(always(s.sealed)).implies(eventually(always(s.unknown.subseteq(s.explained)))))
  temporal approvedEventuallyAttempted = progress.weakFair(s).implies(eventually(always(s.sealed)).implies(eventually(always(not(mayAuthorize) or (pendingApproved.isEmpty() and unsettled.isEmpty())))))
  temporal missedWakeEventuallyAdmitted = progress.weakFair(s).implies(eventually(always(s.sealed)).implies(eventually(always(not(wakeDue)))))
  temporal pauseEventuallyQuiescent = progress.weakFair(s).implies(eventually(always(s.sealed and s.paused)).implies(eventually(always(unsettled.isEmpty() and not(s.cancelRequested)))))

  type Command = { op: str, k: int }
  pure def c(op: str, k: int): Command = { op: op, k: k }
  action execute(cmd: Command, bug: str): bool = {
    val k = cmd.k
    val op = cmd.op
    if (op == "propose") propose(k, 3, false) else
    if (op == "deduped") propose(k, 3, true) else
    if (op == "tier2") propose(k, 2, false) else
    if (op == "tier4") propose(k, 4, false) else
    if (op == "clickBatch") clickBatch else
    if (op == "expandBatch") expandBatch else
    if (op == "reorderBatch") reorderBatch else
    if (op == "click") click(k) else
    if (op == "authorize") authorizeWith(k, bug) else
    if (op == "send") sendWith(k, bug) else
    if (op == "accept") acceptWith(k, bug != "dedupe") else
    if (op == "receipt") receiptWith(k, bug != "receipt") else
    if (op == "lose") lose(k) else
    if (op == "negative") reconcile(k, false, bug != "negative") else
    if (op == "crash") crash else
    if (op == "startup") { if (bug == "childEvidence") startupByChild else startup(bug != "startup") } else
    if (op == "pause" or op == "off") pauseWith(op, bug == "keepGrants") else
    if (op == "resume") resume else
    if (op == "cancel") cancel(bug != "evidence") else
    if (op == "report") taint(true) else
    if (op == "wakeRun") taint(false) else
    if (op == "grantClick") grantClick(k) else
    if (op == "grant") grantWith(k, bug != "untrusted") else
    if (op == "proposeSchedule") proposeSchedule else
    if (op == "clickSchedule") clickSchedule else
    if (op == "scheduleClick") scheduleFromClick(bug != "scheduleClick") else
    if (op == "schedule") scheduleWith(bug != "schedule") else
    if (op == "scheduleMenu") scheduleFromMenu(bug != "scheduleMenu") else
    if (op == "queue") queueWake else
    if (op == "delete") deleteSchedule else
    if (op == "admit") admitWake(bug) else
    if (op == "startWake") startWake(bug != "startWake") else
    if (op == "quiet") s' = { ...s, quiet: true, label: "quiet" } else
    if (op == "notify") notify(bug != "notify") else
    if (op == "reserve") reserve(k == 1, 2, bug != "cap", bug) else
    if (op == "reserveFree") reserve(false, 0, bug != "cap", bug) else
    if (op == "spend") settle("lost", 0, 1, bug) else
    // A stream that failed after output is lost; `lostAsRefused` settles it as a refusal.
    if (op == "failAfterOutput") settle(if (bug == "lostAsRefused") "refused" else "lost", 0, 1, bug) else
    if (op == "refused") settle("refused", 0, 0, bug) else
    if (op == "settle") settle("done", k, k, bug) else
    if (op == "overReport") settle("done", 3, 3, bug) else
    if (op == "raise") allowDollar(k, bug != "raiseTwice") else
    if (op == "newDay") newDay else
    if (op == "owner") s' = { ...s, active: false, epoch: 2, label: "owner" } else
    invalidate(op)
  }
  action script(commands: List[Command], bug: str): bool = all { not(reachedAgreement),
    tick(if (pc < commands.length()) execute(commands.nth(pc), bug) else if (not(s.sealed)) seal else
      if (bug == "drain") s' = { ...s, label: "idle" } else progress) }
  pure val negativeLookup = List(c("propose", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0), c("lose", 0), c("negative", 0))
  action negativeLookupStep = script(negativeLookup, "")
  action negativeLookupBugStep = script(negativeLookup, "negative")
  pure val unknownRetry = List(c("propose", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0), c("lose", 0), c("negative", 0), c("click", 0), c("authorize", 0))
  action unknownRetryStep = script(unknownRetry, "")
  action unknownRetryBugStep = script(unknownRetry, "retry")
  pure val hiddenRetry = List(c("propose", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0), c("send", 0))
  action hiddenRetryStep = script(hiddenRetry, "")
  action hiddenRetryBugStep = script(hiddenRetry, "hidden")
  pure val approvalEdit = List(c("propose", 0), c("click", 0), c("propose", 0), c("authorize", 0))
  action approvalEditStep = script(approvalEdit, "")
  action approvalEditBugStep = script(approvalEdit, "edit")
  pure val schemaRace = List(c("propose", 0), c("click", 0), c("schema", 0), c("authorize", 0))
  action schemaRaceStep = script(schemaRace, "")
  action schemaRaceBugStep = script(schemaRace, "current")
  pure val accountRace = List(c("propose", 0), c("click", 0), c("account", 0), c("authorize", 0))
  action accountRaceStep = script(accountRace, "")
  action accountRaceBugStep = script(accountRace, "current")
  pure val connectionRace = List(c("propose", 0), c("click", 0), c("connection", 0), c("authorize", 0))
  action connectionRaceStep = script(connectionRace, "")
  action connectionRaceBugStep = script(connectionRace, "current")
  pure val preconditionRace = List(c("propose", 0), c("click", 0), c("precondition", 0), c("authorize", 0))
  action preconditionRaceStep = script(preconditionRace, "")
  action preconditionRaceBugStep = script(preconditionRace, "current")
  pure val expireRace = List(c("propose", 0), c("click", 0), c("expire", 0), c("authorize", 0))
  action expireRaceStep = script(expireRace, "")
  action expireRaceBugStep = script(expireRace, "current")
  pure val redactRace = List(c("propose", 0), c("click", 0), c("redact", 0), c("authorize", 0))
  action redactRaceStep = script(redactRace, "")
  action redactRaceBugStep = script(redactRace, "current")
  pure val consumeBeforeSend = List(c("propose", 0), c("click", 0), c("authorize", 0), c("send", 0))
  action consumeBeforeSendStep = script(consumeBeforeSend, "")
  action consumeBeforeSendBugStep = script(consumeBeforeSend, "consume")
  // A second authorization needs a deduplicating destination; only then can a used approval be reused.
  pure val approvalReuse = List(c("deduped", 0), c("click", 0), c("authorize", 0), c("authorize", 0))
  action approvalReuseStep = script(approvalReuse, "")
  action approvalReuseBugStep = script(approvalReuse, "reuse")
  pure val startupAttempt = List(c("propose", 0), c("click", 0), c("authorize", 0), c("crash", 0), c("startup", 0))
  action startupAttemptStep = script(startupAttempt, "")
  action startupAttemptBugStep = script(startupAttempt, "startup")
  pure val payloadBinding = List(c("propose", 0), c("click", 0), c("authorize", 0), c("send", 0))
  action payloadBindingStep = script(payloadBinding, "")
  action payloadBindingBugStep = script(payloadBinding, "payload")
  pure val receiptBinding = List(c("propose", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0), c("receipt", 0))
  action receiptBindingStep = script(receiptBinding, "")
  action receiptBindingBugStep = script(receiptBinding, "receipt")
  pure val scopedGrant = List(c("tier2", 0), c("authorize", 0))
  action scopedGrantStep = script(scopedGrant, "")
  action scopedGrantBugStep = script(scopedGrant, "grant")
  pure val reportGrant = List(c("report", 0), c("grant", 0))
  action reportGrantStep = script(reportGrant, "")
  action reportGrantBugStep = script(reportGrant, "untrusted")
  pure val reportLaunch = List(c("tier2", 0), c("grant", 0), c("report", 0), c("authorize", 0))
  action reportLaunchStep = script(reportLaunch, "")
  action reportLaunchBugStep = script(reportLaunch, "grant")
  pure val reportSchedule = List(c("report", 0), c("schedule", 0))
  action reportScheduleStep = script(reportSchedule, "")
  action reportScheduleBugStep = script(reportSchedule, "schedule")
  pure val wakeSchedule = List(c("wakeRun", 0), c("schedule", 0))
  action wakeScheduleStep = script(wakeSchedule, "")
  action wakeScheduleBugStep = script(wakeSchedule, "schedule")
  pure val destructive = List(c("tier4", 0), c("authorize", 0))
  action destructiveStep = script(destructive, "")
  action destructiveBugStep = script(destructive, "tier4")
  pure val ownerRace = List(c("propose", 0), c("click", 0), c("owner", 0), c("authorize", 0))
  action ownerRaceStep = script(ownerRace, "")
  action ownerRaceBugStep = script(ownerRace, "owner")
  pure val pauseRace = List(c("propose", 0), c("click", 0), c("pause", 0), c("authorize", 0))
  action pauseRaceStep = script(pauseRace, "")
  action pauseRaceBugStep = script(pauseRace, "pause")
  pure val offRace = List(c("propose", 0), c("click", 0), c("off", 0), c("authorize", 0))
  action offRaceStep = script(offRace, "")
  action offRaceBugStep = script(offRace, "pause")
  pure val quietNotification = List(c("quiet", 0), c("notify", 0))
  action quietNotificationStep = script(quietNotification, "")
  action quietNotificationBugStep = script(quietNotification, "notify")
  pure val cancelWake = List(c("schedule", 0), c("queue", 0), c("delete", 0), c("admit", 0))
  action cancelWakeStep = script(cancelWake, "")
  action cancelWakeBugStep = script(cancelWake, "cancel")
  pure val cancelQueuedWake = List(c("schedule", 0), c("queue", 0), c("admit", 0), c("delete", 0), c("startWake", 0))
  action cancelQueuedWakeStep = script(cancelQueuedWake, "")
  action cancelQueuedWakeBugStep = script(cancelQueuedWake, "startWake")
  pure val duplicateWake = List(c("schedule", 0), c("queue", 0), c("admit", 0), c("crash", 0), c("startup", 0), c("admit", 0))
  action duplicateWakeStep = script(duplicateWake, "")
  action duplicateWakeBugStep = script(duplicateWake, "occurrence")
  pure val lateCancel = List(c("propose", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0), c("pause", 0), c("receipt", 0), c("cancel", 0))
  action lateCancelStep = script(lateCancel, "")
  action lateCancelBugStep = script(lateCancel, "evidence")
  pure val partialBatch = List(c("propose", 0), c("propose", 1), c("clickBatch", 0), c("expandBatch", 0),
    c("authorize", 0), c("send", 0), c("accept", 0), c("receipt", 0), c("crash", 0), c("startup", 0),
    c("authorize", 1), c("send", 1), c("accept", 1), c("receipt", 1), c("authorize", 0))
  action partialBatchStep = script(partialBatch, "")
  action partialBatchBugStep = script(partialBatch, "batch")
  pure val dedupeKey = List(c("deduped", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0), c("lose", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0))
  action dedupeKeyStep = script(dedupeKey, "")
  action dedupeKeyBugStep = script(dedupeKey, "key")
  pure val dedupeAccept = List(c("deduped", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0), c("lose", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0))
  action dedupeAcceptStep = script(dedupeAccept, "")
  action dedupeAcceptBugStep = script(dedupeAccept, "dedupe")
  pure val parallelBudget = List(c("reserve", 0), c("reserve", 0), c("reserve", 0), c("reserve", 0), c("reserve", 1))
  action parallelBudgetStep = script(parallelBudget, "")
  action parallelBudgetBugStep = script(parallelBudget, "cap")
  pure val unknownSpend = List(c("reserve", 0), c("spend", 0))
  action unknownSpendStep = script(unknownSpend, "")
  action unknownSpendBugStep = script(unknownSpend, "spend")
  pure val compactionBudget = List(c("reserve", 1), c("reserve", 1))
  action compactionBudgetStep = script(compactionBudget, "")
  action compactionBudgetBugStep = script(compactionBudget, "cap")
  // WP9: a settled compaction counts its actual cost, not its reservation.
  pure val compactionSettle = List(c("reserve", 1), c("settle", 1), c("reserve", 1))
  action compactionSettleStep = script(compactionSettle, "")
  action compactionSettleBugStep = script(compactionSettle, "compactionReleased")
  // WP9: a request refused before any output settles as a known zero and frees
  // its reservation. A failure after output may have been billed.
  pure val refusedSpend = List(c("reserve", 0), c("reserve", 0), c("reserve", 0), c("reserve", 0),
    c("refused", 0), c("failAfterOutput", 0), c("reserve", 0))
  action refusedSpendStep = script(refusedSpend, "")
  action refusedSpendBugStep = script(refusedSpend, "lostAsRefused")
  // WP9: a new day starts a new budget; yesterday's unknown stays on yesterday,
  // and a late settlement stays on its reservation's day.
  pure val dailyReset = List(c("reserve", 0), c("reserve", 0), c("reserve", 0), c("reserve", 0), c("spend", 0),
    c("newDay", 0), c("reserve", 0), c("reserve", 0), c("reserve", 0), c("reserve", 0), c("settle", 1))
  action dailyResetStep = script(dailyReset, "")
  action dailyResetBugStep = script(dailyReset, "settleToday")
  // WP9: "Allow $1 more today" counts once per click, however often it is delivered.
  pure val raiseClick = List(c("reserve", 0), c("reserve", 0), c("reserve", 0), c("reserve", 0),
    c("raise", 1), c("raise", 1), c("reserve", 0), c("reserve", 0), c("reserve", 0))
  action raiseClickStep = script(raiseClick, "")
  action raiseClickBugStep = script(raiseClick, "raiseTwice")
  // A reported cost above the reservation is recorded as it is. This is the
  // counterexample to `strictCap`, the rule before the over-report decision.
  pure val overReport = List(c("reserve", 0), c("reserve", 0), c("reserve", 0), c("reserve", 0), c("overReport", 0))
  action overReportStep = script(overReport, "")
  // After an over-report the day is over its cap and refuses new reservations.
  pure val overReportCap = overReport.concat(List(c("reserve", 0), c("reserveFree", 0)))
  action overReportCapStep = script(overReportCap, "")
  action overReportCapBugStep = script(overReportCap, "cap")
  // A day exactly at its cap refuses even a zero-cost reservation.
  pure val capReached = List(c("reserve", 0), c("reserve", 0), c("reserve", 0), c("reserve", 0), c("reserveFree", 0))
  action capReachedStep = script(capReached, "")
  action capReachedBugStep = script(capReached, "zeroAtCap")
  pure val unknownDrain = List(c("propose", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0), c("lose", 0))
  action unknownDrainStep = script(unknownDrain, "")
  action unknownDrainBugStep = script(unknownDrain, "drain")
  pure val approvedDrain = List(c("propose", 0), c("click", 0))
  action approvedDrainStep = script(approvedDrain, "")
  action approvedDrainBugStep = script(approvedDrain, "drain")
  pure val wakeDrain = List(c("schedule", 0), c("queue", 0))
  action wakeDrainStep = script(wakeDrain, "")
  action wakeDrainBugStep = script(wakeDrain, "drain")
  pure val pauseDrain = List(c("propose", 0), c("click", 0), c("authorize", 0), c("pause", 0))
  action pauseDrainStep = script(pauseDrain, "")
  action pauseDrainBugStep = script(pauseDrain, "drain")
  // Two attempts of one child need a destination that deduplicates; any other child is authorized once.
  pure val attemptEvidence = List(c("deduped", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0),
    c("lose", 0), c("click", 0), c("authorize", 0), c("send", 0), c("receipt", 0), c("crash", 0), c("startup", 0))
  action attemptEvidenceStep = script(attemptEvidence, "")
  action attemptEvidenceBugStep = script(attemptEvidence, "childEvidence")
  pure val batchOrderRace = List(c("propose", 0), c("propose", 1), c("clickBatch", 0), c("expandBatch", 0), c("reorderBatch", 0), c("authorize", 0))
  action batchOrderRaceStep = script(batchOrderRace, "")
  action batchOrderRaceBugStep = script(batchOrderRace, "batchOrder")
  pure val clickedSchedule = List(c("report", 0), c("proposeSchedule", 0), c("clickSchedule", 0),
    c("proposeSchedule", 0), c("scheduleClick", 0))
  action clickedScheduleStep = script(clickedSchedule, "")
  action clickedScheduleBugStep = script(clickedSchedule, "scheduleClick")
  // A menu click while paused creates no watch.
  pure val menuSchedule = List(c("pause", 0), c("scheduleMenu", 0))
  action menuScheduleStep = script(menuSchedule, "")
  action menuScheduleBugStep = script(menuSchedule, "scheduleMenu")
  // A grant from a clean run does not outlive Pause: after Resume the job needs a card.
  pure val resumeGrant = List(c("tier2", 0), c("grant", 0), c("pause", 0), c("resume", 0), c("authorize", 0))
  action resumeGrantStep = script(resumeGrant, "")
  action resumeGrantBugStep = script(resumeGrant, "keepGrants")
  action suiteInit = { nondet which = 0.to(49).oneOf(); all { s' = initial, before' = initial, pc' = 0, remaining' = drainLimit, scenario' = which } }
  val suiteCommands = List(negativeLookup, unknownRetry, hiddenRetry, approvalEdit, schemaRace, accountRace, connectionRace, preconditionRace, expireRace, redactRace, consumeBeforeSend, approvalReuse, startupAttempt, payloadBinding, receiptBinding, scopedGrant, reportGrant, reportLaunch, reportSchedule, wakeSchedule, destructive, ownerRace, pauseRace, offRace, quietNotification, cancelWake, cancelQueuedWake, duplicateWake, lateCancel, partialBatch, dedupeKey, dedupeAccept, parallelBudget, unknownSpend, compactionBudget, unknownDrain, approvedDrain, wakeDrain, pauseDrain, attemptEvidence, batchOrderRace, clickedSchedule,
    compactionSettle, refusedSpend, dailyReset, raiseClick, overReportCap, capReached, menuSchedule, resumeGrant).nth(scenario)
  action suiteStep = script(suiteCommands, "")
  val case0 = scenario == 0 and reachedAgreement and (s.unknown == Set(1) and s.explained == Set(1))
  val case1 = scenario == 1 and reachedAgreement and (s.auths.size() == 1)
  val case2 = scenario == 2 and reachedAgreement and (s.attempts.length() == 1)
  val case3 = scenario == 3 and reachedAgreement and (s.auths == Set())
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
  val case14 = scenario == 14 and reachedAgreement and (s.receipts.size() == 1)
  val case15 = scenario == 15 and reachedAgreement
  val case16 = scenario == 16 and reachedAgreement and (s.grants == Set())
  val case17 = scenario == 17 and reachedAgreement
  val case18 = scenario == 18 and reachedAgreement and (not(s.schedule))
  val case19 = scenario == 19 and reachedAgreement and (not(s.schedule))
  val case20 = scenario == 20 and reachedAgreement
  val case21 = scenario == 21 and reachedAgreement
  val case22 = scenario == 22 and reachedAgreement
  val case23 = scenario == 23 and reachedAgreement
  val case24 = scenario == 24 and reachedAgreement
  val case25 = scenario == 25 and reachedAgreement and (s.admissions.length() == 0)
  val case26 = scenario == 26 and reachedAgreement and (s.starts.length() == 0)
  val case27 = scenario == 27 and reachedAgreement and (s.admissions.length() == 1)
  val case28 = scenario == 28 and reachedAgreement and (s.receipts.size() == 1)
  val case29 = scenario == 29 and reachedAgreement and (s.effects.get(0) == 1 and s.effects.get(1) == 1)
  val case30 = scenario == 30 and reachedAgreement and (s.effects.get(0) == 1 and s.attempts.length() == 2)
  val case31 = scenario == 31 and reachedAgreement and (s.effects.get(0) == 1 and s.attempts.length() == 2)
  val case32 = scenario == 32 and reachedAgreement
  val case33 = scenario == 33 and reachedAgreement
  val case34 = scenario == 34 and reachedAgreement
  val case35 = scenario == 35 and reachedAgreement and (s.unknown.subseteq(s.explained))
  val case36 = scenario == 36 and reachedAgreement and (s.attempts.length() == 1)
  val case37 = scenario == 37 and reachedAgreement and (s.admissions.length() == 1)
  val case38 = scenario == 38 and reachedAgreement and (s.cancelled == Set(1))
  val case39 = scenario == 39 and reachedAgreement and s.unknown == Set(2) and s.receipts.size() == 1
  val case40 = scenario == 40 and reachedAgreement and s.auths == Set()
  val case41 = scenario == 41 and reachedAgreement and not(s.schedule)
  val case42 = scenario == 42 and reachedAgreement and s.spends.size() == 1 and compactionOn(0, "") == 1 and actualOn(0) == 1
  val case43 = scenario == 43 and reachedAgreement and s.spends.size() == 5 and reservedOn(0) == 8 and
    s.spends.exists(r => r.id == 1 and r.state == "settled" and r.actual == 0) and s.spends.exists(r => r.id == 2 and r.state == "unknown")
  val case44 = scenario == 44 and reachedAgreement and reservedOn(1) == 8 and reservedOn(0) == 6 and actualOn(0) == 1 and
    s.spends.exists(r => r.id == 1 and r.state == "unknown" and r.day == 0)
  val case45 = scenario == 45 and reachedAgreement and s.spends.size() == 6 and s.raiseLog.length() == 1 and reservedOn(0) == 12
  val case46 = scenario == 46 and reachedAgreement and s.spends.size() == 4 and totalOn(0) == 9 and overReportOn(0, false) == 1
  val case47 = scenario == 47 and reachedAgreement and s.spends.size() == 4 and totalOn(0) == 8
  val case48 = scenario == 48 and reachedAgreement and not(s.schedule)
  val case49 = scenario == 49 and reachedAgreement and s.grants == Set() and s.auths == Set()
  // A click made before Pause waits, and after Resume is authorized and sent once.
  action resumedClickWitnessStep = script(List(c("propose", 0), c("click", 0), c("pause", 0), c("resume", 0)), "")
  val resumedClickSent = reachedAgreement and s.auths.size() == 1 and s.attempts.length() == 1 and s.receipts.size() == 1
  // A menu click creates the watch even after the run read Slack.
  action menuScheduleWitnessStep = script(List(c("report", 0), c("scheduleMenu", 0)), "")
  val menuScheduleCreated = reachedAgreement and s.schedule and s.scheduleAuthority == "menu"
  action clickedScheduleWitnessStep = script(List(c("report", 0), c("proposeSchedule", 0),
    c("clickSchedule", 0), c("scheduleClick", 0)), "")
  val clickedScheduleCreated = reachedAgreement and s.schedule and s.scheduleAuthority == "click"
  action clickedGrantStep = script(List(c("report", 0), c("tier2", 0), c("click", 0),
    c("grantClick", 0), c("authorize", 0), c("send", 0), c("accept", 0), c("receipt", 0)), "")
  action boundedStep = tick(any {
    all { s.current.get(0) == 0, propose(0, 3, false) },
    all { currentIntent(0) != Set(), s.nextApproval < 3, click(0) },
    authorizeDispatch(0), transportSend(0), crash, startup(true), pause("pause")
  })
  val boundedSafety = intentBeforeDispatch and approvalExact and approvalConsumption and
    noHiddenRetry and allWritesGated and pauseBlocksAuthorization and unknownPreserved
  action boundedRace(guard: bool): bool = tick(
    if (pc == 0) propose(0, 3, false) else if (pc == 1) click(0) else
    if (pc == 2) pause("pause") else if (pc == 3) authorizeWith(0, if (guard) "" else "pause") else idle)
  action boundedRaceStep = boundedRace(true)
  action boundedRaceBugStep = boundedRace(false)
}
module agent_actions { import actionsProtocol(children = 2, drainLimit = 32).* }
module agent_actions_bounded { import actionsProtocol(children = 1, drainLimit = 32).* }
