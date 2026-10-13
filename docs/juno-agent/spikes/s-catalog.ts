// Model catalogue: resolve the newest model per family from OpenRouter's public catalogue,
// filtered as plan v3 §7.1 says, and join with pi-ai 1.2.0's own catalogue. No key needed.
// Run: node docs/juno-agent/spikes/s-catalog.ts
import { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models'
import { OPENROUTER_MODELS } from '@earendil-works/pi-ai/providers/openrouter.models'

type OrModel = {
  id: string
  created: number
  context_length: number
  supported_parameters?: string[]
  architecture?: { output_modalities?: string[] }
  pricing?: { prompt?: string; completion?: string }
}

// One pattern per family. A version is digits and dots; Muse names its releases with words.
const families = [
  { family: 'Claude Sonnet', re: /^anthropic\/claude-sonnet-\d+(?:\.\d+)*$/ },
  { family: 'Claude Opus', re: /^anthropic\/claude-opus-\d+(?:\.\d+)*$/ },
  { family: 'Muse', re: /^meta\/muse-[a-z]+(?:-\d+(?:\.\d+)*)?$/ },
  { family: 'GPT Sol', re: /^openai\/gpt-\d+(?:\.\d+)*-sol$/ },
  { family: 'Grok', re: /^x-ai\/grok-\d+(?:\.\d+)*$/ },
  { family: 'Compaction: Claude Haiku', re: /^anthropic\/claude-haiku-\d+(?:\.\d+)*$/, minWindow: 64_000 },
  { family: 'Compaction: Gemini Flash', re: /^google\/gemini-\d+(?:\.\d+)*-flash$/, minWindow: 64_000 },
]
const CHAT_MIN_WINDOW = 250_000

const response = await fetch('https://openrouter.ai/api/v1/models')
const all = ((await response.json()) as { data: OrModel[] }).data
console.log(`OpenRouter catalogue: ${all.length} models`)

const usable = all.filter(
  (m) =>
    (m.supported_parameters ?? []).includes('tools') &&
    !m.id.includes(':') &&
    !m.id.startsWith('~') &&
    !/-(pro|contributor|preview|lite|image)(?:$|-)/.test(m.id) &&
    (m.architecture?.output_modalities ?? ['text']).every((x) => x === 'text'),
)
console.log(`after tools, :variant, alias, -pro/-contributor/-preview/-lite/-image and image filters: ${usable.length}`)

const piCatalogue = OPENROUTER_MODELS as Record<string, { api: string }>
for (const { family, re, minWindow = CHAT_MIN_WINDOW } of families) {
  const candidates = usable.filter((m) => re.test(m.id) && m.context_length >= minWindow).sort((a, b) => b.created - a.created)
  const pick = candidates[0]
  if (!pick) {
    console.log(`${family}: none`)
    continue
  }
  const perMillion = (price?: string) => (Number(price ?? 0) * 1e6).toFixed(2)
  console.log(
    `${family}: ${pick.id} (released ${new Date(pick.created * 1000).toISOString().slice(0, 10)}, ` +
      `${pick.context_length} tokens, $${perMillion(pick.pricing?.prompt)}/$${perMillion(pick.pricing?.completion)} per M in/out, ` +
      `pi-ai api: ${piCatalogue[pick.id]?.api ?? 'not listed'}; runner-up ${candidates[1]?.id ?? 'none'})`,
  )
}

const codexSol = Object.values(OPENAI_CODEX_MODELS as Record<string, { id: string; contextWindow: number }>)
  .filter((m) => /sol/.test(m.id))
  .map((m) => `${m.id} (${m.contextWindow})`)
console.log(`pi-ai openai-codex catalogue, Sol models: ${codexSol.join(', ')}`)
