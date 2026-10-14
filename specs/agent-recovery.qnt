// Plan v3 WP4 plus WP0's SQLite lock and pi next_seq findings.
// A and B are devices. Processes 0 and 1 contend on A's local SQLite lock.
// Folder synchronization provides no cross-device exclusion.
module recoveryProtocol {
  const capacity: int
  const drainLimit: int
  type Entry = { inc: int, pos: int, op: int }
  type Authority = { id: int, device: int, epoch: int }
  type Segment = { gen: int, from: int, to: int, prev: int, hash: int, nonce: int }
  type Manifest = { gen: int, schema: int, snapshot: int, head: int, hash: int, authenticated: bool, deletion: int }
  type State = {
    lock: int, referenced: bool, writers: Set[int], io: Set[int],
    inbox: Set[int], ack: Set[int], volatile: Set[int], submitted: Set[int], interrupted: Set[int],
    bridgeReset: bool, journal: List[Entry], archive: List[Entry], cursor: int -> int,
    incarnation: int, nextInc: int, identities: Set[int], nextSeq: int, rollback: bool,
    supported: bool, resumed: bool, stopped: bool,
    approvals: Set[int], consumed: Set[int], receipts: Set[int], unknown: Set[int],
    active: Set[int], epoch: int -> int, actualOwner: int, cachedEpoch: int, authorizations: Set[Authority], nextAuth: int,
    admissions: bool, transfer: bool, drained: bool, checkpoint: int, checkpointComplete: bool,
    released: bool, releasePublished: bool, successor: bool, oldOff: bool, attested: bool,
    recovery: bool, quarantined: bool, reviewed: bool, restoredPending: bool,
    position: int, gen: int, segments: Set[Segment], encryptions: List[int], nextNonce: int,
    manifest: Manifest, exportCursor: int, snapshotApproval: Set[int], snapshotConsumed: Set[int],
    snapshotReceipt: Set[int], snapshotInc: int, deletion: int, deletionKnown: bool,
    restoring: bool, candidate: Manifest, staged: int, stagedHash: int, fresh: bool,
    removed: Set[int], backupSources: Set[int], destroyedKeys: Set[int],
    installed: bool, installedGen: int, installedPosition: int,
    sealed: bool, label: str
  }
  var s: State
  var before: State
  var pc: int
  var scenario: int
  var remaining: int
  pure def listSet(xs) = xs.foldl(Set(), (acc, x) => acc.union(Set(x)))
  pure val generations = 1.to(16)
  pure val positions = 0.to(32)
  pure val emptyManifest: Manifest = { gen: 1, schema: 1, snapshot: 0, head: 0, hash: 0, authenticated: true, deletion: 0 }
  pure val initial: State = {
    lock: 0, referenced: true, writers: Set(0), io: Set(), inbox: Set(), ack: Set(), volatile: Set(),
    submitted: Set(), interrupted: Set(), bridgeReset: false, journal: List(), archive: List(),
    cursor: 1.to(16).mapBy(_ => 0), incarnation: 1, nextInc: 2, identities: Set(1), nextSeq: 1,
    rollback: false, supported: true, resumed: false, stopped: false,
    approvals: Set(), consumed: Set(), receipts: Set(), unknown: Set(),
    active: Set(0), epoch: 0.to(1).mapBy(d => if (d == 0) 1 else 0), actualOwner: 0, cachedEpoch: 1, authorizations: Set(), nextAuth: 1,
    admissions: true, transfer: false, drained: false, checkpoint: -1, checkpointComplete: false,
    released: false, releasePublished: false, successor: false, oldOff: false, attested: false,
    recovery: false, quarantined: false, reviewed: false, restoredPending: false,
    position: 0, gen: 1, segments: Set(), encryptions: List(), nextNonce: 1, manifest: emptyManifest,
    exportCursor: 0, snapshotApproval: Set(), snapshotConsumed: Set(), snapshotReceipt: Set(), snapshotInc: 1, deletion: 0, deletionKnown: true,
    restoring: false, candidate: emptyManifest, staged: 0, stagedHash: 0, fresh: true,
    removed: Set(), backupSources: Set(), destroyedKeys: Set(),
    installed: false, installedGen: 0, installedPosition: 0, sealed: false, label: "init"
  }
  action init = all { s' = initial, before' = initial, pc' = 0, scenario' = 0, remaining' = drainLimit }
  val localReady = s.referenced and s.writers == Set(s.lock) and s.lock != -1
  action idle = s' = { ...s, label: "blocked" }
  action acquire(p: int): bool =
    if (s.lock != -1) idle else s' = { ...s, lock: p, referenced: true, writers: s.writers.union(Set(p)), label: "acquire" }
  // The exclusive SQLite connection is strongly referenced until owned I/O
  // stops. GC of an unreferenced DatabaseSync closes it, even in a live process.
  action collect(guard: bool): bool =
    if (guard and s.referenced) idle else s' = { ...s, lock: -1, referenced: false, label: "collect" }
  action startIO = s' = { ...s, io: s.io.union(s.writers), label: "io" }
  action releaseLock(guard: bool): bool =
    if (guard and s.io != Set()) idle else s' = { ...s, lock: -1, referenced: false, writers: Set(), label: "unlock" }
  action stopIO = s' = { ...s, io: Set(), label: "stopIO" }
  action acceptInput(op: int, durable: bool): bool =
    if (not(s.admissions) or s.writers == Set()) idle else s' = { ...s,
      inbox: if (durable) s.inbox.union(Set(op)) else s.inbox,
      volatile: if (durable) s.volatile else s.volatile.union(Set(op)), position: s.position + 1, label: "inbox" }
  action acknowledge(op: int, guard: bool): bool =
    if (guard and not(s.inbox.contains(op))) idle else s' = { ...s, ack: s.ack.union(Set(op)), label: "ack" }
  action resetBridge = s' = { ...s, bridgeReset: true, label: "reset" }
  action submit(op: int, dedupe: bool): bool = if (not(localReady)) idle else
    if (not(s.bridgeReset) or not(s.inbox.contains(op)) or s.stopped) idle else
    if (dedupe and s.journal.listSet().exists(e => e.inc == s.incarnation and e.op == op)) idle else
    s' = { ...s, journal: s.journal.append({ inc: s.incarnation, pos: s.nextSeq, op: op }),
      nextSeq: s.nextSeq + 1, label: "submit" }
  action markSubmitted(op: int): bool = if (not(localReady)) idle else
    if (s.journal.listSet().exists(e => e.op == op and e.inc == s.incarnation))
      s' = { ...s, submitted: s.submitted.union(Set(op)), label: "submitted" } else idle
  action project(atomic: bool): bool = if (not(localReady)) idle else {
    val available = s.journal.select(e => e.inc == s.incarnation and e.pos == s.cursor.get(s.incarnation) + 1)
    if (available.length() == 0) idle else {
      val e = available.head()
      s' = { ...s, archive: s.archive.append(e), cursor: if (atomic) s.cursor.set(e.inc, e.pos) else s.cursor,
        position: s.position + 1, label: "project" }
    }
  }
  action approve = if (not(localReady)) idle else if (s.approvals.contains(1)) idle else s' = { ...s, approvals: s.approvals.union(Set(1)), position: s.position + 1, label: "approve" }
  action consume = if (not(localReady)) idle else
    if (s.approvals.contains(1) and not(s.consumed.contains(1)) and not(s.recovery or s.quarantined))
      s' = { ...s, consumed: s.consumed.union(Set(1)), position: s.position + 1, label: "consume" } else idle
  action receipt = if (not(localReady)) idle else if (s.consumed.subseteq(s.receipts)) idle else s' = { ...s, receipts: s.receipts.union(s.consumed), position: s.position + 1, label: "receipt" }
  action crash(guard: bool): bool = s' = { ...s, lock: -1, referenced: false, writers: Set(), io: Set(),
    volatile: Set(), bridgeReset: false, resumed: false,
    consumed: if (guard) s.consumed else Set(), label: "crash" }
  // A copied older pi file is valid to pi. The Juno cursor survives. next_seq
  // is the next available position; last committed is next_seq - 1.
  action rollbackJournal = s' = { ...s, journal: List(), nextSeq: 1, rollback: true, resumed: false, label: "rollback" }
  action rotate(guard: bool): bool = if (not(localReady)) idle else {
    val inc = if (guard) s.nextInc else s.incarnation
    s' = { ...s, incarnation: inc, nextInc: s.nextInc + 1, identities: s.identities.union(Set(inc)),
      journal: List(), nextSeq: 1, rollback: false, resumed: false, stopped: false,
      interrupted: s.interrupted.union(s.submitted), label: "rotate" }
  }
  action openJournal(guard: bool): bool = if (not(localReady)) idle else
    if (not(s.supported)) s' = { ...s, stopped: true, resumed: false, label: "unsupported" } else
    if (guard and s.nextSeq - 1 < s.cursor.get(s.incarnation)) rotate(true) else
    s' = { ...s, resumed: true, unknown: s.unknown.union(s.consumed.exclude(s.receipts)), label: "resume" }
  action authorize(device: int): bool =
    if (s.active.contains(device) and not(device == 0 and (s.oldOff or not(s.admissions))))
      s' = { ...s, authorizations: s.authorizations.union(Set({ id: s.nextAuth, device: device, epoch: s.epoch.get(device) })),
        nextAuth: s.nextAuth + 1, label: "authorize" } else idle
  action beginTransfer = if (not(localReady)) idle else s' = { ...s, admissions: false, transfer: true, label: "transfer" }
  action drain =
    if (s.cursor.get(s.incarnation) != s.nextSeq - 1) project(true) else
    s' = { ...s, io: Set(), unknown: s.unknown.union(s.consumed.exclude(s.receipts)), drained: true, label: "drain" }
  action checkpoint(guard: bool): bool = if (not(localReady)) idle else
    if (guard and (s.admissions or not(s.drained) or s.io != Set() or s.cursor.get(s.incarnation) != s.nextSeq - 1)) idle else
    s' = { ...s, checkpoint: s.position,
      checkpointComplete: not(s.admissions) and s.drained and s.io == Set() and s.cursor.get(s.incarnation) == s.nextSeq - 1,
      label: "checkpoint" }
  // Release is durable BEFORE publishing the checkpoint's released manifest.
  action releaseOwner = if (not(localReady)) idle else
    if (s.checkpoint < 0) idle else s' = { ...s, released: true, admissions: false, active: s.active.exclude(Set(0)), label: "releaseOwner" }
  action publishRelease(guard: bool): bool = if (not(localReady)) idle else
    if (guard and not(s.released)) idle else s' = { ...s, releasePublished: true, label: "publishRelease" }
  // The successor sees the released manifest and its checkpoint, not the
  // predecessor's current local ownership record or live commit position.
  action installSuccessor(guard: bool): bool =
    if (not(s.releasePublished) or (guard and not(s.checkpointComplete))) idle else
    s' = { ...s, successor: true, active: s.active.union(Set(1)), epoch: s.epoch.set(1, s.epoch.get(0) + 1),
      actualOwner: 1, label: "successor" }
  action rebootOld =
    if (s.released) idle else s' = { ...s, admissions: true, active: s.active.union(Set(0)), label: "rebootOld" }

  // Capture and export are separate durable file operations. A restore may
  // observe a renamed manifest before folder sync delivers its segments.
  action snapshotWith(guard: bool): bool = if (not(localReady)) idle else s' = { ...s, manifest: { ...s.manifest, gen: s.gen, snapshot: s.position,
      head: s.position, hash: s.position, deletion: s.deletion, authenticated: true }, exportCursor: s.position,
    snapshotApproval: s.approvals, snapshotConsumed: s.consumed, snapshotReceipt: s.receipts,
    snapshotInc: s.incarnation, backupSources: if (guard) s.inbox.exclude(s.removed) else s.inbox, label: "snapshot" }
  action snapshot = snapshotWith(true)
  action encrypt(guard: bool): bool = if (not(localReady)) idle else {
    val from = s.manifest.head
    val nonce = if (guard) s.nextNonce else 1
    if (from >= s.position) idle else s' = { ...s,
      segments: s.segments.union(Set({ gen: s.gen, from: from, to: from + 1,
        prev: s.manifest.hash, hash: from + 1, nonce: nonce })),
      encryptions: s.encryptions.append(nonce), nextNonce: s.nextNonce + 1, label: "encrypt" }
  }
  action publishManifest(guard: bool): bool = if (not(localReady)) idle else {
    val available = s.segments.filter(x => x.gen == s.gen and x.from == s.manifest.head and x.prev == s.manifest.hash)
    if (available == Set()) {
      if (guard) idle else s' = { ...s, manifest: { ...s.manifest, head: s.manifest.head + 1, hash: s.manifest.head + 1 }, label: "manifest" }
    } else {
      nondet seg = available.oneOf()
      s' = { ...s, manifest: { ...s.manifest, head: seg.to, hash: seg.hash }, label: "manifest" }
    }
  }
  action persistExport(guard: bool): bool = if (not(localReady)) idle else s' = { ...s,
    exportCursor: if (guard) s.manifest.head else s.position, label: "export" }
  action persistExportFeedback = if (not(localReady)) idle else s' = { ...s, exportCursor: s.manifest.head, position: s.position + 1, label: "export" }
  action beginRestore(guard: bool): bool = if (not(localReady)) idle else
    if (guard and (not(s.manifest.authenticated) or s.manifest.schema != 1)) idle else
    s' = { ...s, candidate: s.manifest, restoring: true, staged: s.manifest.snapshot,
      stagedHash: s.manifest.snapshot, fresh: true, label: "beginRestore" }
  action replay(guard: bool): bool = if (not(localReady)) idle else {
    val available = s.segments.filter(x => x.gen == s.candidate.gen and x.from == s.staged and x.prev == s.stagedHash)
    if (s.staged >= s.candidate.head) idle else
    if (available == Set()) {
      if (guard) idle else s' = { ...s, staged: s.candidate.head, stagedHash: s.candidate.hash, label: "skipGap" }
    } else {
      nondet seg = available.oneOf()
      s' = { ...s, staged: seg.to, stagedHash: seg.hash, label: "replay" }
    }
  }
  val candidateValid = s.restoring and s.fresh and s.candidate.authenticated and s.candidate.schema == 1 and
    s.staged == s.candidate.head and s.stagedHash == s.candidate.hash
  action install(guard: bool): bool = if (not(localReady)) idle else
    if (not(s.restoring) or s.staged != s.candidate.head or
      (guard and (not(candidateValid) or not(s.deletionKnown) or s.candidate.gen < s.deletion))) idle else
    s' = { ...s, installed: true, installedGen: s.candidate.gen, installedPosition: s.staged, position: s.staged,
      recovery: true, quarantined: true, restoredPending: true, active: Set(),
      approvals: Set(), consumed: s.snapshotConsumed, receipts: s.snapshotReceipt,
      unknown: s.snapshotConsumed.exclude(s.snapshotReceipt),
      incarnation: s.nextInc, nextInc: s.nextInc + 1, identities: s.identities.union(Set(s.nextInc)),
      journal: List(), nextSeq: 1, label: "install" }
  action unsafeRestore(guard: bool): bool =
    if (guard) install(true) else s' = { ...s, installed: true, recovery: false, quarantined: false,
      approvals: s.snapshotApproval, consumed: s.snapshotConsumed, receipts: s.snapshotReceipt,
      active: Set(1), actualOwner: 1, label: "install" }
  action redact = if (not(localReady)) idle else s' = { ...s, gen: s.gen + 1, deletion: s.gen + 1, removed: s.removed.union(s.inbox), position: s.position + 1, label: "redact" }
  action shred(guard: bool): bool = if (not(localReady)) idle else
    if (guard and (s.manifest.gen != s.gen or s.backupSources.intersect(s.removed) != Set())) idle else
    s' = { ...s, destroyedKeys: s.destroyedKeys.union(generations.filter(g => g < s.gen)), label: "shred" }
  // Attestation is an owner statement, NOT a network fence. Only the corrected
  // schedule also shuts the old device down. Both paths use the same recovery.
  action attest = s' = { ...s, attested: true, label: "attest" }
  action turnOffOld = s' = { ...s, oldOff: true, active: s.active.exclude(Set(0)), label: "oldOff" }
  action forcedRecovery = if (not(localReady)) idle else s' = { ...s, recovery: true, quarantined: true, reviewed: false, restoredPending: true,
    incarnation: s.nextInc, nextInc: s.nextInc + 1, identities: s.identities.union(Set(s.nextInc)),
    journal: List(), nextSeq: 1, resumed: false,
    approvals: Set(), unknown: s.consumed.exclude(s.receipts), label: "forcedRecovery" }
  action review = if (not(localReady)) idle else s' = { ...s, reviewed: true, approvals: Set(), restoredPending: false, label: "review" }
  action activateWith(guard: bool): bool = if (not(localReady)) idle else
    if (not(s.reviewed and s.attested) or (guard and (not(s.deletionKnown) or
      (s.restoring and (not(s.installed) or s.installedGen < s.deletion))))) idle else
    s' = { ...s, recovery: false, quarantined: false, active: s.active.union(Set(1)),
      epoch: s.epoch.set(1, s.epoch.get(0) + 1), actualOwner: 1, label: "activate" }

  action activate = activateWith(true)

  val singleLocalOwner = s.writers.union(s.io).size() <= 1 and
    (s.writers.union(s.io) == Set() or (s.referenced and s.writers.union(s.io) == Set(s.lock)))
  val lockBeforeWrite = not(Set("inbox", "submit", "submitted", "project", "approve", "consume", "receipt",
    "rotate", "resume", "transfer", "checkpoint", "releaseOwner", "snapshot", "export", "install",
    "publishRelease", "encrypt", "manifest", "beginRestore", "replay", "redact", "shred", "forcedRecovery", "review", "activate").contains(s.label)) or
    (before.referenced and before.lock != -1 and before.writers == Set(before.lock))
  val acknowledgedInputDurable = s.ack.subseteq(s.inbox)
  val projectionPrefix = s.archive.listSet().forall(e =>
    s.archive.select(x => x.inc == e.inc and x.pos == e.pos).length() == 1 and
    s.archive.select(x => x.inc == e.inc and x.pos <= e.pos).length() == e.pos) and
    1.to(16).forall(i => s.archive.select(e => e.inc == i).length() == s.cursor.get(i))
  val journalIdentityUnique = (s.label == "rotate" or s.label == "install" or s.label == "forcedRecovery") implies
    (not(before.identities.contains(s.incarnation)) and s.identities.contains(s.incarnation))
  val ordinaryCrashPreservesCommittedAuthority = s.label == "crash" implies
    (s.inbox == before.inbox and s.approvals == before.approvals and s.consumed == before.consumed and
      s.receipts == before.receipts and s.authorizations == before.authorizations and s.archive == before.archive)
  val transferCheckpointComplete = not(s.successor) or (s.checkpointComplete and s.released and
    not(s.active.contains(0)) and s.checkpoint == s.position)
  val restoreDoesNotAuthorize = s.label == "install" implies (s.recovery and s.quarantined and
    s.approvals == Set() and s.active == Set() and s.snapshotConsumed.exclude(s.snapshotReceipt).subseteq(s.unknown))
  val backupChainComplete = s.label != "install" or (s.fresh and s.candidate.authenticated and s.candidate.schema == 1 and
    s.installedPosition == s.candidate.head and positions.filter(p => p >= s.candidate.snapshot and p < s.candidate.head).forall(p =>
      s.segments.exists(x => x.gen == s.candidate.gen and x.from == p and x.to == p + 1 and x.prev == p and x.hash == p + 1)))
  val restoreRespectsDeletion = (s.label != "install" or (s.deletionKnown and s.installedGen >= s.deletion)) and
    (s.label != "activate" or (before.deletionKnown and (not(before.restoring) or
      (before.installed and before.installedGen >= before.deletion))))
  val staleOwnerCannotAuthorize = s.authorizations.exclude(before.authorizations).forall(a => a.device == before.actualOwner and a.epoch == before.epoch.get(before.actualOwner))
  val journalRollbackStopsResume = s.label != "resume" or (s.nextSeq - 1 >= s.cursor.get(s.incarnation) and s.supported)
  val bridgeDedupe = s.journal.listSet().forall(e => s.journal.select(x => x.inc == e.inc and x.op == e.op).length() == 1)
  val exportAfterManifest = s.exportCursor <= s.manifest.head
  val encryptionNonceFresh = s.encryptions.listSet().size() == s.encryptions.length()
  val backupSanitized = s.manifest.gen < s.deletion or s.backupSources.intersect(s.removed) == Set()
  val generationKeyAvailable = not(s.destroyedKeys.contains(s.manifest.gen))
  val releaseBeforePublication = not(s.releasePublished) or s.released
  // staleOwnerCannotAuthorize is checked separately: folder-only forced
  // recovery cannot satisfy it. Safety never quietly assumes an external fence.
  val finiteDomains = generations.contains(s.gen) and generations.contains(s.incarnation) and
    positions.contains(s.position) and positions.contains(s.manifest.snapshot) and positions.contains(s.manifest.head) and
    positions.contains(s.candidate.snapshot) and positions.contains(s.candidate.head) and positions.contains(s.staged)
  val safety = finiteDomains and singleLocalOwner and lockBeforeWrite and acknowledgedInputDurable and projectionPrefix and journalIdentityUnique and
    ordinaryCrashPreservesCommittedAuthority and transferCheckpointComplete and restoreDoesNotAuthorize and
    backupChainComplete and restoreRespectsDeletion and journalRollbackStopsResume and bridgeDedupe and
    exportAfterManifest and encryptionNonceFresh and releaseBeforePublication and backupSanitized and generationKeyAvailable
  val backupCaughtUp = s.manifest.gen == s.gen and s.manifest.head == s.position and s.exportCursor == s.position
  val transferDone = not(s.transfer) or s.successor
  val keysRetired = generations.filter(g => g < s.gen).subseteq(s.destroyedKeys)
  val settled = backupCaughtUp and transferDone and keysRetired
  val reachedAgreement = s.sealed and s.label == "finished" and settled
  val drainBound = remaining > 0 or reachedAgreement
  val invariants = safety and drainBound
  val cooperativeSafety = invariants and staleOwnerCannotAuthorize
  action seal = s' = { ...s, sealed: true, label: "seal" }
  action progress =
    if (s.writers == Set()) acquire(0) else
    if (s.transfer and not(s.successor)) {
      if (not(s.drained)) drain else if (s.checkpoint < 0) checkpoint(true) else
      if (not(s.released)) releaseOwner else if (not(s.releasePublished)) publishRelease(true) else installSuccessor(true)
    } else if (s.manifest.gen != s.gen) snapshot else
    if (s.manifest.head < s.position) {
      if (s.segments.exists(x => x.gen == s.gen and x.from == s.manifest.head and x.prev == s.manifest.hash)) publishManifest(true)
      else encrypt(true)
    } else if (s.exportCursor != s.manifest.head) persistExport(true) else if (not(keysRetired)) shred(true) else s' = { ...s, label: "finished" }
  action tick(a: bool): bool = all { a, before' = s, pc' = pc + 1, scenario' = scenario,
    remaining' = if (s.sealed and not(reachedAgreement)) remaining - 1 else remaining }
  action input = {
    nondet op = 1.to(capacity).oneOf()
    any { all { s.position < 6, acceptInput(op, true) }, acknowledge(op, true), resetBridge,
      submit(op, true), markSubmitted(op), project(true), approve, consume, receipt,
      all { s.incarnation < 8, rotate(true) }, crash(true), acquire(0), acquire(1), collect(true),
      openJournal(true), beginTransfer, snapshot, encrypt(true), publishManifest(true), persistExport(true), seal }
  }
  // Once transfer begins there are no new archive/authority writes. The
  // checkpoint is final; backup-file progress does not change its position.
  action simulationStep = all { not(reachedAgreement), tick(if (s.sealed) progress else
    if (s.transfer) any { seal, progress } else input) }
  temporal transferEventuallyCompletes = progress.weakFair(s).implies(eventually(always(s.sealed and s.transfer)).implies(eventually(always(s.successor))))
  temporal backupEventuallyCatchesUp = progress.weakFair(s).implies(eventually(always(s.sealed)).implies(eventually(always(backupCaughtUp))))

  type Command = { op: str, k: int }
  pure def c(op: str, k: int): Command = { op: op, k: k }
  action execute(cmd: Command, bug: str): bool = {
    val op = cmd.op
    val k = cmd.k
    if (op == "inbox") acceptInput(k, bug != "inbox") else
    if (op == "ack") acknowledge(k, bug != "inbox") else
    if (op == "reset") resetBridge else
    if (op == "submit") submit(k, bug != "bridge") else
    if (op == "submitted") markSubmitted(k) else
    if (op == "project") project(bug != "projection") else
    if (op == "approve") approve else if (op == "consume") consume else if (op == "receipt") receipt else
    if (op == "crash") crash(bug != "authority") else
    if (op == "acquire") acquire(k) else if (op == "collect") collect(bug != "lockGC") else
    if (op == "io") startIO else if (op == "unlock") releaseLock(bug != "earlyUnlock") else
    if (op == "stopIO") stopIO else
    if (op == "rollback") rollbackJournal else if (op == "open") openJournal(bug != "rollback") else
    if (op == "rotate") rotate(bug != "identity") else
    if (op == "unsupported") s' = { ...s, supported: false, label: "schema" } else
    if (op == "transfer") beginTransfer else if (op == "drain") drain else
    if (op == "checkpoint") checkpoint(bug != "checkpoint") else
    if (op == "releaseOwner") releaseOwner else if (op == "publishRelease") publishRelease(bug != "release") else
    if (op == "successor") installSuccessor(bug != "checkpoint") else if (op == "reboot") rebootOld else
    if (op == "authorize") authorize(k) else
    if (op == "readEpoch") s' = { ...s, cachedEpoch: s.epoch.get(0), label: "readEpoch" } else
    if (op == "snapshot") snapshotWith(bug != "sanitize") else if (op == "encrypt") encrypt(bug != "nonce") else
    if (op == "manifest") publishManifest(true) else
    if (op == "earlyManifest") publishManifest(false) else
    if (op == "export") persistExport(bug != "export") else
    if (op == "beginRestore") beginRestore(bug != "auth") else
    if (op == "replay") replay(bug != "gap") else if (op == "install") install(bug != "deletion" and bug != "auth") else
    if (op == "restore") unsafeRestore(bug != "restore") else
    if (op == "redact") redact else if (op == "shred") shred(bug != "shred") else
    if (op == "deliver") s' = { ...s, segments: s.segments.union(Set({ gen: s.candidate.gen,
      from: s.candidate.snapshot, to: s.candidate.head, prev: s.candidate.snapshot,
      hash: s.candidate.hash, nonce: 99 })), label: "deliver" } else
    if (op == "tamper") s' = { ...s, manifest: { ...s.manifest, authenticated: false }, label: "tamper" } else
    if (op == "force") forcedRecovery else if (op == "attest") attest else if (op == "review") review else
    if (op == "missingDeletion") s' = { ...s, deletionKnown: false, label: "missingDeletion" } else
    if (op == "activate") activateWith(bug != "deletionAuthority") else if (op == "oldOff") {
      if (bug == "stale") idle else turnOffOld
    } else idle
  }
  action script(commands: List[Command], bug: str): bool = all { not(reachedAgreement),
    tick(if (pc < commands.length()) execute(commands.nth(pc), bug) else if (not(s.sealed)) seal else
      if (bug == "drain") s' = { ...s, label: "idle" } else
      if (bug == "feedback" and s.manifest.head == s.position and s.exportCursor != s.manifest.head) persistExportFeedback else progress) }
  pure val lockHandle = List(c("collect", 1), c("acquire", 1))
  action lockHandleStep = script(lockHandle, "")
  action lockHandleBugStep = script(lockHandle, "lockGC")
  pure val lockLifetime = List(c("io", 1), c("unlock", 1), c("acquire", 1))
  action lockLifetimeStep = script(lockLifetime, "")
  action lockLifetimeBugStep = script(lockLifetime, "earlyUnlock")
  pure val inboxPowerLoss = List(c("inbox", 1), c("ack", 1), c("crash", 1))
  action inboxPowerLossStep = script(inboxPowerLoss, "")
  action inboxPowerLossBugStep = script(inboxPowerLoss, "inbox")
  pure val bridgeReplay = List(c("inbox", 1), c("reset", 1), c("submit", 1), c("crash", 1), c("acquire", 0), c("reset", 1), c("submit", 1))
  action bridgeReplayStep = script(bridgeReplay, "")
  action bridgeReplayBugStep = script(bridgeReplay, "bridge")
  pure val projectionCommit = List(c("inbox", 1), c("ack", 1), c("reset", 1), c("submit", 1), c("submitted", 1), c("project", 1))
  action projectionCommitStep = script(projectionCommit, "")
  action projectionCommitBugStep = script(projectionCommit, "projection")
  pure val journalRollback = List(c("inbox", 1), c("ack", 1), c("reset", 1), c("submit", 1), c("submitted", 1), c("project", 1), c("rollback", 1), c("open", 1))
  action journalRollbackStep = script(journalRollback, "")
  action journalRollbackBugStep = script(journalRollback, "rollback")
  pure val rotationIdentity = List(c("inbox", 1), c("ack", 1), c("reset", 1), c("submit", 1), c("submitted", 1), c("project", 1), c("rotate", 1))
  action rotationIdentityStep = script(rotationIdentity, "")
  action rotationIdentityBugStep = script(rotationIdentity, "identity")
  pure val authorityCrash = List(c("approve", 1), c("consume", 1), c("crash", 1))
  action authorityCrashStep = script(authorityCrash, "")
  action authorityCrashBugStep = script(authorityCrash, "authority")
  pure val incompleteCheckpoint = List(c("inbox", 1), c("reset", 1), c("submit", 1), c("transfer", 1), c("checkpoint", 1), c("releaseOwner", 1), c("publishRelease", 1), c("successor", 1))
  action incompleteCheckpointStep = script(incompleteCheckpoint, "")
  action incompleteCheckpointBugStep = script(incompleteCheckpoint, "checkpoint")
  pure val releaseCrash = List(c("transfer", 1), c("drain", 1), c("checkpoint", 1), c("publishRelease", 1), c("crash", 1), c("reboot", 1), c("successor", 1))
  action releaseCrashStep = script(releaseCrash, "")
  action releaseCrashBugStep = script(releaseCrash, "release")
  pure val restoreApproval = List(c("approve", 1), c("snapshot", 1), c("consume", 1), c("receipt", 1), c("beginRestore", 1), c("restore", 1))
  action restoreApprovalStep = script(restoreApproval, "")
  action restoreApprovalBugStep = script(restoreApproval, "restore")
  pure val restoreAttempt = List(c("approve", 1), c("consume", 1), c("snapshot", 1), c("receipt", 1), c("beginRestore", 1), c("restore", 1))
  action restoreAttemptStep = script(restoreAttempt, "")
  action restoreAttemptBugStep = script(restoreAttempt, "restore")
  pure val manifestBeforeSegment = List(c("snapshot", 1), c("inbox", 1), c("earlyManifest", 1), c("beginRestore", 1), c("replay", 1), c("install", 1), c("deliver", 1), c("replay", 1), c("install", 1))
  action manifestBeforeSegmentStep = script(manifestBeforeSegment, "")
  action manifestBeforeSegmentBugStep = script(manifestBeforeSegment, "gap")
  pure val redactionDuringRestore = List(c("inbox", 1), c("snapshot", 1), c("beginRestore", 1), c("redact", 1), c("install", 1))
  action redactionDuringRestoreStep = script(redactionDuringRestore, "")
  action redactionDuringRestoreBugStep = script(redactionDuringRestore, "deletion")
  pure val unauthenticatedManifest = List(c("snapshot", 1), c("tamper", 1), c("beginRestore", 1), c("install", 1))
  action unauthenticatedManifestStep = script(unauthenticatedManifest, "")
  action unauthenticatedManifestBugStep = script(unauthenticatedManifest, "auth")
  pure val exportCrash = List(c("snapshot", 1), c("inbox", 1), c("encrypt", 1), c("export", 1), c("crash", 1))
  action exportCrashStep = script(exportCrash, "")
  action exportCrashBugStep = script(exportCrash, "export")
  pure val nonceAfterCrash = List(c("inbox", 1), c("encrypt", 1), c("crash", 1), c("acquire", 0), c("encrypt", 1))
  action nonceAfterCrashStep = script(nonceAfterCrash, "")
  action nonceAfterCrashBugStep = script(nonceAfterCrash, "nonce")
  pure val sanitizedGeneration = List(c("inbox", 1), c("snapshot", 1), c("redact", 1), c("snapshot", 1))
  action sanitizedGenerationStep = script(sanitizedGeneration, "")
  action sanitizedGenerationBugStep = script(sanitizedGeneration, "sanitize")
  pure val shredBeforeSnapshot = List(c("inbox", 1), c("snapshot", 1), c("redact", 1), c("shred", 1))
  action shredBeforeSnapshotStep = script(shredBeforeSnapshot, "")
  action shredBeforeSnapshotBugStep = script(shredBeforeSnapshot, "shred")
  pure val partitionedOwner = List(c("attest", 1), c("force", 1), c("oldOff", 1), c("review", 1), c("activate", 1), c("authorize", 0))
  action partitionedOwnerStep = script(partitionedOwner, "")
  action partitionedOwnerBugStep = script(partitionedOwner, "stale")
  pure val epochReadRace = List(c("readEpoch", 1), c("attest", 1), c("force", 1), c("oldOff", 1), c("review", 1), c("activate", 1), c("authorize", 0))
  action epochReadRaceStep = script(epochReadRace, "")
  action epochReadRaceBugStep = script(epochReadRace, "stale")
  pure val transferDrain = List(c("inbox", 1), c("reset", 1), c("submit", 1), c("transfer", 1))
  action transferDrainStep = script(transferDrain, "")
  action transferDrainBugStep = script(transferDrain, "drain")
  pure val backupDrain = List(c("inbox", 1))
  action backupDrainStep = script(backupDrain, "")
  action backupDrainBugStep = script(backupDrain, "drain")
  pure val exportFeedback = List(c("inbox", 1))
  action exportFeedbackStep = script(exportFeedback, "")
  action exportFeedbackBugStep = script(exportFeedback, "feedback")
  pure val missingDeletion = List(c("snapshot", 1), c("missingDeletion", 1), c("beginRestore", 1), c("install", 1),
    c("attest", 1), c("review", 1), c("activate", 1))
  action missingDeletionStep = script(missingDeletion, "")
  action missingDeletionBugStep = script(missingDeletion, "deletionAuthority")
  action suiteInit = { nondet which = 0.to(24).oneOf(); all { s' = initial, before' = initial, pc' = 0, remaining' = drainLimit, scenario' = which } }
  val suiteCommands = List(lockHandle, lockLifetime, inboxPowerLoss, bridgeReplay, projectionCommit, journalRollback, rotationIdentity, authorityCrash, incompleteCheckpoint, releaseCrash, restoreApproval, restoreAttempt, manifestBeforeSegment, redactionDuringRestore, unauthenticatedManifest, exportCrash, nonceAfterCrash, sanitizedGeneration, shredBeforeSnapshot, partitionedOwner, epochReadRace, transferDrain, backupDrain, exportFeedback, missingDeletion).nth(scenario)
  action suiteStep = script(suiteCommands, "")
  val case0 = scenario == 0 and reachedAgreement and (s.writers == Set(0) and s.referenced)
  val case1 = scenario == 1 and reachedAgreement and (s.io == Set(0))
  val case2 = scenario == 2 and reachedAgreement and (s.ack == Set(1) and s.inbox == Set(1))
  val case3 = scenario == 3 and reachedAgreement and (s.journal.length() == 1)
  val case4 = scenario == 4 and reachedAgreement and (s.archive.length() == 1)
  val case5 = scenario == 5 and reachedAgreement and (s.incarnation == 2 and s.interrupted == Set(1) and not(s.resumed))
  val case6 = scenario == 6 and reachedAgreement and (s.incarnation == 2)
  val case7 = scenario == 7 and reachedAgreement and (s.consumed == Set(1))
  val case8 = scenario == 8 and reachedAgreement and (s.successor and s.archive.length() == 1)
  val case9 = scenario == 9 and reachedAgreement and (s.successor and s.released)
  val case10 = scenario == 10 and reachedAgreement and (s.installed and s.recovery and s.approvals == Set())
  val case11 = scenario == 11 and reachedAgreement and (s.installed and s.unknown == Set(1))
  val case12 = scenario == 12 and reachedAgreement and (s.installed and s.installedPosition == 1)
  val case13 = scenario == 13 and reachedAgreement and (not(s.installed) and s.manifest.gen == 2)
  val case14 = scenario == 14 and reachedAgreement and (not(s.installed))
  val case15 = scenario == 15 and reachedAgreement and (s.exportCursor == 1)
  val case16 = scenario == 16 and reachedAgreement and (s.encryptions.listSet().size() == 2)
  val case17 = scenario == 17 and reachedAgreement and (s.backupSources == Set())
  val case18 = scenario == 18 and reachedAgreement and (s.destroyedKeys == Set(1) and s.manifest.gen == 2)
  val case19 = scenario == 19 and reachedAgreement and (s.oldOff and s.actualOwner == 1)
  val case20 = scenario == 20 and reachedAgreement and (s.oldOff and s.actualOwner == 1)
  val case21 = scenario == 21 and reachedAgreement and (s.successor)
  val case22 = scenario == 22 and reachedAgreement and (s.manifest.head == 1)
  val case23 = scenario == 23 and reachedAgreement and s.manifest.head == 1
  val case24 = scenario == 24 and reachedAgreement and not(s.installed) and not(s.active.contains(1))
  // Positive crash witnesses beyond the broken/corrected pairs.
  action journalAheadStep = script(List(c("inbox", 1), c("reset", 1), c("submit", 1),
    c("crash", 1), c("acquire", 0), c("open", 1), c("project", 1)), "")
  action unsupportedSchemaStep = script(List(c("unsupported", 1), c("open", 1)), "")
  action cooperativeTransferStep = script(List(c("inbox", 1), c("reset", 1), c("submit", 1),
    c("transfer", 1)), "")
  action reviewedRestoreStep = script(List(c("approve", 1), c("snapshot", 1), c("beginRestore", 1), c("install", 1),
    c("attest", 1), c("oldOff", 1), c("review", 1), c("activate", 1), c("authorize", 1)), "")
  action boundedStep = tick(any {
    acceptInput(1, true), acknowledge(1, true), crash(true), acquire(0), acquire(1), collect(true)
  })
  val boundedSafety = singleLocalOwner and acknowledgedInputDurable and ordinaryCrashPreservesCommittedAuthority
  action boundedRace(guard: bool): bool = tick(
    if (pc == 0) collect(guard) else if (pc == 1) acquire(1) else idle)
  action boundedRaceStep = boundedRace(true)
  action boundedRaceBugStep = boundedRace(false)
}
module agent_recovery { import recoveryProtocol(capacity = 2, drainLimit = 64).* }
module agent_recovery_bounded { import recoveryProtocol(capacity = 1, drainLimit = 64).* }
