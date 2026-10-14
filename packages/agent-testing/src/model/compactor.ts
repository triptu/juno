/**
 * The deterministic compactor model. It reads the compaction task that
 * `@juno/agent-memory`'s `compactionTask` writes, and answers with one line
 * built only from the task's `<input>` block: the same task always gets the
 * same answer, so compaction tests can assert exact node text.
 *
 * The answer is `Summary of messages a–b: <input, whitespace collapsed>`, cut
 * to `targetBytes` UTF-8 bytes. The first `oversizedAnswers` requests answer
 * past the target instead (the input repeated), so retries and the hard cap
 * can be exercised. It never calls a tool.
 */
import type { Message, TranscriptContext } from '@earendil-works/pi-ai'

export interface CompactorOptions {
  /** Default 512, the target in `compactionTask`. */
  readonly targetBytes?: number
  /** How many requests, counted from the first, answer longer than the target. Default 0. */
  readonly oversizedAnswers?: number
}

export function compactorAnswer(context: TranscriptContext, index: number, options: CompactorOptions = {}): string {
  const text = context.messages.filter((message) => message.role === 'user').map(textOf).join('\n')
  const input = /<input>\n([\s\S]*?)\n<\/input>/.exec(text)?.[1]
  if (input === undefined) return 'No input to summarize.'
  const range = /messages (\d+)–(\d+)/.exec(text)
  const head = range ? `Summary of messages ${range[1]}–${range[2]}: ` : 'Summary: '
  const line = head + input.replace(/\s+/g, ' ').trim()
  const target = options.targetBytes ?? 512
  if (index < (options.oversizedAnswers ?? 0)) return `${line} ${line}`.padEnd(target * 2 + 1, '.')
  return cutBytes(line, target)
}

function textOf(message: Message): string {
  if (message.role !== 'user') return ''
  return typeof message.content === 'string'
    ? message.content
    : message.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n')
}

/** The longest prefix of `text` that fits in `limit` UTF-8 bytes, without splitting a character. */
function cutBytes(text: string, limit: number): string {
  let bytes = 0
  let end = 0
  for (const char of text) {
    const size = Buffer.byteLength(char)
    if (bytes + size > limit) break
    bytes += size
    end += char.length
  }
  return text.slice(0, end)
}
