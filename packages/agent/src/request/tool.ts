/**
 * Tools the model is offered, as pi extensions take them. Only `runtime/`
 * may import pi-durable, so a tool is a plain object of pi's shape and its
 * parameters are plain JSON Schema, which pi compiles with TypeBox.
 *
 * Every tool result is text. `declaration` is the exact string the request
 * builder counts for a tool (plan v3 §5.1); the guard counts the final wire
 * payload again before it is sent.
 */
import type { Extension } from '../runtime'
import type { JournalPosition } from '../store/ledger'

export type ToolRegistration = NonNullable<Extension['tools']>[number]

/** A JSON Schema object of named properties. */
export interface Parameters {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, unknown>>
  readonly required?: ReadonlyArray<string>
  readonly additionalProperties?: false
}

/** The live run as tools see it, once the archive caught up with the journal. */
export interface ToolRun {
  readonly runId: string
  readonly opId: string
  readonly h: number
  /** What started the run (§6.4): only an owner run can be clean. */
  readonly origin: 'owner' | 'wake' | 'report' | 'click'
  /** The archive length now: the run's own messages are `[h, cutoff)`. */
  readonly cutoff: number
  /** The run has read no untrusted content yet (§6.4). */
  readonly clean: boolean
  /**
   * The run had read no untrusted content when the model wrote this call. It
   * differs from `clean` only when another call in the same response tainted
   * the run, or this one did as it started (`taints`), which the model had not
   * read. The auto-review uses it; other rules keep the stricter `clean`.
   */
  readonly cleanAtRequest?: boolean
  /**
   * The journal's last commit, read when the tool asked for the run: inside
   * `execute()`, after pi committed the call's execute intent. A tool that
   * authorizes an action passes it to `authorize` and keeps `replay: 'unsafe'`
   * (spec `agent-recovery-replay.qnt`).
   */
  readonly position: JournalPosition
}

export interface ToolCall {
  /** pi's call id: stable when pi replays the call. */
  readonly callId: string
}

export interface ToolDefinition<Args> {
  readonly name: string
  readonly description: string
  readonly parameters: Parameters
  /** `safe` only when running the call twice has the effect of running it once. A tool that authorizes is `unsafe`. */
  readonly replay: 'safe' | 'unsafe'
  /**
   * The status bubble's line while the run uses this tool, counting real
   * things: `count` is how many calls of it the run has made ("Reading 3
   * conversations").
   */
  readonly status: (count: number) => string
  /** The text the model sees. A thrown error is shown to the model as the tool's error. */
  readonly run: (args: Args, call: ToolCall) => Promise<ToolOutput>
}

/** A tool with its registration for pi and its status line for the bubble. */
export interface JunoTool {
  readonly name: string
  readonly registration: ToolRegistration
  readonly status: (count: number) => string
}

export type ToolOutput = { readonly text: string; readonly isError?: boolean }

export function defineTool<Args>(tool: ToolDefinition<Args>): JunoTool {
  const registration = {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    replay: tool.replay,
    execute: async (args: Args, api: { readonly callId: string }) => {
      const output = await tool.run(args, { callId: api.callId })
      return { output: [{ type: 'text', text: output.text }], ...(output.isError ? { isError: true } : {}) }
    },
  }
  return { name: tool.name, registration: registration as unknown as ToolRegistration, status: tool.status }
}

/** The tool as the provider receives it, for the builder's count. */
export function declaration(tool: ToolRegistration): string {
  return JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })
}
