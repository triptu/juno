#!/usr/bin/env node
/**
 * `pnpm ai:eval`: runs every task on the invented examples and prints the
 * output, latency and cost, so prompt quality can be judged by eye.
 *
 * Default: the fake provider. `JUNO_AI=live` uses OpenRouter through pi-ai with
 * `OPENROUTER_API_KEY` from the environment or the repo's `.env`. Without a key
 * it says so and exits 0. `JUNO_AI_CLASSIFIER_MODEL` (empty for none),
 * `JUNO_AI_DECISION_MODEL` and `JUNO_AI_GENERATION_MODEL` override the default
 * slugs for the run.
 */
import { Effect } from 'effect'
import { fileURLToPath } from 'node:url'
import { makeFakeAiProvider, makePiAiProvider, openRouterModels, type AiConfig, type AiProviderShape, type Decision, type Task } from '../src/index'
import { examples } from './examples'

function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)))
  } catch {
    // No .env: the environment alone decides.
  }
}

function pickProvider(): { provider: AiProviderShape; mode: 'fake' | 'live' } | undefined {
  const mode = process.env.JUNO_AI ?? 'fake'
  if (mode !== 'live') return { provider: makeFakeAiProvider(), mode: 'fake' }
  loadDotEnv()
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.log('JUNO_AI=live needs OPENROUTER_API_KEY in the environment or in .env. Nothing was run.')
    return undefined
  }
  const config: AiConfig = {
    apiKey,
    models: {
      ...(process.env.JUNO_AI_CLASSIFIER_MODEL !== undefined ? { classifier: process.env.JUNO_AI_CLASSIFIER_MODEL } : {}),
      ...(process.env.JUNO_AI_DECISION_MODEL ? { decision: process.env.JUNO_AI_DECISION_MODEL } : {}),
      ...(process.env.JUNO_AI_GENERATION_MODEL ? { generation: process.env.JUNO_AI_GENERATION_MODEL } : {}),
    },
  }
  return { provider: makePiAiProvider(Effect.succeed(config), openRouterModels()), mode: 'live' }
}

function runOne(provider: AiProviderShape, task: Task<never>, input: never): Effect.Effect<Decision<unknown>> {
  return task.shape === 'structured' ? provider.decide(task, input) : provider.generate(task, input)
}

function show(decision: Decision<unknown>): string {
  if (decision._tag === 'NoDecision') return `no decision (${decision.reason}${decision.detail ? `: ${decision.detail}` : ''})`
  return typeof decision.value === 'string' ? JSON.stringify(decision.value) : JSON.stringify(decision.value, null, 2)
}

async function main(): Promise<void> {
  const picked = pickProvider()
  if (!picked) return
  const { provider, mode } = picked
  const only = process.argv[2]
  let totalCost = 0
  let totalLatency = 0
  let noDecisions = 0
  let expected = 0
  let matched = 0
  const chosen = only ? examples.filter((e) => e.task.name === only) : examples
  console.log(`ai:eval, ${mode} provider, ${chosen.length} examples\n`)
  for (const example of chosen) {
    const decision = await Effect.runPromise(runOne(provider, example.task, example.input as never))
    const { meta } = decision
    totalCost += meta.costUsd ?? 0
    totalLatency += meta.latencyMillis
    if (decision._tag === 'NoDecision') noDecisions++
    let verdict = ''
    if (example.expect) {
      expected++
      const ok = decision._tag === 'Decided' && example.expect(decision.value as never)
      if (ok) matched++
      verdict = ok ? ', as expected' : ', NOT as expected'
    }
    const cost = meta.costUsd === undefined ? 'cost unknown' : `$${meta.costUsd.toFixed(5)}`
    console.log(`## ${example.task.name} (${example.task.tier}): ${example.label}`)
    console.log(`   ${meta.model}, ${meta.latencyMillis} ms, ${cost}, ${meta.attempts} attempt(s)${verdict}`)
    console.log(show(decision).replace(/^/gm, '   '))
    console.log()
  }
  console.log(`total: ${chosen.length} runs, ${noDecisions} no decision, ${matched}/${expected} as expected, ${totalLatency} ms, $${totalCost.toFixed(5)}`)
}

await main()
