// What a removal reaches (plan v3 §4.5, L2), as properties of the pure rules over random archives: every chunk
// of the message goes, a resent message goes with every copy, Juno's reply goes only when asked and only what
// its turn wrote, other inputs stay, and every run that could have carried the message is found.
import fc from 'fast-check'
import { expect, it } from 'bun:test'
import { removalScope, replyOf, runsThatSaw, type ArchiveRow, type MessageKind, type OpRow, type RunRow } from '../src/redaction/scope'

type Turn = { readonly kind: 'user' | 'card' | 'wake' | 'work'; readonly chunks: number; readonly retryOf: number | undefined; readonly after: ReadonlyArray<{ kind: 'juno' | 'tool'; chunks: number }> }

const turn: fc.Arbitrary<Turn> = fc.record({
  kind: fc.constantFrom('user', 'user', 'card', 'wake', 'work'),
  chunks: fc.integer({ min: 1, max: 3 }),
  retryOf: fc.option(fc.nat(10), { nil: undefined }),
  after: fc.array(fc.record({ kind: fc.constantFrom('juno', 'tool'), chunks: fc.integer({ min: 1, max: 2 }) }), { maxLength: 4 }),
})

/** An archive as projection writes it: each input entry, then what followed it, every entry split into chunks. */
function build(turns: ReadonlyArray<Turn>) {
  const archive: ArchiveRow[] = []
  const ops: OpRow[] = []
  let entry = 0
  const push = (kind: MessageKind, chunks: number, originOp: string) => {
    entry += 1
    for (let c = 0; c < chunks; c++) archive.push({ id: archive.length, kind, originOp, entry: `inc/${entry}` })
  }
  turns.forEach((t, i) => {
    const opId = `op-${i}`
    const retryOf = t.retryOf !== undefined && t.retryOf < i ? `op-${t.retryOf}` : undefined
    ops.push(retryOf === undefined ? { opId } : { opId, retryOf })
    push(t.kind, t.chunks, opId)
    for (const a of t.after) push(a.kind, a.chunks, opId)
  })
  return { archive, ops }
}

const family = (ops: ReadonlyArray<OpRow>, opId: string): ReadonlySet<string> => {
  // Connected through retryOf, either way.
  const linked = new Set([opId])
  for (let grew = true; grew; ) {
    grew = false
    for (const op of ops) {
      if (op.retryOf === undefined) continue
      if (linked.has(op.opId) !== linked.has(op.retryOf)) {
        linked.add(op.opId)
        linked.add(op.retryOf)
        grew = true
      }
    }
  }
  return linked
}

const archiveWithTarget = fc.array(turn, { minLength: 1, maxLength: 8 }).chain((turns) => {
  const built = build(turns)
  return fc.record({ built: fc.constant(built), target: fc.integer({ min: 0, max: built.archive.length - 1 }), reply: fc.boolean() })
})

it('removes every chunk of the message, and of every copy of a resent input', () => {
  fc.assert(fc.property(archiveWithTarget, ({ built: { archive, ops }, target, reply }) => {
    const scope = removalScope(archive, ops, [target], reply)
    const removed = new Set(scope.messages)
    const row = archive[target]!
    for (const r of archive) if (r.entry === row.entry) expect(removed.has(r.id)).toBe(true)
    if (row.kind === 'juno' || row.kind === 'tool') return
    const copies = family(ops, row.originOp!)
    expect<ReadonlySet<string>>(new Set(scope.ops)).toEqual(copies)
    for (const r of archive) if (copies.has(r.originOp!) && r.kind !== 'juno' && r.kind !== 'tool') expect(removed.has(r.id)).toBe(true)
  }))
})

it("takes Juno's reply only when asked, only what Juno's turn wrote, and nothing of another input", () => {
  fc.assert(fc.property(archiveWithTarget, ({ built: { archive, ops }, target }) => {
    const without = removalScope(archive, ops, [target], false)
    const withReply = removalScope(archive, ops, [target], true)
    const targetEntry = archive[target]!.entry
    for (const id of without.messages) expect(withReply.messages).toContain(id)
    for (const id of withReply.messages) {
      const row = archive[id]!
      if (row.entry === targetEntry) continue
      // Anything beyond the message itself belongs to the removed inputs: their words, or Juno's reply when asked.
      expect<ReadonlyArray<string | null>>(withReply.ops).toContain(row.originOp)
      if (!without.messages.includes(id)) expect(['juno', 'tool']).toContain(row.kind)
    }
    for (const id of without.messages) if (archive[id]!.entry !== targetEntry) expect(['juno', 'tool']).not.toContain(archive[id]!.kind)
  }))
})

it('removing the same messages again, or a message already gone, adds nothing', () => {
  fc.assert(fc.property(archiveWithTarget, ({ built: { archive, ops }, target, reply }) => {
    const first = removalScope(archive, ops, [target], reply)
    expect(removalScope(archive, ops, [target, ...first.messages], reply)).toEqual(first)
    const left = archive.filter((row) => !first.messages.includes(row.id))
    expect(removalScope(left, ops, first.messages, reply).messages).toEqual([])
  }))
})

it("offers Juno's reply only when a Juno message follows the input", () => {
  fc.assert(fc.property(archiveWithTarget, ({ built: { archive }, target }) => {
    const reply = replyOf(archive, target)
    const row = archive[target]!
    if (reply === undefined) {
      expect(row.kind === 'juno' || row.kind === 'tool' || !archive.some((r) => r.id > target && r.kind === 'juno' && r.originOp === row.originOp)).toBe(true)
    } else {
      expect(archive[reply]).toMatchObject({ kind: 'juno', originOp: row.originOp })
      expect(reply).toBeGreaterThan(target)
    }
  }))
})

it('finds every run that could have carried a removed message, and no run that ended before it', () => {
  const runs = fc.array(fc.record({ h: fc.nat(40), ops: fc.array(fc.constantFrom('op-0', 'op-1', 'op-2', 'op-3'), { maxLength: 2 }) }), { maxLength: 6 })
  fc.assert(fc.property(archiveWithTarget, runs, ({ built: { archive, ops }, target }, raw) => {
    const all: RunRow[] = raw.map((r, i) => ({ id: `run-${i}`, h: r.h, ops: r.ops }))
    const removed = removalScope(archive, ops, [target], true).messages
    const saw = new Set(runsThatSaw(all, archive, removed))
    const first = Math.min(...removed)
    for (const run of all) {
      if (run.h > first) expect(saw.has(run.id)).toBe(true)
      else expect(saw.has(run.id)).toBe(run.ops.includes(archive[first]!.originOp!))
    }
  }))
})
