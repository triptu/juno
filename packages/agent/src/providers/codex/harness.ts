import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import { Ending } from '@juno/agent-contract'
import type { Api, AssistantMessage, Context, Model } from '@earendil-works/pi-ai'
import { parseObject } from '../../mcp/catalogue'
import { serveMcp } from '../../mcp/serve'
import type { JunoTool, ToolRegistration } from '../../request/tool'
import type { Store } from '../../store/store'
import { createCodexAdapter, type CodexOptions } from '../codex'
import type { Revision, StreamProgress } from '../guard'

export const HARNESS_TOOL = 'juno_harnessTurn'
const Result = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('done'), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('failed'), failure: Schema.Struct({ ending: Ending }) }),
])
const decodeResult = Schema.decodeUnknownSync(Result)
const failureCode = (ending: typeof Ending.Type) => `JUNO:${ending._tag}${'reason' in ending ? `:${ending.reason}` : ''}`

const message = (model: Model<Api>): AssistantMessage => ({
  role: 'assistant', api: model.api, provider: model.provider, model: model.id,
  content: [], stopReason: 'stop', timestamp: Date.now(),
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
})

/**
 * The synthetic provider asks pi to execute one unsafe harness tool. MCP
 * calls become nested pi tools, with their own validation, intent and receipt.
 * No SDK work happens in the replayable generation task.
 */
export function createCodexHarness(options: CodexOptions & { readonly store: Store }) {
  const adapter = createCodexAdapter({ ...options, threadExists: (id) =>
    options.store.db.prepare('SELECT 1 FROM codex_turns WHERE thread_id = ?').get(id) !== undefined })
  type Pending = { model: Model<Api>; prompt: string; revision: Revision; observe?: (progress: StreamProgress) => void }
  const pending = new Map<string, Pending>()
  const response = (model: Model<Api>, context: Context, revision: Revision, observe?: Pending['observe']): AssistantMessage => {
    const answer = message(model)
    const last = context.messages.at(-1)
    const previous = context.messages.findLast(item => item.role === 'toolResult' && item.toolName === HARNESS_TOOL)
    if (previous?.role === 'toolResult') {
      try {
        if (previous.isError) throw new Error('Interrupted harness')
        const result = decodeResult(JSON.parse(previous.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('')))
        // A steer can start new work only after a successful harness.
        if (result.kind === 'failed' || previous === last) {
          if (result.kind === 'failed') { answer.stopReason = 'error'; answer.errorMessage = failureCode(result.failure.ending) }
          else { answer.content = [{ type: 'text', text: result.text }]; observe?.({ text: result.text, toolCalls: 0 }) }
          return answer
        }
      } catch { answer.stopReason = 'error'; answer.errorMessage = 'JUNO:failed:codexCrash'; return answer }
    }
    const key = randomUUID()
    // Only the admitted request can mint this one-use capability. No prompt or credentials in tool arguments.
    pending.clear()
    pending.set(key, { model, revision, prompt: `Continue this Juno conversation. Use only Juno MCP tools. The current memory snapshot replaces earlier memory. Do not repeat actions from earlier turns.\n${JSON.stringify(context.messages)}`, ...(observe ? { observe } : {}) })
    answer.content = [{ type: 'toolCall', id: key, name: HARNESS_TOOL, arguments: { key } }]
    answer.stopReason = 'toolUse'
    return answer
  }
  const registration: ToolRegistration = {
    name: HARNESS_TOOL,
    description: 'Run the admitted Juno request through local Codex.',
    parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false },
    replay: 'unsafe', callers: ['model'],
    outputLimits: { maxBytes: 128 * 1024, maxLines: 10_000 },
    execute: async (args, api, context) => {
      const { key } = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }))(args)
      const request = pending.get(key)
      pending.delete(key)
      if (!request) throw new Error('No admitted Codex request')
      const agent = await api.agent(context)
      // Not codemode: scripts through the Codex bridge are not checked yet (docs/research/codemode.md).
      const server = await serveMcp(agent.tools.filter(tool => tool.name !== HARNESS_TOOL && tool.name !== 'codemode').map(tool => ({
        name: tool.name, description: tool.description, inputSchema: parseObject(tool.parameters),
        call: async (input: unknown) => {
          // Recheck removal and pin revisions before every nested call.
          options.guard.admitHarness(request.revision, request.model, request.prompt)
          const result = await api.executeTool(tool.name, Object.fromEntries(Object.entries(parseObject(input)).map(([key, value]) => [key, mutableJson(value)])), context)
          request.observe?.({ text: '', toolCalls: 0, status: 'Waiting for Codex' })
          return { text: typeof result.structuredOutput === 'string' ? result.structuredOutput : JSON.stringify(result.structuredOutput ?? result.diagnostics), isError: result.isError }
        },
      })))
      try {
        const result = await adapter.turn({ ...request, sessionId: String(api.conversationId), mcp: server, signal: context.abortSignal })
        return { output: [{ type: 'text', text: JSON.stringify(result) }] }
      } finally { await server.close() }
    },
  }
  const tool: JunoTool & { readonly taints: true } = {
    name: HARNESS_TOOL, registration, taints: true, status: () => 'Waiting for Codex',
  }
  return { response, tool }
}

// Effect validates readonly JSON; pi owns mutable JSON values. Copy at this boundary.
type ToolArgs = Parameters<Parameters<ToolRegistration['execute']>[1]['executeTool']>[1]
function mutableJson(value: Schema.Json): ToolArgs[string] {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(mutableJson)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mutableJson(item)]))
}
