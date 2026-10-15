#!/usr/bin/env node
/**
 * `pnpm agent:eval`: runs the Juno Agent eval cases and prints the report.
 *
 *   pnpm agent:eval                         the scripted model, as CI runs it
 *   pnpm agent:eval --live                  OpenRouter, the default chat model (Sonnet)
 *   pnpm agent:eval --live --model haiku    another family; repeat --model to run several
 *   pnpm agent:eval --case remember         only these cases; repeatable
 *   pnpm agent:eval --live --judge opus     the judge's family (default opus)
 *
 * Live runs need `OPENROUTER_API_KEY` in the environment or in the repo's
 * `.env`, cost money, and save their report under `eval/reports/`. A
 * scripted run saves only with `--save`.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DEFAULT_CHAT_FAMILY, DEFAULT_COMPACTION_FAMILY, type ModelFamily } from '../src/index'
import { piFamilyModel } from '../src/providers/catalog'
import { CASES } from './cases'
import { passed, markdown, save, type RunInfo } from './report'
import { openRouterJudge, scriptedJudge } from './judge'
import { fakeBackend, openRouterBackend, runSuite } from './suite'

const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    model: { type: 'string', multiple: true },
    case: { type: 'string', multiple: true },
    judge: { type: 'string', default: 'opus' },
    save: { type: 'boolean', default: false },
  },
})

const cases = values.case ? CASES.filter((c) => values.case!.includes(c.id)) : CASES
if (cases.length === 0) throw new Error(`no case named ${values.case!.join(', ')}; the cases are ${CASES.map((c) => c.id).join(', ')}`)
const reports = fileURLToPath(new URL('./reports', import.meta.url))
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
const date = new Date().toISOString().slice(0, 10)

function family(name: string) {
  const model = piFamilyModel(name as ModelFamily)
  if (model === undefined) throw new Error(`no ${name} model in the catalogue; families are sonnet, opus, muse, sol, grok, haiku, flash`)
  return model
}

function openRouterKey(): string | undefined {
  // The app reads the key from main's keychain bridge; until the eval can reach it, the environment or .env.
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)))
  } catch {
    // No .env: the environment alone decides.
  }
  return process.env.OPENROUTER_API_KEY || undefined
}

async function main(): Promise<void> {
  if (!values.live) {
    const started = Date.now()
    const results = await runSuite(cases, { backend: fakeBackend, judge: () => scriptedJudge(), timeoutMs: 30_000, onCase: progress })
    const info: RunInfo = { date, commit, mode: 'fake', model: 'scripted', judge: 'scripted', seconds: (Date.now() - started) / 1000 }
    finish(info, results, values.save)
    return
  }
  const key = openRouterKey()
  if (key === undefined) {
    console.log('A live run needs OPENROUTER_API_KEY in the environment or in the repo .env. Nothing was run.')
    return
  }
  const apiKey = async () => key
  const judge = family(values.judge)
  const helper = family(DEFAULT_COMPACTION_FAMILY)
  for (const name of values.model ?? [DEFAULT_CHAT_FAMILY]) {
    const chat = family(name)
    console.error(`\n${chat.id}, judged by ${judge.id}`)
    const started = Date.now()
    const results = await runSuite(cases, {
      backend: () => openRouterBackend(chat, helper, apiKey),
      judge: () => openRouterJudge({ model: judge.id, apiKey }),
      timeoutMs: 180_000,
      onCase: progress,
    })
    finish({ date, commit, mode: 'live', model: chat.id, judge: judge.id, seconds: (Date.now() - started) / 1000 }, results, true)
  }
}

function progress(result: Parameters<typeof passed>[0]): void {
  console.error(`  ${passed(result) ? 'pass' : 'FAIL'}  ${result.id}${result.error ? ` (${result.error})` : ''}`)
}

function finish(info: RunInfo, results: Parameters<typeof markdown>[1], keep: boolean): void {
  console.log(`\n${markdown(info, results)}`)
  if (keep) console.log(`Saved ${save(reports, info, results)}`)
  if (info.mode === 'fake' && !results.every(passed)) process.exitCode = 1
}

await main()
