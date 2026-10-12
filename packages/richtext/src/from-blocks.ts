/** Slack `blocks` → `MessageBody`. `rich_text` is rendered faithfully; layout blocks get a plain rendering. */
import type { Block, Inline, ListStyle, Lookups, MessageBody } from './model'
import type { MessageBlock, RichTextElement, RichTextInline, RichTextListStyle, TextObject } from './slack-types'
import { channelInline, emojiInline, inlineText, normalize, textRuns, toStyle, usergroupInline, userInline } from './inline'
import { mrkdwnBlocks, mrkdwnInlines } from './from-mrkdwn'

function inlineFromElement(el: RichTextInline, lookups: Lookups): Inline[] {
  switch (el.type) {
    case 'text':
      return textRuns(el.text, toStyle(el.style))
    case 'user':
      return [userInline(el.user_id, lookups)]
    case 'channel':
      return [channelInline(el.channel_id, undefined, lookups)]
    case 'usergroup':
      return [usergroupInline(el.usergroup_id, undefined, lookups)]
    case 'broadcast':
      return [{ kind: 'broadcast', range: el.range }]
    case 'emoji': {
      const name = el.skin_tone !== undefined && !el.name.includes('::') ? `${el.name}::skin-tone-${el.skin_tone}` : el.name
      return [emojiInline(name, lookups, el.unicode)]
    }
    case 'link': {
      const style = toStyle(el.style)
      const text = el.text ?? el.url
      return [style ? { kind: 'link', url: el.url, text, style } : { kind: 'link', url: el.url, text }]
    }
    case 'date':
      return textRuns(el.fallback ?? '')
    case 'color':
      return textRuns(el.value)
    default: {
      // Kinds we do not know. Show their text if they have any.
      const other = el as { readonly text?: unknown; readonly fallback?: unknown }
      const text = typeof other.text === 'string' ? other.text : typeof other.fallback === 'string' ? other.fallback : ''
      return textRuns(text)
    }
  }
}

function inlinesFromElements(elements: ReadonlyArray<RichTextInline>, lookups: Lookups): Inline[] {
  return normalize(elements.flatMap((el) => inlineFromElement(el, lookups)))
}

function listStyle(style: RichTextListStyle): ListStyle {
  switch (style) {
    case 'ordered':
      return 'ordered'
    case 'checked':
      return 'checked'
    case 'check':
    case 'unchecked':
      return 'unchecked'
    default:
      return 'bullet'
  }
}

function blockFromElement(el: RichTextElement, lookups: Lookups): Block | undefined {
  switch (el.type) {
    case 'rich_text_section': {
      const children = inlinesFromElements(el.elements, lookups)
      return children.length === 0 ? undefined : { kind: 'paragraph', children }
    }
    case 'rich_text_quote': {
      const children = inlinesFromElements(el.elements, lookups)
      return children.length === 0 ? undefined : { kind: 'quote', children }
    }
    case 'rich_text_preformatted': {
      // Code keeps its newlines and ignores styles.
      const text = inlineText(inlinesFromElements(el.elements, lookups))
      return text.length === 0 ? undefined : { kind: 'code', text }
    }
    case 'rich_text_list': {
      const items = el.elements.map((section) => inlinesFromElements(section.elements, lookups))
      return items.length === 0 ? undefined : { kind: 'list', style: listStyle(el.style), indent: el.indent ?? 0, items }
    }
    case 'rich_text_header': {
      const children = inlinesFromElements(el.elements, lookups)
      return children.length === 0 ? undefined : { kind: 'heading', children }
    }
    case 'rich_text_divider':
      return { kind: 'divider' }
    default:
      return undefined
  }
}

function textObjectInlines(text: TextObject, lookups: Lookups): Inline[] {
  return text.type === 'mrkdwn' ? mrkdwnInlines(text.text, lookups) : normalize(textRuns(text.text))
}

function blocksFromMessageBlock(block: MessageBlock, lookups: Lookups): Block[] {
  switch (block.type) {
    case 'rich_text':
      return block.elements.flatMap((el) => {
        const b = blockFromElement(el, lookups)
        return b ? [b] : []
      })
    case 'section': {
      const out: Block[] = []
      if (block.text) out.push(...(block.text.type === 'mrkdwn' ? mrkdwnBlocks(block.text.text, lookups) : paragraphOf(textObjectInlines(block.text, lookups))))
      for (const field of block.fields ?? []) out.push(...paragraphOf(textObjectInlines(field, lookups)))
      return out
    }
    case 'header': {
      const children = normalize(textRuns(block.text.text))
      return children.length === 0 ? [] : [{ kind: 'heading', children }]
    }
    case 'context': {
      const children: Inline[] = []
      for (const el of block.elements) {
        if (el.type === 'image') continue
        if (children.length > 0) children.push({ kind: 'text', text: ' ' })
        children.push(...textObjectInlines(el, lookups))
      }
      return paragraphOf(normalize(children))
    }
    case 'divider':
      return [{ kind: 'divider' }]
    default:
      return []
  }
}

function paragraphOf(children: Inline[]): Block[] {
  return children.length === 0 ? [] : [{ kind: 'paragraph', children }]
}

/** Renders `blocks`. Returns an empty body when nothing in them is renderable. */
export function bodyFromBlocks(blocks: ReadonlyArray<MessageBlock>, lookups: Lookups = {}): MessageBody {
  return { blocks: blocks.flatMap((block) => blocksFromMessageBlock(block, lookups)) }
}
