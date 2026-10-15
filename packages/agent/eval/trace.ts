/**
 * What one case did, read back from the engine after each step: the owner's
 * input, Juno's bubbles and reactions as the router parses them, the tools
 * it called, the Slack messages the host returned, and how each run ended.
 * The grader reads only this.
 */
import type { Ending } from '@juno/agent-contract'
import type { SlackMessage } from '@juno/agent-testing'
import { parseOutput, type ArchiveMessage } from '../src/index'

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
  /** The handle table of this step's run: `m1` is the first message read. */
  readonly handles: ReadonlyMap<string, SlackMessage>
  readonly endings: ReadonlyArray<Ending>
  /** Pins written ("Remembered"). */
  readonly remembered: ReadonlyArray<string>
}

export interface Trace {
  readonly steps: ReadonlyArray<StepTrace>
}

const SRC = /<src\s+m="([^"]*)"\s*>([\s\S]*?)<\/src>/g

export function bubble(raw: string, replyTo?: string): Bubble {
  const sources = [...raw.matchAll(SRC)].map(([, handle, words]) => ({ handle: handle!, words: words! }))
  return { raw, text: raw.replace(SRC, (_, __, words: string) => words), ...(replyTo ? { replyTo } : {}), sources }
}

/**
 * The handle table. The router does not give read results handles yet (plan
 * v3 §19.1, WP11): until it does, the eval numbers the messages of a run's
 * read results in the order they came back, which is how §19.1 describes
 * them. When the router exports its table, read it here instead.
 */
export function handleTable(read: ReadonlyArray<SlackMessage>): ReadonlyMap<string, SlackMessage> {
  return new Map(read.map((message, i) => [`m${i + 1}`, message]))
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
  return { bubbles: output.bubbles.map((b) => bubble(b.text, b.replyTo)), reactions: output.reactions, calls }
}

function parseArgs(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return json
  }
}
