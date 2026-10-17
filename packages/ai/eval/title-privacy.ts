#!/usr/bin/env node
/**
 * `pnpm --filter @juno/ai eval:title-privacy`: titles the invented threads in
 * `title-privacy-cases.ts` with the prompt before the sensitive-details rule
 * (version 1, kept below) and with the current one, and prints both, so the
 * rule can be judged by eye (SPEC section 2, Topic titles).
 *
 * Default: the fake provider, which only shows the script works. `JUNO_AI=live`
 * uses OpenRouter with `OPENROUTER_API_KEY` from the environment or the repo's
 * `.env`; `JUNO_AI_GENERATION_MODEL` overrides the slug. `--after` runs only the
 * current prompt.
 */
import { Effect } from 'effect'
import { fileURLToPath } from 'node:url'
import { makeFakeAiProvider, makePiAiProvider, openRouterModels, PLAIN_TEXT_RULES, tasks, type AiProviderShape, type Decision, type TextTask, type TitleTopicInput } from '../src/index'
import { titleCases, type TitleCase } from './title-privacy-cases'

/** The `titleTopic` prompt at version 1, before the rule. */
const BEFORE_PROMPT = `You name Slack conversations for a calm desktop client. A title is a short noun phrase a reader scans in a sidebar, like "Staging bill doubled since August" or "Postgres 16 migration plan".

Rules:
Write 3 to 8 words. Sentence case. No final period. No quotes.
Name the subject, not the activity: "Pricing page copy", not "Discussion about pricing page copy".
Keep names of systems, people and numbers that identify the subject.
Do not start with "Re:", "Thread:" or the channel name.
If the messages are too thin to name, repeat the first message's main clause, shortened.
${PLAIN_TEXT_RULES}

Answer with the title only.`

const before: TextTask<TitleTopicInput> = { ...tasks.titleTopic, version: 1, prompt: BEFORE_PROMPT }

function provider(): { provider: AiProviderShape; mode: string } | undefined {
  if (process.env.JUNO_AI !== 'live') return { provider: makeFakeAiProvider(), mode: 'fake' }
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)))
  } catch {
    // No .env: the environment alone decides.
  }
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.log('JUNO_AI=live needs OPENROUTER_API_KEY in the environment or in .env. Nothing was run.')
    return undefined
  }
  const generation = process.env.JUNO_AI_GENERATION_MODEL
  return { provider: makePiAiProvider(Effect.succeed({ apiKey, models: generation ? { generation } : {} }), openRouterModels()), mode: 'live' }
}

/** What a title gets wrong: the leaked details of a sensitive case, or "vague" for an ordinary one with none of its words. */
function problems(test: TitleCase, title: string): ReadonlyArray<string> {
  const lower = title.toLowerCase()
  if (test.kind === 'sensitive') return (test.leaks ?? []).filter((leak) => lower.includes(leak.toLowerCase()))
  return (test.keeps ?? []).some((keep) => lower.includes(keep.toLowerCase())) ? [] : ['vague']
}

const shown = (decision: Decision<string>) => (decision._tag === 'Decided' ? decision.value : `(no decision: ${decision.reason})`)

async function main(): Promise<void> {
  const picked = provider()
  if (picked === undefined) return
  const afterOnly = process.argv.includes('--after')
  console.log(`title privacy eval, ${picked.mode} provider, ${titleCases.length} cases\n`)
  let cost = 0
  const failed = { before: 0, after: 0 }
  for (const test of titleCases) {
    const run = (task: TextTask<TitleTopicInput>) => Effect.runPromise(picked.provider.generate(task, test.input))
    const [old, now] = await Promise.all([afterOnly ? Promise.resolve(undefined) : run(before), run(tasks.titleTopic)])
    cost += (old?.meta.costUsd ?? 0) + (now.meta.costUsd ?? 0)
    console.log(`## ${test.kind}: ${test.label}`)
    for (const [name, decision] of [['before', old], ['after', now]] as const) {
      if (decision === undefined) continue
      const found = decision._tag === 'Decided' ? problems(test, decision.value) : ['no title']
      if (found.length > 0) failed[name]++
      console.log(`   ${name.padEnd(6)} ${shown(decision)}${found.length > 0 ? `   [${found.join(', ')}]` : ''}`)
    }
    console.log()
  }
  const total = titleCases.length
  console.log(`${afterOnly ? '' : `before: ${total - failed.before}/${total} pass. `}after: ${total - failed.after}/${total} pass. Cost $${cost.toFixed(4)}.`)
}

await main()
