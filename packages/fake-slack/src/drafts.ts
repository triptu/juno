/**
 * Slack's message drafts, as observed live on 2026-10-27 (research
 * `slack-drafts.md`): one attached draft per channel or thread (a second
 * create there answers `attached_draft_exists`), deleted and sent drafts
 * kept as records that refuse updates (`draft_update_invalid`) and deletes
 * (`draft_delete_invalid`), every write echoed on the socket to the writing
 * client too, and a post that names a draft (`draft_id`, its id or its
 * `client_msg_id`) retiring it with `draft_send`. `client_last_updated_ts`
 * is accepted and not checked: live, only absurd values were refused.
 */
import type { Blocks, Draft, DraftDestination } from '@juno/slack-schema'
import { blocksToText, textToBlocks } from './richtext.ts'
import type { Workspace } from './state.ts'

interface DraftRecord {
  id: string
  clientMsgId: string
  blocks: Blocks
  fileIds: ReadonlyArray<string>
  destinations: ReadonlyArray<DraftDestination>
  isFromComposer: boolean
  dateCreated: number
  lastUpdatedTs: string
  deleted: boolean
  sent: boolean
}

/** Where an attached draft sits: `<channel>` or `<channel>-<thread_ts>`, as the official client keys it. */
const placeKey = (destinations: ReadonlyArray<DraftDestination>): string | undefined => {
  const first = destinations[0]
  if (first?.channel_id === undefined) return undefined
  return first.thread_ts === undefined ? first.channel_id : `${first.channel_id}-${first.thread_ts}`
}

export type DraftFailure = 'attached_draft_exists' | 'draft_not_found' | 'draft_update_invalid' | 'draft_delete_invalid' | 'invalid_channel' | 'invalid_destinations_count'

export class DraftStore {
  readonly #ws: Workspace
  readonly #records = new Map<string, DraftRecord>()
  #next = 0

  constructor(ws: Workspace) {
    this.#ws = ws
  }

