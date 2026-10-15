/**
 * What a removal reaches, as pure rules over the records (plan v3 §4.5,
 * L2; SPEC 13.8). The service reads the rows and commits the result.
 *
 * - **A message** is a whole pi entry: every 16 KB chunk of it.
 * - **An owner input** (a send, steer or retry, or a card answer, wake or
 *   report) is every entry the inbox op wrote, and every entry of the op it
 *   retries or that retries it: "Try again" sends the same words under a
 *   new op, so removing one removes all of them.
 * - **Juno's reply** ("Also remove Juno's reply") is everything the run wrote
 *   after those inputs and before the next one: Juno's words and tool calls,
 *   and the tool results, which can echo the owner's words (`remember`).
 * - **The runs that saw it** are the run that held the earliest removed
 *   message and every run that started after it: each request carries the
 *   whole history, through the view or the tail.
 */

export type MessageKind = 'user' | 'juno' | 'tool' | 'echo' | 'work' | 'wake' | 'card' | 'note'

/** One archive row: a chunk of one pi entry. `originOp` is the input the entry follows. */
export interface ArchiveRow {
  readonly id: number
  readonly kind: MessageKind
  readonly originOp: string | null
  /** The pi entry: `<incarnation>/<entry id>`. */
  readonly entry: string
}

/** One inbox op. `retryOf` names the op a "Try again" resends. */
export interface OpRow {
  readonly opId: string
  readonly retryOf?: string
}

export interface Scope {
  /** Archive ids to tombstone, ascending. */
  readonly messages: ReadonlyArray<number>
  /** Inbox ops whose text is cleared. */
  readonly ops: ReadonlyArray<string>
}

/** Kinds an inbox op writes: its own words, not what follows them. */
const INPUT_KINDS: ReadonlySet<MessageKind> = new Set(['user', 'card', 'wake', 'work'])

/** The op, the op it retries, and every retry of either, at any depth: one message sent one or more times. */
function withRetries(opId: string, ops: ReadonlyArray<OpRow>): ReadonlySet<string> {
  const parent = new Map(ops.flatMap((op) => (op.retryOf === undefined ? [] : [[op.opId, op.retryOf] as const])))
  let root = opId
  for (const seen = new Set([root]); parent.has(root) && !seen.has(parent.get(root)!); seen.add(root)) root = parent.get(root)!
  const found = new Set([root])
  for (let grew = true; grew; ) {
    grew = false
    for (const op of ops) {
      if (op.retryOf !== undefined && found.has(op.retryOf) && !found.has(op.opId)) {
        found.add(op.opId)
        grew = true
      }
    }
  }
  return found
}

/**
 * The archive ids and inbox ops a removal of `targets` reaches. A target
 * that is not in the archive, or is already gone, adds nothing.
 */
export function removalScope(archive: ReadonlyArray<ArchiveRow>, ops: ReadonlyArray<OpRow>, targets: ReadonlyArray<number>, alsoRemoveReply: boolean): Scope {
  const byId = new Map(archive.map((row) => [row.id, row]))
  const entries = new Set<string>()
  const inputs = new Set<string>()
  for (const id of targets) {
    const row = byId.get(id)
    if (row === undefined) continue
    entries.add(row.entry)
    if (INPUT_KINDS.has(row.kind) && row.originOp !== null) for (const op of withRetries(row.originOp, ops)) inputs.add(op)
  }
  for (const row of archive) {
    if (row.originOp === null || !inputs.has(row.originOp)) continue
    if (INPUT_KINDS.has(row.kind) || (alsoRemoveReply && (row.kind === 'juno' || row.kind === 'tool'))) entries.add(row.entry)
  }
  return {
    messages: archive.filter((row) => entries.has(row.entry)).map((row) => row.id).toSorted((a, b) => a - b),
    ops: [...inputs].toSorted(),
  }
}

/** The first archive id of Juno's reply to the input at `id`, if one follows it (the "Also remove Juno's reply" offer). */
export function replyOf(archive: ReadonlyArray<ArchiveRow>, id: number): number | undefined {
  const target = archive.find((row) => row.id === id)
  if (target === undefined || target.originOp === null || !INPUT_KINDS.has(target.kind)) return undefined
  return archive.find((row) => row.id > id && row.kind === 'juno' && row.originOp === target.originOp)?.id
}

/** A run: its id, its history cutoff `h` (the archive length before its first input), and its input ops. */
export interface RunRow {
  readonly id: string
  readonly h: number
  readonly ops: ReadonlyArray<string>
}

/** The runs whose requests could carry a removed message (§4.5 step 2). */
export function runsThatSaw(runs: ReadonlyArray<RunRow>, archive: ReadonlyArray<ArchiveRow>, removed: ReadonlyArray<number>): ReadonlyArray<string> {
  if (removed.length === 0) return []
  const first = Math.min(...removed)
  const origin = archive.find((row) => row.id === first)?.originOp ?? null
  return runs.filter((run) => run.h > first || (origin !== null && run.ops.includes(origin))).map((run) => run.id)
}
