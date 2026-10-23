#!/usr/bin/env node
/**
 * `bun run agent:eval`: runs the Juno Agent eval cases and prints the report.
 *
 *   bun run agent:eval                         the scripted model, as CI runs it
 *   bun run agent:eval --live                  OpenRouter, the default chat model (Sonnet)
 *   bun run agent:eval --live --model haiku    another family; repeat --model to run several
 *   bun run agent:eval --case remember         only these cases; repeatable
 *   bun run agent:eval --live --judge opus     the judge's family (default opus)
 *   bun run agent:eval --live --case x --repeat 3   run the cases 3 times, to tell noise from a change
 *
 * Live runs need `OPENROUTER_API_KEY` in the environment or in the repo's
 * `.env` and cost money. A full live run saves its report under
 * `eval/reports/`; a run of some cases, or a repeated one, saves nothing
 * there, so it never replaces a full report, and writes its transcripts to
 * the system temp folder. A scripted run saves only with `--save`.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DEFAULT_CHAT_FAMILY, DEFAULT_COMPACTION_FAMILY, type ModelFamily } from '../src/index'
import { piFamilyModel } from '../src/providers/catalog'
import { CASES } from './cases'
import { passed, markdown, save, transcripts, type RunInfo } from './report'
import { openRouterJudge, scriptedJudge } from './judge'
import { fakeBackend, openRouterBackend, runSuite } from './suite'

const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    model: { type: 'string', multiple: true },
    case: { type: 'string', multiple: true },
    judge: { type: 'string', default: 'opus' },
    save: { type: 'boolean', default: false },
    repeat: { type: 'string', default: '1' },
  },
})
const repeat = Number(values.repeat)
if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`--repeat takes a whole number of runs, not ${values.repeat}`)

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
  const full = values.case === undefined && repeat === 1
  const scratch = full ? undefined : mkdtempSync(join(tmpdir(), 'juno-eval-'))
  for (const name of values.model ?? [DEFAULT_CHAT_FAMILY]) {
    const chat = family(name)
    for (let n = 1; n <= repeat; n++) {
      console.error(`\n${chat.id}, judged by ${judge.id}${repeat > 1 ? `, run ${n} of ${repeat}` : ''}`)
      const started = Date.now()
      let cost = 0
      let unknown = 0
      const results = await runSuite(cases, {
        backend: () => ({ ...openRouterBackend(chat, helper, apiKey), spent: (amount, unsettled) => { cost += amount; unknown += unsettled } }),
        judge: () => openRouterJudge({ model: judge.id, apiKey, spent: (amount) => { if (amount === undefined) unknown++; else cost += amount } }),
        timeoutMs: 180_000,
        onCase: progress,
      })
      const info: RunInfo = { date, commit, mode: 'live', cost, unknown, model: chat.id, judge: judge.id, seconds: (Date.now() - started) / 1000 }
      finish(info, results, full)
      if (scratch !== undefined) {
        const file = join(scratch, `${chat.id.replace(/[^\w.-]+/g, '-')}-${n}.transcripts.md`)
        writeFileSync(file, transcripts(results))
        console.log(`Transcripts in ${file}`)
      }
    }
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
