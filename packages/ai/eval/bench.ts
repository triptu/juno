#!/usr/bin/env node
/**
 * `pnpm --filter @juno/ai bench`: measures decision setups on the decision
 * examples and prints one row per setup: p50 and p95 latency, accuracy against
 * each example's `expect`, the no-decision rate and the cost per 1k decisions.
 * Live only; needs `OPENROUTER_API_KEY` in the environment or the repo's `.env`.
 *
 * Usage: `pnpm --filter @juno/ai bench [--reps 3] [--setups a,b] [--tasks routeCheck,urgencyGate] [--concurrency 3] [--list]`
 *
 * A setup is a model plus request options: how the output is asked for (a
 * forced tool call, tool choice auto, a JSON schema response), OpenRouter
 * provider routing, a trimmed prompt, or the System One classifier API. Each
 * tool setup runs through `makePiAiProvider`, so it measures the real code path.
 */
import { createModels, type Api, type Model, type Models } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { Effect } from 'effect'
import { fileURLToPath } from 'node:url'
import {
  DECISION_RULES,
  defineStructuredTask,
  makePiAiProvider,
  validateOutput,
  type Decision,
  type PiModels,
  type StructuredTask,
} from '../src/index'
import { decisionExamples } from './examples'

const BENCH_TIMEOUT_MILLIS = 10_000
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

type Routing = 'default' | 'latency' | 'throughput'
type Output = 'tool' | 'tool-auto' | 'json-schema'

interface ToolSetup {
  readonly kind: 'tool'
  readonly name: string
  readonly model: string
  readonly output?: Output
  readonly routing?: Routing
  readonly prompt?: 'full' | 'short'
  readonly reasoningEffort?: 'minimal' | 'low'
}

/** The payload pi-ai would send, posted directly with `stream: false`. */
interface RawSetup {
  readonly kind: 'raw'
  readonly name: string
  readonly model: string
}

/** The same request streamed, reporting time to the first token, to the end of the tool call, and to done. */
interface StreamSetup {
  readonly kind: 'stream'
  readonly name: string
  readonly model: string
}

interface ClassifySetup {
  readonly kind: 'classify'
  readonly name: string
  readonly model: string
}

type Setup = ToolSetup | RawSetup | StreamSetup | ClassifySetup

