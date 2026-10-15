// The merge rules of ADR 0011 as a table: what wins when a page, an event
// and an edit arrive in any order.
import { describe, expect, it } from 'vitest'
import { Ts, type Message } from '@juno/slack-schema'
import { mergeMessage, mergeRootCounters, mergeTombstone, stubRoot, toMessageRow } from '../src/index'

const C = 'C0ENG'
const ts = (n: number): Ts => Ts.make(`1700000${String(n).padStart(3, '0')}.000100`)
const message = (overrides: Partial<Message> & { ts: string }): Message => ({ type: 'message', user: 'U0MAYA', text: 'hello', ...overrides }) as Message
const page = (at: number) => ({ kind: 'page' as const, requestedAt: ts(at) })
const event = (at: number) => ({ kind: 'event' as const, eventTs: ts(at) })
const partial = (at: number) => ({ kind: 'partial' as const, requestedAt: ts(at) })

describe('mergeMessage', () => {
  it('keeps bot identity through partial and older content, and accepts newer edits', () => {
    const original = message({ ts: ts(1), bot_id: 'B0TEST', username: 'Build helper', bot_profile: { id: 'B0TEST', icons: { image_72: 'https://example.test/build.png' } }, edited: { ts: ts(3) } })
    const stored = toMessageRow(C, original)
    const partial = mergeMessage(stored, message({ ts: ts(1) }), C, { kind: 'partial', requestedAt: ts(4) })
    expect(partial.row.bot_name).toBe('Build helper')
    const stale = mergeMessage(stored, { ...original, username: 'Old helper', edited: { ts: ts(2) } }, C, page(5))
    expect(stale.row.bot_name).toBe('Build helper')
    const updated = mergeMessage(stored, { ...original, username: 'Release helper', edited: { ts: ts(6) } }, C, event(6))
    expect(updated.row).toMatchObject({ bot_name: 'Release helper', bot_icon: 'https://example.test/build.png' })
  })

  it('stores a new message and takes reactions from any source', () => {
    const merged = mergeMessage(undefined, message({ ts: ts(1), reactions: [{ name: 'eyes', users: ['U0LEO'], count: 1 }] }), C, page(5))
    expect(merged.changed).toBe(true)
    expect(merged.applyReactions).toBe(true)
    expect(merged.row).toMatchObject({ channel: C, ts: ts(1), text: 'hello', deleted: 0, version: 0 })
  })

  it('an edit applies only when its edited_ts is newer; older content never replaces it', () => {
    const stored = toMessageRow(C, message({ ts: ts(1), text: 'typo here', edited: { user: 'U0MAYA', ts: ts(3) } }))
    const stale = mergeMessage(stored, message({ ts: ts(1), text: 'typo hear' }), C, page(2))
    expect(stale.changed).toBe(false)
    expect(stale.row.text).toBe('typo here')
    const older = mergeMessage(stored, message({ ts: ts(1), text: 'typo hear', edited: { user: 'U0MAYA', ts: ts(2) } }), C, event(2))
    expect(older.row.text).toBe('typo here')
    const newer = mergeMessage(stored, message({ ts: ts(1), text: 'typo fixed', edited: { user: 'U0MAYA', ts: ts(4) } }), C, event(4))
    expect(newer.changed).toBe(true)
    expect(newer.row).toMatchObject({ text: 'typo fixed', edited_ts: ts(4), version: 1 })
  })

  it('a tombstone always wins, whatever arrives after it', () => {
    const stored = toMessageRow(C, message({ ts: ts(1) }))
    const deleted = mergeTombstone(stored, C, ts(1), event(2))
    expect(deleted.row).toMatchObject({ deleted: 1, text: '' })
    const late = mergeMessage(deleted.row, message({ ts: ts(1), text: 'back from the dead' }), C, page(1))
    expect(late.changed).toBe(false)
    expect(late.row.deleted).toBe(1)
    expect(late.applyReactions).toBe(false)
  })

  it('reply counters take the maximum and never go down from a stale page', () => {
    const stored = toMessageRow(C, message({ ts: ts(1), reply_count: 5, latest_reply: ts(9) }))
    const stale = mergeMessage(stored, message({ ts: ts(1), reply_count: 3, latest_reply: ts(7) }), C, page(8))
    expect(stale.row).toMatchObject({ reply_count: 5, latest_reply: ts(9) })
    const bumped = mergeRootCounters(stored, { reply_count: 6, latest_reply: ts(10), reply_users: ['U0LEO'] }, event(10))
    expect(bumped.changed).toBe(true)
    expect(bumped.row).toMatchObject({ reply_count: 6, latest_reply: ts(10), reply_users_json: '["U0LEO"]', last_event_ts: ts(10) })
  })

  it('reactions from a page apply only when no event touched the message after the request started', () => {
    const stored = { ...toMessageRow(C, message({ ts: ts(1) })), last_event_ts: ts(6) }
    const before = mergeMessage(stored, message({ ts: ts(1), reactions: [] }), C, page(5))
    expect(before.applyReactions).toBe(false)
    const after = mergeMessage(stored, message({ ts: ts(1), reactions: [] }), C, page(7))
    expect(after.applyReactions).toBe(true)
    const fromEvent = mergeMessage(stored, message({ ts: ts(1), reactions: [] }), C, event(8))
    expect(fromEvent.applyReactions).toBe(true)
    expect(fromEvent.row.last_event_ts).toBe(ts(8))
  })

  it('a stub root keeps the counters it learned and is filled in by the page that brings the root', () => {
    const stub = stubRoot(C, ts(1), { ts: ts(2), user: 'U0LEO' })
    expect(stub).toMatchObject({ ts: ts(1), thread_ts: ts(1), text: '', reply_count: 1, latest_reply: ts(2) })
    const filled = mergeMessage(stub, message({ ts: ts(1), text: 'the root', reply_count: 1, latest_reply: ts(2) }), C, page(3))
    expect(filled.changed).toBe(true)
    expect(filled.row).toMatchObject({ text: 'the root', user_id: 'U0MAYA', reply_count: 1 })
  })

  it('a search match never replaces stored content: files, blocks and reactions stay; counters and the thread move', () => {
    const file = { id: 'F1', name: 'plan.pdf' } as NonNullable<Message['files']>[number]
    const blocks = [{ type: 'rich_text', elements: [] }] as unknown as Message['blocks']
    const stored = toMessageRow(C, message({ ts: ts(1), text: 'the plan', files: [file], blocks, reply_count: 2, latest_reply: ts(3) }))
    const match = mergeMessage(stored, message({ ts: ts(1), text: 'the plan', reply_count: 4, reactions: [] }), C, partial(5))
    expect(match.applyReactions).toBe(false)
    expect(match.row).toMatchObject({ text: 'the plan', files_json: stored.files_json, blocks_json: stored.blocks_json, reply_count: 4 })
    expect(match.row.files_json).not.toBeNull()

    // A reply stored without its thread learns it from the match.
    const orphan = toMessageRow(C, message({ ts: ts(2), text: 'a reply' }))
    expect(mergeMessage(orphan, message({ ts: ts(2), text: 'a reply', thread_ts: ts(1) }), C, partial(5)).row.thread_ts).toBe(ts(1))

    // A stub root is filled by the match, and a message the store lacks is created from it.
    const filled = mergeMessage(stubRoot(C, ts(1), { ts: ts(2), user: 'U0LEO' }), message({ ts: ts(1), text: 'the root', reply_count: 1 }), C, partial(3))
    expect(filled.row).toMatchObject({ text: 'the root', user_id: 'U0MAYA' })
    const created = mergeMessage(undefined, message({ ts: ts(4), text: 'new', reactions: [{ name: 'eyes', users: ['U0LEO'], count: 1 }] }), C, partial(5))
    expect(created.row.text).toBe('new')
    expect(created.applyReactions).toBe(false)
  })

  it('a message the store already has verbatim is not a change', () => {
    const stored = toMessageRow(C, message({ ts: ts(1) }))
    const same = mergeMessage(stored, message({ ts: ts(1) }), C, page(2))
    expect(same.changed).toBe(false)
    expect(same.row).toBe(stored)
  })
})
