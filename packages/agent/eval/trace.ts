/**
 * What one case did, read back from the engine after each step: the owner's
 * input, Juno's bubbles and reactions as the router parses them, the tools
 * it called, the Slack messages the host returned, and how each run ended.
 * The grader reads only this.
 */
import type { Ending } from '@juno/agent-contract'
import type { SlackMessage } from '@juno/agent-testing'
import { parseOutput, type ArchiveMessage, type Output, type SourceRef } from '../src/index'

/** A cited span inside a bubble: `<src m="m3">words</src>` (plan v3 §19.1). */
export interface Source {
  readonly handle: string
  readonly words: string
}

export interface Bubble {
  /** As the model wrote it, `<src>` tags included. */
  readonly raw: string
  /** What the owner reads. */
  readonly text: string
  readonly replyTo?: string
  readonly sources: ReadonlyArray<Source>
}

export interface Call {
  readonly name: string
  readonly args: unknown
  /** The tool's result as the model got it, if it came back. */
  readonly result?: string
}

export interface StepTrace {
  /** The owner's input as the judge reads it. */
  readonly input: string
  readonly bubbles: ReadonlyArray<Bubble>
  /** Juno's reactions on owner messages. */
  readonly reactions: ReadonlyArray<{ readonly to: string; readonly emoji: string }>
  readonly calls: ReadonlyArray<Call>
  /** Messages the host returned in this step, each once, in the order returned. */
  readonly read: ReadonlyArray<SlackMessage>
  /** The handle table of this step's run, from the router: `m1` is the first message read. */
  readonly handles: ReadonlyMap<string, SlackMessage>
  readonly endings: ReadonlyArray<Ending>
  /** Pins written ("Remembered"). */
  readonly remembered: ReadonlyArray<string>
}

export interface Trace {
  readonly steps: ReadonlyArray<StepTrace>
}

/** A bubble as the router parsed it, with `raw` rebuilt with its `<src>` tags. */
export function bubble(parsed: Output['bubbles'][number]): Bubble {
  const sources = parsed.spans.flatMap((span) => (span.source === undefined ? [] : [{ handle: span.source, words: span.text }]))
  const raw = parsed.spans.map((span) => (span.source === undefined ? span.text : `<src m="${span.source}">${span.text}</src>`)).join('')
  return { raw, text: parsed.text, ...(parsed.replyTo ? { replyTo: parsed.replyTo } : {}), sources }
}

/** The router's handle table for a step's runs (`sourceTable`), each handle with the message it names. */
export function handleTable(tables: ReadonlyArray<ReadonlyMap<string, SourceRef>>, read: ReadonlyArray<SlackMessage>): ReadonlyMap<string, SlackMessage> {
  const handles = new Map<string, SlackMessage>()
  for (const [handle, ref] of tables.flatMap((table) => [...table])) {
    const message = read.find((m) => m.channelId === ref.channelId && m.ts === ref.ts)
    if (message !== undefined) handles.set(handle, message)
  }
  return handles
}

export function unique(read: ReadonlyArray<SlackMessage>): ReadonlyArray<SlackMessage> {
  const seen = new Set<string>()
  return read.filter((m) => {
    const key = `${m.channelId}/${m.ts}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const CALL = /^→ ([\w.-]+)\((.*)\)$/

/**
 * Juno's text and tool calls from a step's archive rows. A `juno` row holds
 * the model's text with one `→ name({...})` line per tool call; a `tool` row
 * is `name: result`.
 */
export function fromArchive(rows: ReadonlyArray<ArchiveMessage>): Pick<StepTrace, 'bubbles' | 'reactions' | 'calls'> {
  const texts: string[] = []
  const calls: Array<{ name: string; args: unknown; result?: string }> = []
  for (const row of rows) {
    if (row.kind === 'juno') {
      const text: string[] = []
      for (const line of row.text.split('\n')) {
        const call = CALL.exec(line)
        if (call) calls.push({ name: call[1]!, args: parseArgs(call[2]!) })
        else text.push(line)
      }
      texts.push(text.join('\n'))
    } else if (row.kind === 'tool') {
      const at = row.text.indexOf(': ')
      const name = row.text.slice(0, at)
      const call = calls.find((c) => c.name === name && c.result === undefined)
      if (call) call.result = row.text.slice(at + 2)
    }
  }
  const output = parseOutput(texts.join('\n\n'))
  return { bubbles: output.bubbles.map(bubble), reactions: output.reactions, calls }
}

function parseArgs(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return json
  }
}
