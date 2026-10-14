// Plan v3 WP3. FULL transactions are atomic. Transport handoff, remote
// acceptance and evidence commits are deliberately separate crash points.
module actionsProtocol {
  const children: int
  const drainLimit: int
  type Payload = { connection: int, account: int, destination: int, tool: int,
    schema: int, args: int, precondition: int, ops: List[int] }
  type Intent = { id: int, rev: int, payload: Payload, tier: int, deduped: bool, source: int }
  type Approval = { id: int, child: int, rev: int, digest: Payload, warning: bool, batch: int }
  type Authorization = { id: int, intent: Intent, approval: int, consumed: bool, epoch: int, grant: bool }
  type Attempt = { id: int, auth: int, child: int, payload: Payload, key: int }
  type Receipt = { attempt: int, child: int, payload: Payload }
  type Grant = { target: int, opClass: int, source: int, rev: int }
  type Occurrence = { schedule: int, rev: int, due: int }
  type State = {
    batchId: int, batchOrder: List[Intent], expanded: List[Intent],
    intents: Set[Intent], current: int -> int, approvals: Set[Approval], auths: Set[Authorization],
    attempts: List[Attempt], accepted: Set[int], effects: int -> int, keys: Set[int], receipts: Set[Receipt],
    unknown: Set[int], failed: Set[int], explained: Set[int], cancelled: Set[int], cancelRequested: bool,
    nextAuth: int, nextApproval: int, schema: int, account: int, connection: int, precondition: int,
    invalid: bool, expired: bool, gen: int, epoch: int, localEpoch: int, active: bool,
    paused: bool, off: bool, stopped: bool, crashed: bool, resumed: bool,
    ownerRun: bool, clean: bool, sourceInRun: bool, grants: Set[Grant],
    schedule: bool, scheduleRev: int, scheduleSourceClean: bool, wake: Occurrence,
    queued: bool, admissions: List[Occurrence], starts: List[Occurrence],
    quiet: bool, deliverNow: bool, notifications: int, cap: int, raises: int,
    reserved: int, actual: int, unknownSpend: int, compaction: int,
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
    paused: false, off: false, stopped: false, crashed: false, resumed: false,
    ownerRun: true, clean: true, sourceInRun: true, grants: Set(),
    schedule: false, scheduleRev: 1, scheduleSourceClean: true,
    wake: { schedule: 1, rev: 1, due: 1 }, queued: false, admissions: List(), starts: List(),
    quiet: false, deliverNow: false, notifications: 0, cap: 8, raises: 0,
    reserved: 0, actual: 0, unknownSpend: 0, compaction: 0, sealed: false, label: "init", target: 0
  }
  action init = all { s' = initial, before' = initial, pc' = 0, remaining' = drainLimit, scenario' = 0 }
  def currentIntent(k: int): Set[Intent] = s.intents.filter(i => i.id == k and i.rev == s.current.get(k))
  def done(k: int): bool = s.receipts.exists(r => r.child == k)
  def evidenced(a: int): bool = s.receipts.exists(r => s.attempts.listSet().exists(t => t.id == r.attempt and t.auth == a))
  def sent(a: int): bool = s.attempts.listSet().exists(t => t.auth == a)
  def valid(i: Intent): bool = i.rev == s.current.get(i.id) and not(s.invalid) and not(s.expired) and
    i.source == s.gen and i.payload.schema == s.schema and i.payload.account == s.account and
    i.payload.connection == s.connection and i.payload.precondition == s.precondition
  val mayAuthorize = s.active and s.epoch == s.localEpoch and not(s.paused or s.off or s.stopped or s.crashed)
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
  action click(k: int, warning: bool): bool = {
    nondet i = currentIntent(k).oneOf()
    s' = { ...s, approvals: s.approvals.union(Set({ id: s.nextApproval, child: k,
      rev: i.rev, digest: i.payload, warning: warning, batch: 0 })), nextApproval: s.nextApproval + 1,
      label: "click", target: k }
  }
  action clickBatch = {
    nondet first = currentIntent(0).oneOf()
    nondet second = currentIntent(1).oneOf()
    if (s.batchId != 0) idle else s' = { ...s, batchId: s.nextApproval, batchOrder: List(first, second),
      approvals: s.approvals.union(Set(
        { id: s.nextApproval, child: 0, rev: first.rev, digest: first.payload, warning: false, batch: s.nextApproval },
        { id: s.nextApproval + 1, child: 1, rev: second.rev, digest: second.payload, warning: false, batch: s.nextApproval })),
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
      (bug == "retry" or not(s.auths.exists(a => a.intent.id == k)) or a.warning or i.deduped))
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
  action pause(kind: str): bool = s' = { ...s, paused: kind == "pause" or s.paused,
    off: kind == "off" or s.off, stopped: kind == "stop" or s.stopped,
    grants: Set(), schedule: false, cancelRequested: true, label: "pause" }
  action cancel(guard: bool): bool = s' = { ...s,
    cancelled: s.cancelled.union(s.auths.filter(a => not(sent(a.id))).map(a => a.id)),
    unknown: s.unknown.union(s.auths.filter(a => sent(a.id) and not(evidenced(a.id))).map(a => a.id)),
    receipts: if (guard) s.receipts else Set(), cancelRequested: false, label: "cancel" }
  action taint(owner: bool): bool = s' = { ...s, clean: false, ownerRun: owner, label: "taint" }
  action grantWith(k: int, guard: bool): bool =
    if (guard and not(s.ownerRun and s.clean and s.sourceInRun and mayAuthorize)) idle else
    s' = { ...s, grants: s.grants.union(Set({ target: k, opClass: 2, source: s.gen, rev: 1 })), label: "grant", target: k }
  action grantClick(k: int): bool =
    if (not(currentIntent(k).exists(i => valid(i) and s.approvals.exists(p =>
      p.child == k and p.rev == i.rev and p.digest == i.payload)))) idle else
    s' = { ...s, grants: s.grants.union(Set({ target: k, opClass: 2, source: s.gen, rev: 1 })), label: "grantClick", target: k }
  action scheduleWith(guard: bool): bool =
    if (guard and not(s.ownerRun and s.clean and s.sourceInRun and mayAuthorize)) idle else
    s' = { ...s, schedule: true, scheduleSourceClean: s.ownerRun and s.clean and s.sourceInRun,
      grants: s.grants.union(Set({ target: 1, opClass: 1, source: s.gen, rev: s.scheduleRev })), label: "schedule" }
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
  // All model paths share one reservation transaction. Unknown usage keeps
  // its reservation; a second sub-budget never expands the owner's total cap.
  action reserve(compact: bool, guard: bool): bool =
    if (guard and (s.reserved + s.actual + 2 > s.cap + s.raises or (compact and s.compaction + 2 > 2))) idle else
    s' = { ...s, reserved: s.reserved + 2, compaction: s.compaction + (if (compact) 2 else 0), label: "reserve" }
  action settleSpend(lost: bool, guard: bool): bool =
    if (s.reserved - s.unknownSpend < 2) idle else s' = { ...s,
      reserved: s.reserved - (if (lost and guard) 0 else 2), actual: s.actual + (if (lost) 0 else 1),
      unknownSpend: s.unknownSpend + (if (lost) 2 else 0), label: "spend" }
  action invalidate(kind: str): bool = s' = { ...s,
    schema: s.schema + (if (kind == "schema") 1 else 0), account: s.account + (if (kind == "account") 1 else 0),
    connection: s.connection + (if (kind == "connection") 1 else 0),
    precondition: s.precondition + (if (kind == "precondition") 1 else 0),
    sourceInRun: s.sourceInRun and kind != "redact", invalid: s.invalid or kind == "redact", expired: s.expired or kind == "expire",
    gen: s.gen + (if (kind == "redact") 1 else 0), grants: if (kind == "redact") Set() else s.grants,
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
  val retryRequiresAuthority = newAuths.forall(a => a.intent.deduped or
    not(before.auths.exists(b => b.intent.id == a.intent.id)) or
    before.approvals.exists(p => p.id == a.approval and p.warning and not(before.auths.exists(b => b.approval == p.id))))
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
      before.intents.exists(i => i.id == p.child and i.rev == p.rev and i.payload == p.digest)))
  val tier4NeverDispatched = s.auths.forall(a => a.intent.tier < 4)
  val allWritesGated = s.attempts.listSet().forall(t => s.auths.exists(a => a.id == t.auth and a.consumed and a.intent.payload == t.payload))
  // This is the local ownership authority only. WP4 deliberately disproves
  // the stronger cross-device interpretation without an external fence.
  val currentOwnerAuthorizes = newAuths.forall(a => before.active and a.epoch == before.epoch)
  val pauseBlocksAuthorization = newAuths.isEmpty() or not(before.paused or before.off or before.stopped)
  val quietHoursHoldNotifications = s.notifications == before.notifications or (not(before.off) and (not(before.quiet) or before.deliverNow))
  val scheduleGrantValid = not(s.schedule) or scheduleValid
  val occurrenceAdmissionOnce = s.admissions.listSet().forall(w => s.admissions.select(v => v == w).length() == 1)
  val cancelWinsBeforeAdmission = (s.label == "admit" or s.label == "wake") implies
    (before.schedule and before.wake.rev == before.scheduleRev and before.grants.exists(g =>
      g.opClass == 1 and g.rev == before.scheduleRev and g.source == before.gen))
  val batchEffectsIndependent = newAuths.forall(a => not(before.receipts.exists(r => r.child == a.intent.id)))
  val outcomeEvidenceStable = before.receipts.subseteq(s.receipts) and before.auths.subseteq(s.auths)
  val scheduleFromCleanOwnerRun = not(s.schedule) or s.scheduleSourceClean
  val cleanRunForNoClick = newAuths.forall(a => not(a.grant) or (before.ownerRun and before.clean))
  val capHard = s.reserved + s.actual <= s.cap + s.raises and s.unknownSpend <= s.reserved and s.compaction <= 2
  val safety = intentBeforeDispatch and approvalExact and approvalCurrentAtAuthorization and approvalConsumption and
    noHiddenRetry and retryRequiresAuthority and unknownPreserved and dedupeIdentityStable and dedupedEffectOnce and
    receiptMatchesAction and scopedNoClickGrant and untrustedCannotGrant and tier4NeverDispatched and allWritesGated and
    currentOwnerAuthorizes and pauseBlocksAuthorization and quietHoursHoldNotifications and scheduleGrantValid and
    occurrenceAdmissionOnce and cancelWinsBeforeAdmission and batchEffectsIndependent and outcomeEvidenceStable and
    scheduleFromCleanOwnerRun and cleanRunForNoClick and capHard

  val pendingApproved = ids.filter(k => not(done(k)) and currentIntent(k).exists(i => valid(i) and
    s.approvals.exists(p => p.child == k and p.rev == i.rev and p.digest == i.payload and
      (p.batch == 0 or s.expanded == s.batchOrder) and not(s.auths.exists(a => a.approval == p.id)) and (not(s.auths.exists(a => a.intent.id == k)) or p.warning or i.deduped))))
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
      all { currentIntent(k) != Set(), s.nextApproval < 5, click(k, true) },
      authorizeDispatch(k), transportSend(k), destinationAccept(k), recordReceipt(k), lose(k), reject(k), reconcile(k, true, true),
      crash, startup(true), pause("pause"), cancel(true), taint(true), grantWith(k, true),
      scheduleWith(true), queueWake, deleteSchedule, admitWake(""), startWake(true),
      invalidate("redact"), invalidate("schema"), reserve(false, true), reserve(true, true), settleSpend(true, true), settleSpend(false, true), seal }
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
    if (op == "click") click(k, false) else
    if (op == "retryClick") click(k, true) else
    if (op == "authorize") authorizeWith(k, bug) else
    if (op == "send") sendWith(k, bug) else
    if (op == "accept") acceptWith(k, bug != "dedupe") else
    if (op == "receipt") receiptWith(k, bug != "receipt") else
    if (op == "lose") lose(k) else
    if (op == "negative") reconcile(k, false, bug != "negative") else
    if (op == "crash") crash else
    if (op == "startup") { if (bug == "childEvidence") startupByChild else startup(bug != "startup") } else
    if (op == "pause" or op == "off" or op == "stop") pause(op) else
    if (op == "cancel") cancel(bug != "evidence") else
    if (op == "report") taint(true) else
    if (op == "wakeRun") taint(false) else
    if (op == "grantClick") grantClick(k) else
    if (op == "grant") grantWith(k, bug != "untrusted") else
    if (op == "schedule") scheduleWith(bug != "schedule") else
    if (op == "queue") queueWake else
    if (op == "delete") deleteSchedule else
    if (op == "admit") admitWake(bug) else
    if (op == "startWake") startWake(bug != "startWake") else
    if (op == "quiet") s' = { ...s, quiet: true, label: "quiet" } else
    if (op == "notify") notify(bug != "notify") else
    if (op == "reserve") reserve(k == 1, bug != "cap") else
    if (op == "spend") settleSpend(true, bug != "spend") else
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
  pure val approvalReuse = List(c("propose", 0), c("retryClick", 0), c("authorize", 0), c("authorize", 0))
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
  pure val stopRace = List(c("propose", 0), c("click", 0), c("stop", 0), c("authorize", 0))
  action stopRaceStep = script(stopRace, "")
  action stopRaceBugStep = script(stopRace, "pause")
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
  pure val dedupeKey = List(c("deduped", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0), c("lose", 0), c("retryClick", 0), c("authorize", 0), c("send", 0), c("accept", 0))
  action dedupeKeyStep = script(dedupeKey, "")
  action dedupeKeyBugStep = script(dedupeKey, "key")
  pure val dedupeAccept = List(c("deduped", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0), c("lose", 0), c("retryClick", 0), c("authorize", 0), c("send", 0), c("accept", 0))
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
  pure val attemptEvidence = List(c("propose", 0), c("click", 0), c("authorize", 0), c("send", 0), c("accept", 0),
    c("lose", 0), c("retryClick", 0), c("authorize", 0), c("send", 0), c("receipt", 0), c("crash", 0), c("startup", 0))
  action attemptEvidenceStep = script(attemptEvidence, "")
  action attemptEvidenceBugStep = script(attemptEvidence, "childEvidence")
  pure val batchOrderRace = List(c("propose", 0), c("propose", 1), c("clickBatch", 0), c("expandBatch", 0), c("reorderBatch", 0), c("authorize", 0))
  action batchOrderRaceStep = script(batchOrderRace, "")
  action batchOrderRaceBugStep = script(batchOrderRace, "batchOrder")
  action suiteInit = { nondet which = 0.to(41).oneOf(); all { s' = initial, before' = initial, pc' = 0, remaining' = drainLimit, scenario' = which } }
  val suiteCommands = List(negativeLookup, unknownRetry, hiddenRetry, approvalEdit, schemaRace, accountRace, connectionRace, preconditionRace, expireRace, redactRace, consumeBeforeSend, approvalReuse, startupAttempt, payloadBinding, receiptBinding, scopedGrant, reportGrant, reportLaunch, reportSchedule, wakeSchedule, destructive, ownerRace, pauseRace, stopRace, offRace, quietNotification, cancelWake, cancelQueuedWake, duplicateWake, lateCancel, partialBatch, dedupeKey, dedupeAccept, parallelBudget, unknownSpend, compactionBudget, unknownDrain, approvedDrain, wakeDrain, pauseDrain, attemptEvidence, batchOrderRace).nth(scenario)
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
  val case25 = scenario == 25 and reachedAgreement
  val case26 = scenario == 26 and reachedAgreement and (s.admissions.length() == 0)
  val case27 = scenario == 27 and reachedAgreement and (s.starts.length() == 0)
  val case28 = scenario == 28 and reachedAgreement and (s.admissions.length() == 1)
  val case29 = scenario == 29 and reachedAgreement and (s.receipts.size() == 1)
  val case30 = scenario == 30 and reachedAgreement and (s.effects.get(0) == 1 and s.effects.get(1) == 1)
  val case31 = scenario == 31 and reachedAgreement and (s.effects.get(0) == 1 and s.attempts.length() == 2)
  val case32 = scenario == 32 and reachedAgreement and (s.effects.get(0) == 1 and s.attempts.length() == 2)
  val case33 = scenario == 33 and reachedAgreement
  val case34 = scenario == 34 and reachedAgreement
  val case35 = scenario == 35 and reachedAgreement
  val case36 = scenario == 36 and reachedAgreement and (s.unknown.subseteq(s.explained))
  val case37 = scenario == 37 and reachedAgreement and (s.attempts.length() == 1)
  val case38 = scenario == 38 and reachedAgreement and (s.admissions.length() == 1)
  val case39 = scenario == 39 and reachedAgreement and (s.cancelled == Set(1))
  val case40 = scenario == 40 and reachedAgreement and s.unknown == Set(2) and s.receipts.size() == 1
  val case41 = scenario == 41 and reachedAgreement and s.auths == Set()
  action clickedGrantStep = script(List(c("report", 0), c("tier2", 0), c("click", 0),
    c("grantClick", 0), c("authorize", 0), c("send", 0), c("accept", 0), c("receipt", 0)), "")
  action boundedStep = tick(any {
    all { s.current.get(0) == 0, propose(0, 3, false) },
    all { currentIntent(0) != Set(), s.nextApproval < 3, click(0, false) },
    authorizeDispatch(0), transportSend(0), crash, startup(true), pause("pause")
  })
  val boundedSafety = intentBeforeDispatch and approvalExact and approvalConsumption and
    noHiddenRetry and allWritesGated and pauseBlocksAuthorization and unknownPreserved
  action boundedRace(guard: bool): bool = tick(
    if (pc == 0) propose(0, 3, false) else if (pc == 1) click(0, false) else
    if (pc == 2) pause("pause") else if (pc == 3) authorizeWith(0, if (guard) "" else "pause") else idle)
  action boundedRaceStep = boundedRace(true)
  action boundedRaceBugStep = boundedRace(false)
}
module agent_actions { import actionsProtocol(children = 2, drainLimit = 32).* }
module agent_actions_bounded { import actionsProtocol(children = 1, drainLimit = 32).* }
