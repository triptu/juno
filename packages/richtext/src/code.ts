import { splitLanguageTag } from '@juno/highlight'
import type { ContentBlock } from './model'

/**
 * A code block. A first line that is only a language tag (```ts, the
 * Discord convention) names its language and is marked `tagLine`; `text`
 * keeps that line, so the edit field, the fallback text and anything sent
 * back to Slack have the code as written. Only the view leaves it out.
 */
export function codeBlock(text: string): ContentBlock {
  const { language } = splitLanguageTag(text)
  return language === undefined ? { kind: 'code', text } : { kind: 'code', text, language, tagLine: true }
}