const setups: ReadonlyArray<Setup> = [
  { kind: 'tool', name: 'haiku-5.5', model: 'anthropic/claude-haiku-5.5' },
  { kind: 'tool', name: 'haiku-5.5-low', model: 'anthropic/claude-haiku-5.5', reasoningEffort: 'low' },
  { kind: 'tool', name: 'gpt-4.1-nano', model: 'openai/gpt-4.1-nano' },
  { kind: 'tool', name: 'gpt-6-luna', model: 'openai/gpt-6-luna' },
  { kind: 'tool', name: 'gpt-5-nano-minimal', model: 'openai/gpt-5-nano', reasoningEffort: 'minimal' },
  { kind: 'tool', name: 'gemini-2.5-flash-lite', model: 'google/gemini-2.5-flash-lite' },
  { kind: 'tool', name: 'gemini-3.1-flash-lite', model: 'google/gemini-3.1-flash-lite' },
  { kind: 'tool', name: 'ministral-8b', model: 'mistralai/ministral-8b-2512' },
  { kind: 'tool', name: 'mercury-2.5', model: 'inception/mercury-2.5' },
  { kind: 'tool', name: 'qwen3.7-flash', model: 'qwen/qwen3.7-flash' },
  { kind: 'tool', name: 'deepseek-v4-flash', model: 'deepseek/deepseek-v4-flash' },
  { kind: 'tool', name: 'glm-5.3-flash', model: 'z-ai/glm-5.3-flash' },
  { kind: 'tool', name: 'nova-micro', model: 'amazon/nova-micro-v1' },
  { kind: 'tool', name: 'llama-3.1-8b', model: 'meta-llama/llama-3.1-8b-instruct' },
  { kind: 'tool', name: 'solar-mini4', model: 'upstage/solar-mini4' },
  { kind: 'tool', name: 'nemotron-3.5-lightning', model: 'nvidia/nemotron-3.5-lightning' },
  { kind: 'tool', name: 'gemma-4-26b', model: 'google/gemma-4-26b-a4b-it' },

  // Variations on request shape, for the shortlist.
  { kind: 'tool', name: 'gpt-4.1-nano-latency', model: 'openai/gpt-4.1-nano', routing: 'latency' },
  { kind: 'tool', name: 'gpt-4.1-nano-throughput', model: 'openai/gpt-4.1-nano', routing: 'throughput' },
  { kind: 'tool', name: 'gpt-4.1-nano-short', model: 'openai/gpt-4.1-nano', prompt: 'short' },
  { kind: 'tool', name: 'gpt-4.1-nano-auto', model: 'openai/gpt-4.1-nano', output: 'tool-auto' },
  { kind: 'tool', name: 'gpt-4.1-nano-json', model: 'openai/gpt-4.1-nano', output: 'json-schema' },
  { kind: 'raw', name: 'gpt-4.1-nano-nonstream', model: 'openai/gpt-4.1-nano' },
  { kind: 'stream', name: 'gpt-4.1-nano-stream', model: 'openai/gpt-4.1-nano' },
  { kind: 'tool', name: 'gemini-2.5-flash-lite-latency', model: 'google/gemini-2.5-flash-lite', routing: 'latency' },
  { kind: 'tool', name: 'gemini-2.5-flash-lite-short', model: 'google/gemini-2.5-flash-lite', prompt: 'short' },
  { kind: 'tool', name: 'gemini-2.5-flash-lite-auto', model: 'google/gemini-2.5-flash-lite', output: 'tool-auto' },
  { kind: 'tool', name: 'gemini-2.5-flash-lite-json', model: 'google/gemini-2.5-flash-lite', output: 'json-schema' },
  { kind: 'raw', name: 'gemini-2.5-flash-lite-nonstream', model: 'google/gemini-2.5-flash-lite' },
  { kind: 'stream', name: 'gemini-2.5-flash-lite-stream', model: 'google/gemini-2.5-flash-lite' },
  { kind: 'tool', name: 'gpt-6-luna-latency', model: 'openai/gpt-6-luna', routing: 'latency' },
  { kind: 'tool', name: 'gpt-6-luna-throughput', model: 'openai/gpt-6-luna', routing: 'throughput' },
  { kind: 'tool', name: 'gpt-6-luna-short', model: 'openai/gpt-6-luna', prompt: 'short' },
  { kind: 'tool', name: 'gpt-6-luna-auto', model: 'openai/gpt-6-luna', output: 'tool-auto' },
  { kind: 'tool', name: 'gpt-6-luna-json', model: 'openai/gpt-6-luna', output: 'json-schema' },
  { kind: 'raw', name: 'gpt-6-luna-nonstream', model: 'openai/gpt-6-luna' },
  { kind: 'stream', name: 'gpt-6-luna-stream', model: 'openai/gpt-6-luna' },
  { kind: 'tool', name: 'qwen3.7-flash-latency', model: 'qwen/qwen3.7-flash', routing: 'latency' },
  { kind: 'tool', name: 'ministral-8b-latency', model: 'mistralai/ministral-8b-2512', routing: 'latency' },
  { kind: 'tool', name: 'haiku-5.5-latency', model: 'anthropic/claude-haiku-5.5', routing: 'latency' },
  { kind: 'tool', name: 'haiku-5.5-short', model: 'anthropic/claude-haiku-5.5', prompt: 'short' },
  { kind: 'raw', name: 'haiku-5.5-nonstream', model: 'anthropic/claude-haiku-5.5' },
  { kind: 'stream', name: 'haiku-5.5-stream', model: 'anthropic/claude-haiku-5.5' },

  // Decision models through the System One classifier API. Only the tasks with a classifier mapping run.
  { kind: 'classify', name: 'jev-1.13', model: 'typesafe/jev-1.13' },
  { kind: 'classify', name: 'jev-latest', model: '~typesafe/jev-latest' },
  { kind: 'classify', name: 'pplx-decider', model: 'perplexity/pplx-decider-v1.1-27b' },
  { kind: 'classify', name: 'liquid-d1', model: 'liquid/d1' },
  { kind: 'classify', name: 'clef-flash', model: 'cloudflare/clef-flash' },
  { kind: 'classify', name: 'solar-decide', model: 'upstage/solar-decide' },
  { kind: 'classify', name: 'kev-4b', model: 'jaredpalmer/kev-4b' },
  { kind: 'classify', name: 'span-01', model: 'respan/span-01' },
  { kind: 'classify', name: 'luna-decisions', model: 'openai/gpt-6-luna-decisions' },
]

