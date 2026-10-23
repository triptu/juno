import { afterEach, expect, it } from 'bun:test'
import { reply } from '@juno/agent-testing'
import { say } from './turns-harness'
import { OpId, PinId } from '@juno/agent-contract'
import { Revision } from '@juno/agent-cards'
import { served, run, closeServed } from './serve-harness'

afterEach(closeServed)

it('pins a UTF-8 span, expires Undo, and removes its source while paused', async () => {
  let now = 100_000
  const { h, client, pageWhere } = await served({ now: () => now })
  const opId = OpId.make('menu-message')
  const text = 'My notes: café on Tuesday. Ask first.'
  h.fake.script([reply(say('I have your notes.'))])
  await run(client['agent.chat.send']({ opId, text }))
  await h.turns.idle()
  const menu = await run(client['agent.chat.message']({ target: { _tag: 'owner', opId } }))
  if (menu._tag !== 'Success' || menu.success === null) throw new Error('Missing menu')
  const message = menu.success
  expect(message.sheet.messages[0]?.preview).toBe(text)
  expect(message.sheet.offerReply).toBeDefined()
  now += 1
  const startByte = Buffer.byteLength('My notes: ')
  const endByte = startByte + Buffer.byteLength('café on Tuesday')
  expect(await run(client['agent.remembers.pin']({ opId: OpId.make('pin-span'), messageId: message.messageId, revision: message.revision, startByte, endByte }))).toMatchObject({ _tag: 'Success' })
  const page = await pageWhere((p) => p.items.some((i) => i._tag === 'note' && i.kind === 'remembered'), 'pin note')
  const note = page.items.find((i) => i._tag === 'note' && i.kind === 'remembered')
  expect(note).toMatchObject({ text: 'café on Tuesday', undo: true })
  expect(h.turns.pins.active().active.map((pin) => pin.text)).toEqual(['café on Tuesday'])
  now += 60_001
  await pageWhere((p) => p.items.some((i) => i._tag === 'note' && i.kind === 'remembered' && i.undo === undefined), 'expired Undo')
  h.turns.setMode('paused')
  await run(client['agent.chat.remove']({ opId: OpId.make('remove-source'), messageId: message.messageId, alsoRemoveReply: false }))
  await pageWhere((p) => p.items.some((i) => i._tag === 'note' && i.kind === 'removed'), 'removed')
  expect(h.turns.pins.active().active).toEqual([])
})

it('Undo removes the exact pin and the next send closes Undo on a later pin', async () => {
  let now = 200_000
  const { h, client, pageWhere } = await served({ now: () => now })
  const opId = OpId.make('undo-message')
  await run(client['agent.chat.send']({ opId, text: 'Keep these words' }))
  await h.turns.idle()
  const menu = await run(client['agent.chat.message']({ target: { _tag: 'owner', opId } }))
  if (menu._tag !== 'Success' || menu.success === null) throw new Error('Missing menu')
  const message = menu.success
  const pin = async (op: string) => run(client['agent.remembers.pin']({ opId: OpId.make(op), messageId: message.messageId, revision: message.revision, startByte: 0, endByte: 15 }))
  now += 1
  await pin('first-pin')
  await pin('first-pin')
  expect(h.turns.pins.active().active).toHaveLength(1)
  const first = h.turns.pins.active().active[0]!
  await run(client['agent.remembers.remove']({ opId: OpId.make('undo-pin'), id: PinId.make(first.id), revision: Revision.make(first.version) }))
  await pageWhere((p) => !p.items.some((i) => i._tag === 'note' && i.kind === 'remembered'), 'undone')
  expect(h.turns.pins.active().active).toEqual([])
  now += 1
  await pin('second-pin')
  now += 1
  await run(client['agent.chat.send']({ opId: OpId.make('next-message'), text: 'Next message' }))
  const page = await pageWhere((p) => p.items.some((i) => i._tag === 'owner' && i.opId === 'next-message'), 'next send')
  expect(page.items.find((i) => i._tag === 'note' && i.kind === 'remembered')).not.toHaveProperty('undo')
  expect(await run(client['agent.chat.message']({ target: { _tag: 'owner', opId: OpId.make('missing') } }))).toMatchObject({ _tag: 'Success', success: null })
})