  #object(record: DraftRecord): Draft {
    return {
      id: record.id,
      client_msg_id: record.clientMsgId,
      date_created: record.dateCreated,
      last_updated_ts: record.lastUpdatedTs,
      blocks: record.blocks,
      file_ids: [...record.fileIds],
      is_from_composer: record.isFromComposer,
      is_deleted: record.deleted,
      is_sent: record.sent,
      date_scheduled: 0,
      destinations: [...record.destinations],
    }
  }

  #attachedAt(key: string): DraftRecord | undefined {
    for (const record of this.#records.values()) {
      if (!record.isFromComposer && !record.deleted && !record.sent && placeKey(record.destinations) === key) return record
    }
    return undefined
  }

  #checkDestinations(destinations: ReadonlyArray<DraftDestination>): DraftFailure | undefined {
    if (destinations.length !== 1) return 'invalid_destinations_count'
    const channel = destinations[0]?.channel_id
    if (channel === undefined || this.#ws.conversation(channel) === undefined) return 'invalid_channel'
    return undefined
  }

  /** Newest first; `nextTs` is exclusive. */
  list(input: { readonly isActive?: boolean | undefined; readonly limit?: number | undefined; readonly nextTs?: string | undefined }): { readonly drafts: ReadonlyArray<Draft>; readonly hasMore: boolean } {
    const limit = Math.min(input.limit ?? 25, 100)
    const all = [...this.#records.values()]
      .filter((record) => input.isActive !== true || (!record.deleted && !record.sent))
      .filter((record) => input.nextTs === undefined || Number(record.lastUpdatedTs) < Number(input.nextTs))
      .toSorted((a, b) => Number(b.lastUpdatedTs) - Number(a.lastUpdatedTs))
    return { drafts: all.slice(0, limit).map((record) => this.#object(record)), hasMore: all.length > limit }
  }

  create(input: { readonly clientMsgId: string; readonly blocks: Blocks; readonly destinations: ReadonlyArray<DraftDestination>; readonly fileIds: ReadonlyArray<string>; readonly isFromComposer: boolean }, at?: number): Draft | DraftFailure {
    const failure = this.#checkDestinations(input.destinations)
    if (failure !== undefined) return failure
    const key = placeKey(input.destinations)
    if (!input.isFromComposer && key !== undefined && this.#attachedAt(key) !== undefined) return 'attached_draft_exists'
    const record: DraftRecord = {
      id: `Dr${String(++this.#next).padStart(10, '0')}`,
      clientMsgId: input.clientMsgId,
      blocks: input.blocks,
      fileIds: input.fileIds,
      // The server adds `broadcast: false` to a thread destination.
      destinations: input.destinations.map((d) => (d.thread_ts === undefined ? d : { ...d, broadcast: d.broadcast ?? false })),
      isFromComposer: input.isFromComposer,
      dateCreated: Math.floor(this.#ws.clock.now() / 1000),
      lastUpdatedTs: this.#ws.nextTs(at),
      deleted: false,
      sent: false,
    }
    this.#records.set(record.id, record)
    const draft = this.#object(record)
    this.#ws.emit({ type: 'draft_create', draft_id: record.id, draft, event_ts: this.#ws.eventTs() })
    return draft
  }

  update(input: { readonly draftId: string; readonly blocks: Blocks; readonly destinations: ReadonlyArray<DraftDestination>; readonly fileIds: ReadonlyArray<string> }, at?: number): Draft | DraftFailure {
    const record = this.#records.get(input.draftId)
    if (record === undefined) return 'draft_not_found'
    if (record.deleted || record.sent) return 'draft_update_invalid'
    record.blocks = input.blocks
    record.fileIds = input.fileIds
    record.destinations = input.destinations.map((d) => (d.thread_ts === undefined ? d : { ...d, broadcast: d.broadcast ?? false }))
    record.lastUpdatedTs = this.#ws.nextTs(at)
    const draft = this.#object(record)
    this.#ws.emit({ type: 'draft_update', draft_id: record.id, draft, event_ts: this.#ws.eventTs() })
    return draft
  }

  delete(draftId: string): DraftFailure | undefined {
    const record = this.#records.get(draftId)
    if (record === undefined) return 'draft_not_found'
    if (record.deleted || record.sent) return 'draft_delete_invalid'
    record.deleted = true
    record.lastUpdatedTs = this.#ws.nextTs()
    this.#ws.emit({ type: 'draft_delete', draft_id: record.id, client_msg_id: record.clientMsgId, event_ts: this.#ws.eventTs() })
    return undefined
  }

  /** A post named the draft, by its id or its `client_msg_id`: it is retired. An unknown or retired one is left alone. */
  sent(draftId: string, messageTs: string): void {
    const record = this.#records.get(draftId) ?? [...this.#records.values()].find((each) => each.clientMsgId === draftId)
    if (record === undefined || record.deleted || record.sent) return
    record.sent = true
    record.destinations = record.destinations.map((d, index) => (index === 0 ? { ...d, message_ts: messageTs } : d))
    record.lastUpdatedTs = this.#ws.nextTs()
    this.#ws.emit({ type: 'draft_send', draft_id: record.id, client_msg_id: record.clientMsgId, event_ts: this.#ws.eventTs() })
  }

  /**
   * Another device types in the attached draft of a channel or thread: an
   * update of the one there, or a new one. `at` backdates the write, as for a
   * phone whose save reached Slack late.
   */
  putFromElsewhere(input: { readonly channel: string; readonly threadTs?: string | undefined; readonly text: string; readonly at?: number | undefined }): Draft {
    const destinations: ReadonlyArray<DraftDestination> = [{ channel_id: input.channel, ...(input.threadTs === undefined ? {} : { thread_ts: input.threadTs }) }]
    const existing = this.#attachedAt(placeKey(destinations)!)
    const blocks = textToBlocks(input.text)
    const result = existing === undefined
      ? this.create({ clientMsgId: crypto.randomUUID(), blocks, destinations, fileIds: [], isFromComposer: false }, input.at)
      : this.update({ draftId: existing.id, blocks, destinations: existing.destinations, fileIds: existing.fileIds }, input.at)
    if (typeof result === 'string') throw new Error(`putDraft: ${result}`)
    return result
  }

  /** Another device clears the attached draft, or sends it. */
  removeFromElsewhere(input: { readonly channel: string; readonly threadTs?: string | undefined; readonly sent?: boolean | undefined }): void {
    const existing = this.#attachedAt(input.threadTs === undefined ? input.channel : `${input.channel}-${input.threadTs}`)
    if (existing === undefined) throw new Error('removeDraft: no draft there')
    if (input.sent === true) this.sent(existing.id, this.#ws.nextTs())
    else this.delete(existing.id)
  }

  /** The text of the live attached draft of a channel or thread, `undefined` when there is none. */
  textAt(channel: string, threadTs?: string): string | undefined {
    const record = this.#attachedAt(threadTs === undefined ? channel : `${channel}-${threadTs}`)
    return record === undefined ? undefined : blocksToText(record.blocks)
  }

  /** How many live attached drafts there are. */
  get activeCount(): number {
    return [...this.#records.values()].filter((record) => !record.isFromComposer && !record.deleted && !record.sent).length
  }
}