interface Run {
  readonly setup: string
  readonly task: string
  readonly label: string
  readonly latencyMillis: number
  /** Streaming only: time to the first event, and to the end of the tool call. */
  readonly firstEventMillis?: number
  readonly toolCallEndMillis?: number
  readonly ok: boolean
  readonly failure?: string
  readonly costUsd?: number
  readonly output?: unknown
}

function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)))
  } catch {
    // No .env: the environment alone decides.
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!
}

/** The trimmed prompt: the first line of the task prompt and the decision rules. */
function shortPrompt(prompt: string): string {
  return `${prompt.split('\n')[0]}\n${DECISION_RULES}`
}

function routingPayload(routing: Routing | undefined): Record<string, unknown> {
  return routing && routing !== 'default' ? { provider: { sort: routing } } : {}
}

/** A `Models` whose `complete` merges extra request options, so the provider's code path is measured as is. */
function withOptions(models: Models, extra: (model: Model<Api>, options: Record<string, unknown>) => Record<string, unknown>): PiModels {
  return {
    getModel: (provider, id) => models.getModel(provider, id),
    getModelOfType: (type, provider, id) => models.getModelOfType(type, provider, id),
    classify: (model, context, options) => models.classify(model, context, options),
    stream: (model, context, options) => models.stream(model, context, options),
    complete: (model, context, options) => models.complete(model, context, extra(model, { ...(options as Record<string, unknown>) }) as never),
  }
}

function toolOptions(setup: ToolSetup, task: StructuredTask<never>): (model: Model<Api>, options: Record<string, unknown>) => Record<string, unknown> {
  return (model, options) => {
    const next: Record<string, unknown> = { ...options, maxRetries: 0 }
    const anthropic = model.api === 'anthropic-messages'
    if (setup.output === 'tool-auto') next.toolChoice = anthropic ? { type: 'auto' } : 'auto'
    if (setup.output === 'json-schema') {
      delete next.toolChoice
      next.samplingParams = {
        response_format: { type: 'json_schema', json_schema: { name: task.tool.name, strict: true, schema: task.output } },
      }
    }
    if (setup.reasoningEffort) {
      if (anthropic) {
        next.thinkingEnabled = true
        next.effort = setup.reasoningEffort
      } else next.reasoningEffort = setup.reasoningEffort
    }
    const routing = routingPayload(setup.routing)
    next.onPayload = (payload: unknown) => {
      const body = { ...(payload as Record<string, unknown>), ...routing }
      if (setup.output === 'json-schema') {
        delete body.tools
        delete body.tool_choice
      }
      return body
    }
    return next
  }
}

function benchTask(task: StructuredTask<never>, setup: Setup): StructuredTask<never> {
  const prompt = setup.kind === 'tool' && setup.prompt === 'short' ? shortPrompt(task.prompt) : task.prompt
  const jsonRules = setup.kind === 'tool' && setup.output === 'json-schema' ? `\nAnswer with one JSON object matching the schema; nothing else.` : ''
  return defineStructuredTask({ ...task, prompt: `${prompt}${jsonRules}`, timeoutMillis: BENCH_TIMEOUT_MILLIS })
}

function judge(example: (typeof decisionExamples)[number], decision: Decision<unknown>): Pick<Run, 'ok' | 'failure' | 'output'> {
  if (decision._tag === 'NoDecision') return { ok: false, failure: `${decision.reason}${decision.detail ? `: ${decision.detail.slice(0, 120)}` : ''}` }
  const ok = example.expect(decision.value as never)
  return { ok, output: decision.value, ...(ok ? {} : { failure: 'not as expected' }) }
}

