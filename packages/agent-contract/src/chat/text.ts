import type { JunoBlock, JunoInline } from './items'
import type { About, Selection, SendContext } from './place'

export const MAX_SELECTION_CHARS = 4_000

const inlineText = (inlines: ReadonlyArray<JunoInline>) => inlines.map((inline) => inline.text).join('')

/** A bubble's body as plain text, for a quote's preview and Copy: blocks on their own lines, list items with "•" or their number. */
export const junoText = (body: ReadonlyArray<JunoBlock>): string =>
  body
    .map((block) => {
      switch (block._tag) {
        case 'paragraph':
        case 'heading':
          return inlineText(block.inlines)
        case 'list':
          return block.items.map((item, n) => `${block.ordered ? `${(block.start ?? 1) + n}.` : '•'} ${inlineText(item)}`).join('\n')
        case 'codeBlock':
          return block.text
      }
    })
    .join('\n')

/** About as many characters as the chip shows of a selection. */
const SNIPPET_CHARS = 28
/** The tooltip shows the selection up to this length; Juno still gets all of it. */
const TOOLTIP_CHARS = 400

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Cut at a word near `max` characters, with an ellipsis. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const space = text.lastIndexOf(' ', max)
  const at = space > max / 2 ? space : max
  // Never between the two halves of an emoji.
  const end = /[\uD800-\uDBFF]/.test(text[at - 1] ?? '') ? at - 1 : at
  return `${text.slice(0, end).replace(/[\s.,;:!?…-]+$/u, '')}…`
}

/** "Maya" for one message, "3 messages" for several: who or how much the selection chip names. */
export function selectionSource(selection: Selection): string | undefined {
  return selection.messages !== undefined ? `${selection.messages} messages` : selection.sender
}

/** "“the deploy failed on…”": the start of the selection, quoted, on one line, cut at a word. The chip shows "Maya: " before it. */
export function selectionSnippet(selection: Selection): string {
  return `“${cut(oneLine(selection.text), SNIPPET_CHARS)}”`
}

/** "Maya: the deploy failed on staging…", the chip's tooltip: the whole selection, up to 400 characters. */
export function selectionTooltip(selection: Selection): string {
  const text = cut(oneLine(selection.text), TOOLTIP_CHARS)
  const source = selectionSource(selection)
  return source === undefined ? text : `${source}: ${text}`
}

export function aboutOf(context: SendContext): About {
  switch (context._tag) {
    case 'topic':
      return { _tag: 'topic', topicId: context.topicId, title: context.title }
    case 'person':
      return { _tag: 'person', userId: context.userId, name: context.name }
    case 'channel':
      return { _tag: 'channel', channelId: context.place.channelId, name: context.place.name, tint: context.place.tint }
  }
}

/** "Postgres 16 migration plan", "Maya Chen", "#eng". The About line and chip put "About " before it. */
export function aboutLabel(about: About): string {
  switch (about._tag) {
    case 'topic':
      return about.title
    case 'person':
      return about.name
    case 'channel':
      return about.tint === 'dm' ? about.name : `#${about.name}`
  }
}
