/** What the fake Codex binary reads and writes in its directory. Shared by `fakeCodex.ts` and `bin.ts`. */

export interface CodexToolCall {
  /** A key of `mcp_servers` in the config Codex was given, for example `juno`. */
  readonly server: string
  readonly tool: string
  readonly arguments?: Record<string, unknown>
}

export interface CodexTurn {
  /** MCP tool calls, made in order before the reply. */
  readonly toolCalls?: ReadonlyArray<CodexToolCall>
  /** The agent message. `{{result}}` is replaced by the text of the last tool result. Default `{{result}}`. */
  readonly reply?: string
  /** Ends the turn with `turn.failed` and this message instead of a reply. */
  readonly fail?: string
  /** Kill the process after its tool calls, before a reply or receipt. */
  readonly crash?: boolean
  /** Attempts built-ins; the fake enforces the CLI flags before any side effect. */
  readonly builtIns?: ReadonlyArray<'shell' | 'edit' | 'web'>
  /** Waits this long before the reply, to stand in for Codex's 5 s first text (spikes.md, S3). */
  readonly delayMs?: number
  /** Reported in `turn.completed`. Default: S3's measured turn, 20,000 input and 110 output tokens. */
  readonly usage?: { readonly input_tokens: number; readonly cached_input_tokens?: number; readonly output_tokens: number; readonly reasoning_output_tokens?: number }
}

export interface CodexModel {
  readonly id: string
  readonly isDefault?: boolean
  readonly hidden?: boolean
}

export interface CodexScript {
  readonly models: ReadonlyArray<CodexModel>
  readonly turns: ReadonlyArray<CodexTurn>
}

export interface CodexToolOutcome {
  readonly server: string
  readonly tool: string
  readonly status: 'completed' | 'failed'
  readonly error?: string
}

export interface CodexInvocation {
  /** `exec`, `app-server`, `login`, `logout` or `--version`. */
  readonly command: string
  readonly args: ReadonlyArray<string>
  /** Every `--config key=value`, as a nested object. */
  readonly config: Record<string, unknown>
  /** The flags `--model`, `--sandbox` and `--cd`, when given. */
  readonly model?: string
  readonly sandbox?: string
  readonly cwd?: string
  /** The prompt, read from stdin by `exec`. */
  readonly prompt?: string
  /** The `CODEX_HOME` it ran with. */
  readonly home: string
  readonly signedIn: boolean
  readonly toolCalls: ReadonlyArray<CodexToolOutcome>
}

export const SCRIPT_FILE = 'script.json'
export const LOG_FILE = 'log.jsonl'
export const NEXT_TURN_FILE = 'next-turn'
export const AUTH_FILE = 'auth.json'