async function runTool(setup: ToolSetup, models: Models, apiKey: string, example: (typeof decisionExamples)[number]): Promise<Run> {
  const task = benchTask(example.task as StructuredTask<never>, setup)
  const provider = makePiAiProvider(Effect.succeed({ apiKey, models: { classifier: '', decision: setup.model, generation: setup.model } }), withOptions(models, toolOptions(setup, task)))
  let decision: Decision<unknown>
  if (setup.output === 'json-schema') {
    // The provider reads a tool call; a JSON answer comes back as text, so read it here with the same validation.
    const textTask = { ...task, shape: 'text' as const, maxChars: 4000 }
    const answer = await Effect.runPromise(provider.generate(textTask as never, example.input as never))
    if (answer._tag === 'NoDecision') decision = answer
    else {
      let parsed: unknown
      try {
        parsed = JSON.parse(answer.value)
      } catch {
        parsed = undefined
      }
      const checked = validateOutput(task, example.input as never, parsed)
      decision = checked.ok ? { _tag: 'Decided', value: checked.value, meta: answer.meta } : { _tag: 'NoDecision', reason: 'invalid-output', detail: checked.message, meta: answer.meta }
    }
  } else {
    decision = await Effect.runPromise(provider.decide(task, example.input as never))
  }
  return { setup: setup.name, task: task.name, label: example.label, latencyMillis: decision.meta.latencyMillis, costUsd: decision.meta.costUsd, ...judge(example, decision) }
}

/** Captures the body pi-ai would post, by aborting the request from `onPayload`. */
async function capturePayload(models: Models, apiKey: string, model: Model<Api>, task: StructuredTask<never>, input: unknown): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  let captured: Record<string, unknown> | undefined
  const tool = { name: task.tool.name, description: task.tool.description, parameters: task.output }
  const context = { systemPrompt: task.prompt, messages: [{ role: 'user' as const, content: task.render(input as never), timestamp: Date.now() }], tools: [tool] }
  const options: Record<string, unknown> = {
    apiKey,
    signal: controller.signal,
    maxTokens: 1024,
    maxRetries: 0,
    onPayload: (payload: unknown) => {
      captured = payload as Record<string, unknown>
      controller.abort()
      return undefined
    },
  }
  if (model.api === 'anthropic-messages') {
    options.thinkingEnabled = false
    options.toolChoice = { type: 'tool', name: tool.name }
  } else options.toolChoice = { type: 'function', function: { name: tool.name } }
  await models.complete(model, context, options as never)
  if (!captured) throw new Error('payload was not captured')
  return captured
}

/** The same request without streaming, straight to OpenRouter's chat completions endpoint. */
async function runRaw(setup: RawSetup, models: Models, apiKey: string, example: (typeof decisionExamples)[number]): Promise<Run> {
  const task = benchTask(example.task as StructuredTask<never>, setup)
  const model = models.getModel('openrouter', setup.model)
  if (!model) throw new Error(`unknown model ${setup.model}`)
  const payload = await capturePayload(models, apiKey, model, task, example.input)
  const body: Record<string, unknown> = { ...payload, model: setup.model, stream: false, usage: { include: true } }
  delete body.stream_options
  if (model.api === 'anthropic-messages') {
    // The Anthropic payload has `system`, `tools` with `input_schema` and `tool_choice: { type: 'tool' }`; the chat endpoint wants the OpenAI shape.
    body.messages = [{ role: 'system', content: body.system }, ...(body.messages as unknown[])]
    delete body.system
    body.tools = (payload.tools as Array<{ name: string; description: string; input_schema: unknown }>).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
    body.tool_choice = { type: 'function', function: { name: task.tool.name } }
    delete body.thinking
  }
  const started = Date.now()
  const response = await fetch(OPENROUTER_URL, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(BENCH_TIMEOUT_MILLIS) })
  const json = (await response.json()) as { choices?: Array<{ message?: { tool_calls?: Array<{ function: { name: string; arguments: string } }> } }>; usage?: { cost?: number }; error?: { message?: string } }
  const latencyMillis = Date.now() - started
  const base = { setup: setup.name, task: task.name, label: example.label, latencyMillis, costUsd: json.usage?.cost }
  if (!response.ok || json.error) return { ...base, ok: false, failure: `HTTP ${response.status}: ${json.error?.message ?? ''}`.slice(0, 140) }
  const call = json.choices?.[0]?.message?.tool_calls?.find((c) => c.function.name === task.tool.name)
  if (!call) return { ...base, ok: false, failure: 'no tool call' }
  let args: unknown
  try {
    args = JSON.parse(call.function.arguments)
  } catch {
    return { ...base, ok: false, failure: 'arguments are not JSON' }
  }
  const checked = validateOutput(task, example.input as never, args)
  const decision: Decision<unknown> = checked.ok
    ? { _tag: 'Decided', value: checked.value, meta: { model: setup.model, latencyMillis, attempts: 1 } }
    : { _tag: 'NoDecision', reason: 'invalid-output', detail: checked.message, meta: { model: setup.model, latencyMillis, attempts: 1 } }
  return { ...base, ...judge(example, decision) }
}

