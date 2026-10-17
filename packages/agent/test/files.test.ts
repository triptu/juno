// Images and text files an owner message gives Juno (SPEC 12, 13.1): what the model gets, in which
// run, what the archive keeps, and what a removal takes. In-process, through the engine's public API.
import { afterEach, expect, it } from 'vitest'
import { reply } from '@juno/agent-testing'
import type { JunoFileInput } from '@juno/agent-contract'
import { say, turnsHarness } from './turns-harness'

let h: Awaited<ReturnType<typeof turnsHarness>> | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

/** A PNG's signature and header: enough for its size to be read, which is all the agent checks. */
function png(width: number, height: number): string {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return Buffer.from(bytes).toString('base64')
}

const chart: JunoFileInput = { _tag: 'image', name: 'chart.png', mimeType: 'image/png', data: png(640, 400), width: 640, height: 400, thumb: 'data:image/webp;base64,AAAA' }
const notes: JunoFileInput = { _tag: 'text', name: 'notes.md', text: 'ship <it> Monday', cut: false }

type Part = { readonly type: string; readonly text?: string; readonly data?: string; readonly mimeType?: string }
const partsOf = (message: unknown): ReadonlyArray<Part> => {
  const content = (message as { content: string | ReadonlyArray<Part> }).content
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}

it('an image goes to the model with its message, in that run only; the archive and later runs keep its mark', async () => {
  h = await turnsHarness()
  h.fake.script([reply(say('A sales chart.')), reply(say('It went up.'))])
  const op = 'op-image'
  expect(h.turns.accept({ opId: op, kind: 'send', text: 'what is this?', files: [chart, notes] })._tag).toBe('accepted')
  await h.ended(op)

  const words = '<message id="n1"><image n="0" name="chart.png" width="640" height="400"/><file name="notes.md">ship &lt;it&gt; Monday</file>what is this?</message>'
  expect(partsOf(h.chatRequests()[0]!.context.messages.at(-1))).toEqual([
    { type: 'text', text: words },
    { type: 'image', data: chart.data, mimeType: 'image/png' },
  ])
  // What the files hold came from elsewhere: the run is not clean.
  expect(h.turns.store.db.prepare('SELECT clean FROM runs WHERE op_id = ?').get(op)).toEqual({ clean: 0 })
  // The archive keeps the words with the marks, never the bytes; a pin takes only the owner's words.
  const archived = h.turns.messages().find((m) => m.opId === op && m.kind === 'user')!
  expect(archived.text).toBe(words)
  expect(h.turns.pins.pinMessage({ messageId: archived.id })).toMatchObject({ _tag: 'changed', pin: { text: 'what is this?' } })
  // Done: the bodies go, the thumbnail stays for the bubble.
  expect(h.turns.store.db.prepare('SELECT n, body IS NULL AS cleared, thumb FROM inbox_files WHERE op_id = ? ORDER BY n').all(op)).toEqual([
    { n: 0, cleared: 1, thumb: chart.thumb },
    { n: 1, cleared: 1, thumb: null },
  ])

  // The next run reads the mark in its memory, and no image.
  const next = h.send('did it go up?')
  await h.ended(next)
  const parts = h.chatRequests()[1]!.context.messages.flatMap(partsOf)
  expect(parts.some((part) => part.type === 'image')).toBe(false)
  expect(parts.some((part) => part.text?.includes('<image n="0" name="chart.png"'))).toBe(true)
})

it('an image that is not what it says is left out, and a removal takes the files with the message', async () => {
  h = await turnsHarness()
  h.fake.script([reply(say('Noted.'))])
  const forged: JunoFileInput = { ...chart, width: 4000, height: 3000 }
  const op = 'op-forged'
  h.turns.accept({ opId: op, kind: 'send', text: 'look', files: [forged, notes] })
  await h.ended(op)
  expect(partsOf(h.chatRequests()[0]!.context.messages.at(-1))).toEqual([
    { type: 'text', text: '<message id="n1"><file name="notes.md">ship &lt;it&gt; Monday</file>look</message>' },
  ])

  const message = h.turns.messages().find((m) => m.opId === op && m.kind === 'user')!
  await h.turns.redaction.remove({ opId: 'op-remove', messageIds: [message.id], alsoRemoveReply: false })
  expect(h.turns.store.db.prepare('SELECT count(*) AS n FROM inbox_files WHERE op_id = ?').get(op)).toEqual({ n: 0 })
  expect(h.turns.store.db.prepare("SELECT json_extract(data, '$.files') AS files FROM inbox WHERE op_id = ?").get(op)).toEqual({ files: null })
})
