/**
 * How a pi entry becomes archive messages (plan v3 §3, §4.1). The text is
 * what memory reads; it is never clipped here. Presentation clipping (the
 * 30,000-character tool head and tail) applies only to what the model sees
 * (WP11). A tool call or result also keeps its whole entry as an attachment.
 */
import { INPUT_ENTRY, type JournalEntry } from '../runtime/journal'
import type { InboxKind } from '../inbox/inbox'

export type MessageKind = 'user' | 'juno' | 'tool' | 'echo' | 'work' | 'wake' | 'card' | 'note'

export interface Rendered {
  readonly kind: MessageKind
  readonly text: string
  readonly at: number | undefined
  /** Set on input entries: the inbox op this message is. */
  readonly opId?: string
  readonly attachment?: JournalEntry
}

/** A chunk is at most 16 KB (§4.1): the memory's source limit. */
export const CHUNK_BYTES = 16_384

const inputKinds: Record<InboxKind, MessageKind> = { send: 'user', steer: 'user', retry: 'user', click: 'card', wake: 'wake', report: 'work' }

type Part = { readonly type?: string; readonly text?: string; readonly name?: string; readonly arguments?: unknown; readonly toolName?: string }
type Message = { readonly role?: string; readonly content?: string | ReadonlyArray<Part>; readonly toolName?: string; readonly timestamp?: number }

const partsOf = (message: Message): ReadonlyArray<Part> =>
  typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? []
const textOf = (message: Message) => partsOf(message).flatMap((part) => (part.type === 'text' && part.text ? [part.text] : [])).join('\n')

/** Entries that are not conversation (system prompt, reset, compaction, app notes) render to nothing. */
export function render(entry: JournalEntry): Rendered | undefined {
  const message = (entry.model?.[0] ?? {}) as Message
  const at = typeof message.timestamp === 'number' ? message.timestamp : undefined
  switch (entry.kind) {
    case INPUT_ENTRY: {
      const data = entry.data as { opId: string; kind: InboxKind }
      return { kind: inputKinds[data.kind], text: textOf(message), at, opId: data.opId }
    }
    case 'pi.user':
      return { kind: 'user', text: textOf(message), at }
    case 'pi.assistant': {
      const calls = partsOf(message).filter((part) => part.type === 'toolCall')
      const lines = partsOf(message).flatMap((part) =>
        part.type === 'text' && part.text ? [part.text] : part.type === 'toolCall' ? [`→ ${part.name}(${JSON.stringify(part.arguments ?? {})})`] : [],
      )
      if (lines.length === 0) return undefined
      return { kind: 'juno', text: lines.join('\n'), at, ...(calls.length > 0 ? { attachment: entry } : {}) }
    }
    case 'pi.tool-result':
      return { kind: 'tool', text: `${message.toolName ?? 'tool'}: ${textOf(message)}`, at, attachment: entry }
    default:
      return undefined
  }
}

/** Splits text into chunks of at most `CHUNK_BYTES` UTF-8 bytes, at code point boundaries. Empty text is one empty chunk. */
export function chunks(text: string): ReadonlyArray<string> {
  const out: string[] = []
  let current = ''
  let size = 0
  for (const char of text) {
    const bytes = Buffer.byteLength(char, 'utf8')
    if (size + bytes > CHUNK_BYTES) {
      out.push(current)
      current = ''
      size = 0
    }
    current += char
    size += bytes
  }
  out.push(current)
  return out
}