/** The provider's request, streamed, with the time of the first event and of the tool call's end. */
async function runStream(setup: StreamSetup, models: Models, apiKey: string, example: (typeof decisionExamples)[number]): Promise<Run> {
  const task = benchTask(example.task as StructuredTask<never>, setup)
  const model = models.getModel('openrouter', setup.model)
  if (!model) throw new Error(`unknown model ${setup.model}`)
  const tool = { name: task.tool.name, description: task.tool.description, parameters: task.output }
  const context = { systemPrompt: task.prompt, messages: [{ role: 'user' as const, content: task.render(example.input as never), timestamp: Date.now() }], tools: [tool] }
  const options: Record<string, unknown> = { apiKey, maxTokens: 1024, maxRetries: 0, signal: AbortSignal.timeout(BENCH_TIMEOUT_MILLIS) }
  if (model.api === 'anthropic-messages') {
    options.thinkingEnabled = false
    options.toolChoice = { type: 'tool', name: tool.name }
  } else options.toolChoice = { type: 'function', function: { name: tool.name } }
  const started = Date.now()
  let firstEventMillis: number | undefined
  let toolCallEndMillis: number | undefined
  let args: unknown
  let costUsd: number | undefined
  let failure: string | undefined
  for await (const event of models.stream(model, context, options as never)) {
    firstEventMillis ??= Date.now() - started
    if (event.type === 'toolcall_end' && event.toolCall.name === tool.name) {
      toolCallEndMillis = Date.now() - started
      args = event.toolCall.arguments
    } else if (event.type === 'error') failure = event.error.errorMessage ?? event.reason
    else if (event.type === 'done') costUsd = event.message.usage.cost.total
  }
  const latencyMillis = Date.now() - started
  const base = { setup: setup.name, task: task.name, label: example.label, latencyMillis, firstEventMillis, toolCallEndMillis, costUsd }
  if (failure) return { ...base, ok: false, failure }
  if (args === undefined) return { ...base, ok: false, failure: 'no tool call' }
  const checked = validateOutput(task, example.input as never, args)
  const decision: Decision<unknown> = checked.ok
    ? { _tag: 'Decided', value: checked.value, meta: { model: setup.model, latencyMillis, attempts: 1 } }
    : { _tag: 'NoDecision', reason: 'invalid-output', detail: checked.message, meta: { model: setup.model, latencyMillis, attempts: 1 } }
  return { ...base, ...judge(example, decision) }
}

/** The provider's classifier path: the task's own `classify` mapping on the chosen decision model. */
async function runClassify(setup: ClassifySetup, models: Models, apiKey: string, example: (typeof decisionExamples)[number]): Promise<Run | undefined> {
  const task = benchTask(example.task as StructuredTask<never>, setup)
  if (!task.classify) return undefined
  const provider = makePiAiProvider(Effect.succeed({ apiKey, models: { classifier: setup.model } }), models)
  const decision = await Effect.runPromise(provider.decide(task, example.input as never))
  return { setup: setup.name, task: task.name, label: example.label, latencyMillis: decision.meta.latencyMillis, costUsd: decision.meta.costUsd, ...judge(example, decision) }
}

async function runSetup(setup: Setup, models: Models, apiKey: string, reps: number, examples: typeof decisionExamples): Promise<Run[]> {
  const runs: Run[] = []
  for (let rep = 0; rep < reps; rep++) {
    for (const example of examples) {
      try {
        const run =
          setup.kind === 'tool'
            ? await runTool(setup, models, apiKey, example)
            : setup.kind === 'raw'
              ? await runRaw(setup, models, apiKey, example)
              : setup.kind === 'stream'
                ? await runStream(setup, models, apiKey, example)
                : await runClassify(setup, models, apiKey, example)
        if (run) runs.push(run)
      } catch (error) {
        runs.push({ setup: setup.name, task: example.task.name, label: example.label, latencyMillis: Number.NaN, ok: false, failure: `threw: ${error instanceof Error ? error.message : String(error)}`.slice(0, 140) })
      }
    }
  }
  return runs
}

