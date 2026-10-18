/**
 * The tool loop behind Juno's background memory work: the learning pass
 * (`learn.ts`) and the background updates of person files (`refresh.ts`).
 */
import { readRevision, type ProviderGuardApi } from '../providers/guard'
import { providerFailure } from '../providers'
import type { WireContext } from '../request/builder'
import { mode } from '../store/ledger'
import type { Store } from '../store/store'

type Context = Omit<WireContext, 'tools'> & { systemPrompt?: string; tools?: ReadonlyArray<ToolSpec> }
export type ToolSpec = { readonly name: string; readonly description: string; readonly parameters: unknown }
export type Output = { readonly text: string; readonly isError?: boolean }
type Content = ReadonlyArray<{ readonly type: string; readonly text?: string; readonly id?: string; readonly name?: string; readonly arguments?: Record<string, unknown> }>

export type LoopTool = ToolSpec & { readonly run: (args: Record<string, unknown>, callId: string, signal: AbortSignal) => Promise<Output> }
export type LoopOutcome = 'done' | 'stopped' | 'paused' | 'budget' | 'failed'

/**
 * A short tool loop on the guarded provider, for Juno's background memory
 * work: every request is stamped on the `subagent` spend path, so today's
 * limit stops it; it also stops at its own step and spend lines, at Pause
 * or AI off, and at `signal`. The tools are all it can use.
 */
export async function toolLoop(input: {
  readonly store: Store
  readonly guard: ProviderGuardApi
  readonly model: NonNullable<ReturnType<ProviderGuardApi['models']['getModel']>>
  readonly sessionId: string
  readonly signal: AbortSignal
  readonly limits: { readonly steps: number; readonly spend: number; readonly result: number }
  readonly system: string
  readonly task: string
  readonly tools: ReadonlyArray<LoopTool>
  readonly onTool?: (name: string) => void
}): Promise<LoopOutcome> {
  const { store, signal, limits, tools } = input
  const context: Context = {
    systemPrompt: input.system,
    tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    messages: [{ role: 'user', timestamp: 0, content: input.task } as WireContext['messages'][number]],
  }
  let spent = 0
  for (let step = 0; step < limits.steps; step++) {
    if (signal.aborted) return 'stopped'
    if (mode(store) !== 'on') return 'paused'
    const stamped = input.guard.stamp(readRevision(store), input.model, context as unknown as WireContext, 'subagent')
    const message = await input.guard.models.completeSimple(input.model, stamped, { sessionId: input.sessionId, signal })
    if (signal.aborted || message.stopReason === 'aborted') return 'stopped'
    if (message.stopReason === 'error') {
      const ending = providerFailure(message.errorMessage).ending
      return ending._tag === 'blocked' && ending.reason === 'budget' ? 'budget' : 'failed'
    }
    spent += Number.isFinite(message.usage.cost.total) ? message.usage.cost.total : 0
    context.messages.push(message as unknown as WireContext['messages'][number])
    const calls = (message.content as Content).filter((part) => part.type === 'toolCall')
    if (calls.length === 0) break
    for (const call of calls) {
      const tool = tools.find((candidate) => candidate.name === call.name)
      const output = tool === undefined ? { text: `There is no tool ${call.name}.`, isError: true } : await tool.run(call.arguments ?? {}, call.id ?? '', signal)
      if (tool !== undefined) input.onTool?.(tool.name)
      context.messages.push({
        role: 'toolResult', toolCallId: call.id, toolName: call.name, timestamp: 0,
        content: [{ type: 'text', text: cut(output.text, limits.result) }], isError: output.isError === true,
      } as unknown as WireContext['messages'][number])
    }
    // At its own spend line it stops reading and keeps what it wrote.
    if (spent >= limits.spend) break
  }
  return 'done'
}

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}\n(cut)`)
