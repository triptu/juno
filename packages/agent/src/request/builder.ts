/**
 * The chat request builder (plan v3 §4.3, §5.2, §5.3; spec `agent-memory.qnt`
 * `dispatchWith`). Every chat request of a run is built here, from pi's
 * `beforeRequest` hook, and nothing reaches a provider another way: the
 * guard refuses a request this builder did not stamp.
 *
 * 1. One snapshot: the published view, the pins and their revision, the
 *    tail `[covered, H)` and the run's own archive rows `[H, cutoff)`. The
 *    reads are synchronous on the agent's only connection, with no await
 *    between them, so nothing commits in the middle.
 * 2. `buildRequest` partitions and budgets it, or blocks it.
 * 3. The wire context is pi's own messages for this run (they keep tool
 *    call ids and provider metadata), after one memory message with the
 *    pins, the view and the tail. A tool result the builder paged is sent
 *    paged. A connection tool's schema is marked `whole`, so it is paged
 *    only past 48 KB (`limits.wholeResult`).
 * 4. `guard.stamp` revalidates `gen` and `pin_rev` and admits the window;
 *    the guard checks both again at dispatch.
 *
 * The outline of Juno's memory of the owner (`<about-owner>`, SPEC 13.8)
 * sits in the memory message after the view and before the tail. It is
 * read once per run (by `h`), so a write during a run leaves the run's
 * later requests as they were, and an unchanged memory leaves the prefix up
 * to the tail as the provider cached it. A change costs the tail, which a
 * new run sends again anyway. It is counted with the system text.
 *
 * The builder sees each archive entry as one active entry. An assistant
 * message with several tool calls is counted as one call (its first) and
 * the other results as notes, because the memory rules pair one call id
 * with one entry; the guard still counts every byte sent.
 */
import { isSchemaResult, pageMcpResult } from '../mcp/results'
import { buildRequest, type ActiveEntry, type Line, type Pins, type Source } from '@juno/agent-memory'
import type { Ending } from '@juno/agent-contract'
import { AdmissionError, providerFailure, type ProviderGuardApi, type StreamProgress } from '../providers'
import { view } from '../store/memory'
import type { Store } from '../store/store'
import { activePins } from '../pins/pins'

type Stamp = ProviderGuardApi['stamp']
export type WireContext = Parameters<Stamp>[2]
export type WireMessage = WireContext['messages'][number]
export type ChatModel = Parameters<Stamp>[1]

export type BuiltRequest =
  | { readonly _tag: 'stamped'; readonly messages: ReadonlyArray<WireMessage> }
  /** No provider call is made. The run ends with this. */
  | { readonly _tag: 'refused'; readonly ending: Ending }

type Row = { id: number; kind: Source['kind']; text: string; version: number; redacted_gen: number | null; entry_id: number; incarnation: string }
type Part = { readonly type?: string; readonly id?: string }
type Attached = { readonly model?: ReadonlyArray<{ readonly content?: string | ReadonlyArray<Part>; readonly toolCallId?: string; readonly toolName?: string }> }

export interface ChatRequest {
  /** The run's history cutoff. */
  readonly h: number
  /** pi's messages for this request: this run's, since its reset. */
  readonly messages: ReadonlyArray<WireMessage>
  readonly model: ChatModel
  readonly observe?: (progress: StreamProgress) => void
}

/** A subagent's request: pins, the view and its task (§8). Stamped on the `subagent` path. */
export type BuiltContext =
  | { readonly _tag: 'stamped'; readonly context: WireContext }
  | { readonly _tag: 'refused'; readonly ending: Ending }

export interface RequestBuilder {
  readonly chat: (request: ChatRequest) => BuiltRequest
  readonly subagent: (request: { readonly task: string; readonly system: string; readonly model: ChatModel }) => BuiltContext
}