function summarize(name: string, runs: Run[]): string {
  const latencies = runs.map((r) => r.latencyMillis).filter((n) => Number.isFinite(n))
  const ok = runs.filter((r) => r.ok).length
  const noDecision = runs.filter((r) => r.failure && r.failure !== 'not as expected').length
  const priced = runs.filter((r) => r.costUsd !== undefined)
  const perThousand = priced.length > 0 ? (priced.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) / priced.length) * 1000 : Number.NaN
  const stream = runs.filter((r) => r.firstEventMillis !== undefined)
  const extra =
    stream.length > 0
      ? ` first event p50 ${percentile(
          stream.map((r) => r.firstEventMillis!),
          50,
        )} ms, tool call end p50 ${percentile(
          stream.filter((r) => r.toolCallEndMillis !== undefined).map((r) => r.toolCallEndMillis!),
          50,
        )} ms`
      : ''
  return [
    name.padEnd(32),
    `n=${String(runs.length).padStart(3)}`,
    `p50 ${String(Math.round(percentile(latencies, 50))).padStart(5)} ms`,
    `p95 ${String(Math.round(percentile(latencies, 95))).padStart(5)} ms`,
    `acc ${String(Math.round((100 * ok) / Math.max(1, runs.length))).padStart(3)}%`,
    `nodec ${String(Math.round((100 * noDecision) / Math.max(1, runs.length))).padStart(3)}%`,
    `$/1k ${Number.isFinite(perThousand) ? perThousand.toFixed(3) : '  n/a'}`,
    extra,
  ].join('  ')
}

function accuracy(runs: Run[]): number {
  return runs.filter((r) => r.ok).length / Math.max(1, runs.length)
}

function perTask(runs: Run[]): string {
  const byTask = new Map<string, Run[]>()
  for (const run of runs) byTask.set(run.task, [...(byTask.get(run.task) ?? []), run])
  return [...byTask]
    .map(([task, list]) => `${task} ${list.filter((r) => r.ok).length}/${list.length} p50 ${Math.round(percentile(list.map((r) => r.latencyMillis).filter(Number.isFinite), 50))} ms`)
    .join(', ')
}

async function main(): Promise<void> {
  loadDotEnv()
  const apiKey = process.env.OPENROUTER_API_KEY
  if (process.argv.includes('--list')) {
    for (const setup of setups) console.log(`${setup.name.padEnd(32)} ${setup.kind.padEnd(9)} ${setup.model}`)
    return
  }
  if (!apiKey) {
    console.log('bench needs OPENROUTER_API_KEY in the environment or in .env. Nothing was run.')
    return
  }
  const reps = Number(arg('reps') ?? 3)
  const concurrency = Number(arg('concurrency') ?? 3)
  const wanted = arg('setups')?.split(',')
  const taskNames = arg('tasks')?.split(',')
  const chosen = wanted ? setups.filter((s) => wanted.includes(s.name)) : setups
  const examples = taskNames ? decisionExamples.filter((e) => taskNames.includes(e.task.name)) : decisionExamples
  const models = createModels()
  models.setProvider(openrouterProvider())
  console.log(`ai:bench, ${chosen.length} setups, ${examples.length} examples, ${reps} reps, concurrency ${concurrency}\n`)

  const results = new Map<string, Run[]>()
  const queue = [...chosen]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let setup = queue.shift(); setup; setup = queue.shift()) {
      const runs = await runSetup(setup, models, apiKey, reps, examples)
      results.set(setup.name, runs)
      console.log(summarize(setup.name, runs))
      console.log(`${''.padEnd(32)}  ${perTask(runs)}`)
      const failures = runs.filter((r) => r.failure)
      for (const f of failures.slice(0, 6)) console.log(`${''.padEnd(32)}  ${f.task} "${f.label}": ${f.failure}${f.output ? ` ${JSON.stringify(f.output).slice(0, 100)}` : ''}`)
      if (failures.length > 6) console.log(`${''.padEnd(32)}  ... ${failures.length - 6} more`)
    }
  })
  await Promise.all(workers)

  console.log('\nsummary (sorted by accuracy, then p50)')
  const rows = [...results].toSorted(([, a], [, b]) => accuracy(b) - accuracy(a) || percentile(a.map((r) => r.latencyMillis), 50) - percentile(b.map((r) => r.latencyMillis), 50))
  for (const [name, runs] of rows) console.log(summarize(name, runs))
  const spent = [...results.values()].flat().reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
  console.log(`\ncatalogue cost of this run: $${spent.toFixed(4)}`)
}

await main()
