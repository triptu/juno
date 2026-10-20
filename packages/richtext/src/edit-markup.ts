/**
 * A message as the edit field starts with it (spec section 8): its
 * `rich_text` written back as the composer's markup, so the styles show in
 * the field and saving it unchanged sends them again (`composeOutgoing`).
 * Mentions read as "@Maya Chen" and "#eng", which the edit's
 * `MentionTargets` turn back into mentions; a link reads as its words,
 * which `MentionTargets.links` links again.
 */
import type { RichTextElement, RichTextInline, RichTextStyle } from '@juno/slack-schema'
import type { Lookups } from './model'
import { plainText, messageBody, type MessageContent } from './body'
import { channelInline, dateInline, emojiInline, inlineText, usergroupInline, userInline } from './inline'
import { MARKER_OF, type MarkupStyle } from './markup'

/** Markers open in this order, so code is always innermost: nothing inside code is markup. */
const ORDER: ReadonlyArray<MarkupStyle> = ['bold', 'italic', 'strike', 'code']

function stylesOf(style: RichTextStyle | undefined): ReadonlySet<MarkupStyle> {
  return new Set(ORDER.filter((name) => style?.[name] === true))
}

/** What an element reads as in the field. */
function fieldText(element: RichTextInline, lookups: Lookups): string {
  switch (element.type) {
    case 'text':
      return element.text
    case 'user':
      return inlineText([userInline(element.user_id, lookups)])
    case 'channel':
      return inlineText([channelInline(element.channel_id, undefined, lookups)])
    case 'usergroup':
      return inlineText([usergroupInline(element.usergroup_id, undefined, lookups)])
    case 'broadcast':
      return `@${element.range}`
    case 'emoji':
      return inlineText([emojiInline(element.name, lookups, element.unicode)])
    case 'link':
      return element.text ?? element.url
    case 'date':
      return inlineText([dateInline(element.timestamp, element.format, element.fallback, element.url)])
    case 'color':
      return element.value
    case 'unknown':
      return typeof element.raw['text'] === 'string' ? element.raw['text'] : ''
  }
}

/**
 * Inline elements as markup. Each element carries its own markers; spaces at an element's edges go outside its markers, where markers
 * count. A style over a line break closes before it and opens again after.
 */
export function inlineMarkup(elements: ReadonlyArray<RichTextInline>, lookups: Lookups): string {
  return elements.map((element) => {
    const styles = stylesOf('style' in element ? element.style : undefined)
    return fieldText(element, lookups).split('\n').map((line) => {
      const core = line.trim()
      if (core === '') return line
      const markers = ORDER.filter((name) => styles.has(name)).map((name) => MARKER_OF[name])
      const escaped = element.type === 'link' && element.text === undefined ? core : core.replace(styles.has('code') ? /[\\`]/g : /[\\*_~`>]/g, '\\$&')
      return line.slice(0, line.length - line.trimStart().length) + markers.join('') + escaped + markers.toReversed().join('') + line.slice(line.trimEnd().length)
    }).join('\n')
  }).join('')
}

export function elementMarkup(element: RichTextElement, lookups: Lookups): string | undefined {
  switch (element.type) {
    case 'rich_text_section':
    case 'rich_text_header':
      return inlineMarkup(element.elements, lookups)
    case 'rich_text_quote':
      return inlineMarkup(element.elements, lookups)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    case 'rich_text_preformatted':
      return `\`\`\`\n${element.elements.map((el) => fieldText(el, lookups)).join('').replace(/[\\`]/g, '\\$&')}\n\`\`\``
    case 'rich_text_list':
      return element.elements.map((item) => inlineMarkup(item.elements, lookups)).join('\n')
    case 'rich_text_divider':
      return undefined
    case 'unknown':
      return typeof element.raw['text'] === 'string' ? element.raw['text'] : undefined
  }
}

/**
 * The text the edit field starts with for a message of your own. A message
 * with `rich_text` is written as markup; any other reads as plain text,
 * without the names of its files.
 */
export function editMarkup(content: MessageContent, lookups: Lookups = {}): string {
  const richText = (content.blocks ?? []).flatMap((block) => (block.type === 'rich_text' ? block.elements : []))
  if (richText.length > 0) return richText.flatMap((element) => elementMarkup(element, lookups) ?? []).join('\n')
  return plainText(messageBody({ ...(content.text === undefined ? {} : { text: content.text }), ...(content.blocks === undefined ? {} : { blocks: content.blocks }) }, lookups))
}
