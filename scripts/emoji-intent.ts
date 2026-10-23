#!/usr/bin/env bun
/**
 * Writes scripts/emoji-intent.json: for each standard emoji, the everyday
 * phrases people type when they want it ("ugh", "so done" for 😩), written by
 * a model. `scripts/emoji-catalog.mjs` reads the file, applies its hand-edited
 * overrides and writes the words into the search keywords. Nothing runs this
 * at build time; the output is checked in.
 *
 *   bun scripts/emoji-intent.ts         asks only for emoji the file lacks
 *   bun scripts/emoji-intent.ts --all   asks for every emoji again
 *
 * Uses OpenRouter through `@juno/ai` with `OPENROUTER_API_KEY` from the
 * environment or the repo's `.env`. `JUNO_AI_GENERATION_MODEL` overrides the
 * model. Flags and keycaps get no phrases. Run `bun scripts/emoji-catalog.mjs`
 * afterwards.
 */
import { Effect } from 'effect'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineStructuredTask, makePiAiProvider, openRouterModels, Type } from '../packages/ai/src/index.ts'
import { emojiCatalog } from '../packages/richtext/src/emoji.ts'
import { keywordData } from '../packages/richtext/src/emoji-keywords.ts'

const MODEL = 'google/gemini-3.8-flash'
const OUT = fileURLToPath(new URL('emoji-intent.json', import.meta.url))
const BATCH = 25
const PARALLEL = 6

interface Ask {
  readonly glyph: string
  readonly category: string
  readonly names: ReadonlyArray<string>
  readonly words: string
}

const PROMPT = `You help an emoji search in a chat app understand intent. For each emoji you get, write the short everyday phrases people type in a search box when they want to send that emoji in chat.

Write what people actually say: reactions, slang, workplace phrases and common feelings. Examples:
😩 ugh, exhausted, monday, so done, over it
🫡 on it, will do, roger, yes sir, noted
🙃 fine, sure, whatever, great just great
💀 dead, dying, im dead, lmao
🤌 chefs kiss, perfect, italian
🚢 ship it, shipped, launch, release

Rules:
- 8 to 15 phrases for emoji people often send in chat (faces, gestures, hearts, common symbols and objects).
- 2 to 6 phrases for emoji rarely sent in chat (most animals, food, places, tools, signs). Never pad with weak phrases.
- Each phrase is 1 to 3 words, lowercase, no punctuation, no emoji, no apostrophes (write "im", "chefs kiss").
- Do not repeat the emoji's names or the words already listed for it. Do not describe how it looks ("yellow", "face", "circle").
- Every phrase must be something a person would mean by this emoji, not a loose association.
- Nothing offensive, sexual or hateful. No names of real people, brands, products, companies, teams or places.
- For people emoji that differ only by gender, give the same intent phrases.

Call the tool once with every emoji you were given, in the same order, using the exact emoji characters.`

const output = Type.Object({
  emoji: Type.Array(Type.Object({ glyph: Type.String(), phrases: Type.Array(Type.String()) })),
})

const task = defineStructuredTask({
  name: 'emojiIntent',
  version: 1,
  tier: 'generation',
  timeoutMillis: 180_000,
  maxTokens: 12_000,
  prompt: PROMPT,
  tool: { name: 'emoji_phrases', description: 'The search phrases for each emoji.' },
  output,
  render: (asks: ReadonlyArray<Ask>) => asks.map((ask) => `${ask.glyph} (${ask.category}) names: ${ask.names.join(', ')}${ask.words === '' ? '' : `; already listed: ${ask.words}`}`).join('\n'),
  key: () => '',
  accept: (answer, asks) => asks.every((ask) => answer.emoji.some((row) => row.glyph.replaceAll('️', '') === ask.glyph.replaceAll('️', ''))),
})

function provider() {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
  } catch {
    // No .env: the environment alone decides.
  }
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('Needs OPENROUTER_API_KEY in the environment or in .env.')
  const generation = process.env.JUNO_AI_GENERATION_MODEL || MODEL
  return { model: generation, ai: makePiAiProvider(Effect.succeed({ apiKey, models: { generation } }), openRouterModels()) }
}

const lines = keywordData.split('\n')
const asks: Ask[] = []
let order = 0
for (const category of emojiCatalog) {
  for (const emoji of category.emoji) {
    const [chat = '', related = ''] = (lines[order++] ?? '').split('|')
    if (category.name === 'Flags' || emoji.name.startsWith('keycap') || /^[0-9#*]️?⃣$/u.test(emoji.unicode)) continue
    asks.push({ glyph: emoji.unicode, category: category.name, names: [emoji.name, ...emoji.aliases ?? []], words: `${chat} ${related}`.trim() })
  }
}

const saved: Record<string, ReadonlyArray<string>> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const todo = process.argv.includes('--all') ? asks : asks.filter((ask) => saved[ask.glyph] === undefined)
const { model, ai } = provider()
console.log(`Asking ${model} for ${todo.length} of ${asks.length} emoji`)

const clean = (phrase: string) => phrase.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}+ ]+/gu, ' ').replace(/\s+/g, ' ').trim()
const batches: Ask[][] = []
for (let at = 0; at < todo.length; at += BATCH) batches.push(todo.slice(at, at + BATCH))
let cost = 0
let failed = 0
const write = () => {
  const rows = asks.filter((ask) => saved[ask.glyph] !== undefined).map((ask) => `  ${JSON.stringify(ask.glyph)}: ${JSON.stringify(saved[ask.glyph])}`)
  writeFileSync(OUT, `{\n${rows.join(',\n')}\n}\n`)
}
await Effect.runPromise(Effect.forEach(batches, (batch, index) => ai.decide(task, batch).pipe(Effect.map((decision) => {
  cost += decision.meta.costUsd ?? 0
  if (decision._tag !== 'Decided') {
    failed += batch.length
    console.log(`batch ${index + 1}/${batches.length}: no decision, ${decision.reason} ${decision.detail ?? ''}`)
    return
  }
  for (const ask of batch) {
    const row = decision.value.emoji.find((answer) => answer.glyph.replaceAll('️', '') === ask.glyph.replaceAll('️', ''))
    saved[ask.glyph] = [...new Set((row?.phrases ?? []).map(clean).filter((phrase) => phrase !== ''))]
  }
  write()
  console.log(`batch ${index + 1}/${batches.length} done, $${cost.toFixed(3)} so far`)
})), { concurrency: PARALLEL, discard: true }))
write()
console.log(`Wrote ${asks.filter((ask) => saved[ask.glyph] !== undefined).length} emoji to ${OUT}. ${failed} failed; rerun to ask for them. Cost $${cost.toFixed(3)}.`)
