import { splitLanguageTag } from '@juno/highlight'
import type { ContentBlock } from './model'

/**
 * A code block, with a first line that is only a language tag (```ts, the
 * Discord convention) read as its language and left out of the text.
 */
export function codeBlock(text: string): ContentBlock {
  const { language, code } = splitLanguageTag(text)
  return language === undefined ? { kind: 'code', text: code } : { kind: 'code', text: code, language }
}
