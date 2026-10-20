// Regenerate with node scripts/emoji-codec.mjs after changing the schema or Effect.
import './ts-resolve-hooks.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { compile } from 'effect/schema/SchemaAOTCompiler'
const { WorkspaceEmojiValue } = await import('../packages/contract/src/routes/mentions.ts')

const path = new URL('../packages/state/src/emojiCodec.generated.mjs', import.meta.url)
const source = '/* oxlint-disable */\n' + compile([{ ast: WorkspaceEmojiValue.ast, operations: ['decode'] }])
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== source) throw new Error('Emoji codec is stale. Run node scripts/emoji-codec.mjs')
} else writeFileSync(path, source)
