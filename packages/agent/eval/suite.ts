/**
 * Runs cases on a backend and grades them. CI uses `fakeBackend`, which
 * plays each case's script; live runs use `openRouterBackend`.
 */
import { fakeProvider } from '@juno/agent-testing'
import { createOpenRouter, createProviderGuard, type ModelRef } from '../src/index'
import type { Case } from './cases'
import { runSteps, type Backend } from './engine'
import { grade, type CaseResult } from './grade'
import type { Judge } from './judge'

/** A model as pi-ai's catalogue describes it (only `src/providers` imports pi-ai). */
export type CatalogueModel = Parameters<typeof createOpenRouter>[0]['models'][number]

const SONNET: ModelRef = { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' }
const HAIKU: ModelRef = { provider: 'openrouter', modelId: 'anthropic/claude-haiku-5.5' }

/** The scripted model plays the case's script. */
export function fakeBackend(c: Case): Backend {
  const fake = fakeProvider()
  fake.script(c.script)
  return { model: SONNET, helper: HAIKU, provider: (store) => createProviderGuard({ store, transport: fake.models }) }
}

/** OpenRouter through the app's guard, with `chat` as the chat model and `helper` for delegated tasks. */
export function openRouterBackend(chat: CatalogueModel, helper: CatalogueModel, apiKey: () => Promise<string | undefined>): Backend {
  const models = chat.id === helper.id ? [chat] : [chat, helper]
  return {
    model: { provider: chat.provider, modelId: chat.id },
    helper: { provider: helper.provider, modelId: helper.id },
    provider: (store) => createOpenRouter({ store, models, apiKey }),
  }
}

export interface SuiteOptions {
  readonly backend: (c: Case) => Backend
  readonly judge: (c: Case) => Judge
  /** Per step. */
  readonly timeoutMs: number
  readonly onCase?: (result: CaseResult) => void
}

export async function runSuite(cases: ReadonlyArray<Case>, options: SuiteOptions): Promise<ReadonlyArray<CaseResult>> {
  const results: CaseResult[] = []
  for (const c of cases) {
    let result: CaseResult
    try {
      const trace = await runSteps(c.steps, options.backend(c), options.timeoutMs)
      result = await grade(c.id, c.checks, trace, options.judge(c))
    } catch (error) {
      result = { id: c.id, checks: [], error: error instanceof Error ? error.message : String(error) }
    }
    options.onCase?.(result)
    results.push(result)
  }
  return results
}