export function createRequestBuilder(options: {
  readonly store: Store
  readonly guard: ProviderGuardApi
  /** The system text and the tool declarations, as sent. */
  readonly systemAndTools: () => ReadonlyArray<string>
  /** The outline of Juno's memory of the owner now, or none. */
  readonly outline?: () => string
}): RequestBuilder {
  const { store, guard } = options
  let frozen: { readonly h: number; readonly text: string } | undefined
  const outlineFor = (h: number): string => {
    if (options.outline === undefined) return ''
    if (frozen?.h !== h) frozen = { h, text: options.outline() }
    return frozen.text
  }
  return {
    chat: (request) => {
      const snapshot = read(store, request.h)
      const about = outlineFor(request.h)
      const systemAndTools = options.systemAndTools()
      const counted = about === '' ? systemAndTools : [...systemAndTools, about]
      const built = buildRequest({
        ...snapshot, h: request.h, systemAndTools: counted, parents: [], contextWindow: request.model.contextWindow,
        multiplier: multiplier(store, request.model.provider),
      })
      if (built.kind === 'blocked') {
        return { _tag: 'refused', ending: built.reason === 'protocol' ? { _tag: 'interrupted' } : { _tag: 'blocked', reason: 'tooLarge' } }
      }
      const rendered = built.messages.slice(counted.length)
      const [pins = '', memory = '', ...rest] = rendered
      const tail = rest.slice(0, rest.length - built.active.length)
      const paged = new Map<string, string>()
      built.active.forEach((entry, i) => {
        if (entry.kind === 'tool-result' && (entry.text !== snapshot.active[i]?.text || entry.text.startsWith('Untrusted connection result saved as attachment'))) paged.set(entry.callId, entry.text)
      })
      const memoryMessage = {
        role: 'user', timestamp: 0,
        content: ['<remembered>', pins, '</remembered>', '<memory>', memory, '</memory>', ...(about === '' ? [] : [about]), '<recent>', ...tail, '</recent>'].join('\n'),
      } as WireMessage
      const system = request.messages.filter((m) => role(m) === 'system')
      const run = request.messages.filter((m) => role(m) !== 'system').map((m) => {
        const callId = (m as { toolCallId?: string }).toolCallId
        const text = role(m) === 'toolResult' && callId !== undefined ? paged.get(callId) : undefined
        return text === undefined ? m : ({ ...m, content: [{ type: 'text', text }] } as WireMessage)
      })
      try {
        const stamped = guard.stamp(built, request.model, { messages: [...system, memoryMessage, ...run] }, 'chat', request.observe)
        return { _tag: 'stamped', messages: stamped.messages }
      } catch (error) {
        if (error instanceof AdmissionError) return { _tag: 'refused', ending: providerFailure(error).ending }
        throw error
      }
    },
    subagent: (request) => {
      // No tail and no active suffix: the view ends at `covered`, and the task follows it.
      const snapshot = read(store, view(store).covered)
      const systemAndTools = [request.system]
      const built = buildRequest({
        ...snapshot, h: snapshot.covered, cutoff: snapshot.covered, tail: [], active: [], systemAndTools, parents: [],
        contextWindow: request.model.contextWindow, multiplier: multiplier(store, request.model.provider),
      })
      if (built.kind === 'blocked') return { _tag: 'refused', ending: { _tag: 'blocked', reason: 'tooLarge' } }
      const [pins = '', memory = ''] = built.messages.slice(systemAndTools.length)
      const context = {
        systemPrompt: request.system,
        messages: [
          { role: 'user', timestamp: 0, content: ['<remembered>', pins, '</remembered>', '<memory>', memory, '</memory>'].join('\n') },
          { role: 'user', timestamp: 0, content: request.task },
        ],
      } as WireContext
      try {
        return { _tag: 'stamped', context: guard.stamp(built, request.model, context, 'subagent') }
      } catch (error) {
        if (error instanceof AdmissionError) return { _tag: 'refused', ending: providerFailure(error).ending }
        throw error
      }
    },
  }
}

const role = (message: WireMessage) => (message as { role: string }).role

function multiplier(store: Store, provider: string): 1 | 1.25 {
  return store.db.prepare('SELECT 1 FROM provider_bounds WHERE provider = ?').get(provider) ? 1.25 : 1
}

interface Snapshot {
  readonly rev: number
  readonly gen: number
  readonly pins: Pins
  readonly lines: ReadonlyArray<Line>
  readonly covered: number
  readonly cutoff: number
  readonly tail: ReadonlyArray<Source>
  readonly active: ReadonlyArray<ActiveEntry>
}

function read(store: Store, h: number): Snapshot {
  const published = view(store)
  const pins = activePins(store)
  const cutoff = (store.db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n
  const removed = new Set((store.db.prepare('SELECT message_id AS id FROM redactions').all() as Array<{ id: number }>).map((r) => r.id))
  const rows = (from: number, to: number) =>
    store.db
      .prepare('SELECT id, kind, text, version, redacted_gen, entry_id, incarnation FROM messages WHERE id >= ? AND id < ? ORDER BY id')
      .all(from, to) as unknown as Row[]
  const sourceOf = (row: Row): Source => ({ id: row.id, version: row.version, text: row.text, kind: row.kind, removed: row.redacted_gen !== null || removed.has(row.id) })
  return {
    rev: published.rev, gen: published.gen, pins, lines: published.lines, covered: published.covered, cutoff,
    tail: rows(published.covered, h).map(sourceOf),
    active: activeEntries(store, rows(h, cutoff)),
  }
}

/** One active entry per pi entry: its chunks are contiguous archive rows. */
function activeEntries(store: Store, rows: ReadonlyArray<Row>): ReadonlyArray<ActiveEntry> {
  const groups: Row[][] = []
  for (const row of rows) {
    const last = groups.at(-1)?.at(-1)
    if (last !== undefined && last.entry_id === row.entry_id && last.incarnation === row.incarnation) groups.at(-1)!.push(row)
    else groups.push([row])
  }
  const attachment = store.db.prepare('SELECT body FROM attachments WHERE message_id = ?')
  const calls = new Set<string>()
  return groups.map((group): ActiveEntry => {
    const first = group[0]!
    const span = { sourcePos: first.id, sourceEnd: group.at(-1)!.id + 1, text: group.map((r) => r.text).join(''), metadata: '' }
    const body = (attachment.get(first.id) as { body: string } | undefined)?.body
    const message = body === undefined ? undefined : (JSON.parse(body) as Attached).model?.[0]
    if (first.kind === 'juno') {
      const content = typeof message?.content === 'string' ? [] : (message?.content ?? [])
      const callId = content.find((part) => part.type === 'toolCall')?.id
      if (callId === undefined) return { ...span, kind: 'juno' }
      calls.add(callId)
      return { ...span, kind: 'tool-call', callId }
    }
    if (first.kind === 'tool') {
      const callId = message?.toolCallId
      if (callId === undefined || !calls.has(callId)) return { ...span, kind: 'note' }
      calls.delete(callId)
      // A tool's schema is sent whole: the model can't call the tool from part of it.
      const whole = isSchemaResult(message?.toolName, span.text)
      return { ...span, text: pageMcpResult(message?.toolName, span.text, first.id), kind: 'tool-result', callId, ...(whole ? { whole } : {}) }
    }
    return { ...span, kind: first.kind === 'echo' ? 'note' : first.kind }
  })
}
