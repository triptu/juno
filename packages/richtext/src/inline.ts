/** Helpers shared by the block and mrkdwn parsers. */
import type { Inline, InlineStyle, Lookups } from './model'
import type { RichTextStyle } from '@juno/slack-schema'
import { emojiUnicode, splitEmojiName, unicodeFromHex } from './emoji'
import { findLinks } from './links'

export function toStyle(style: RichTextStyle | undefined): InlineStyle | undefined {
  if (!style) return undefined
  const out: { bold?: true; italic?: true; strike?: true; code?: true } = {}
  if (style.bold) out.bold = true
  if (style.italic) out.italic = true
  if (style.strike) out.strike = true
  if (style.code) out.code = true
  return Object.keys(out).length === 0 ? undefined : out
}

export function sameStyle(a: InlineStyle | undefined, b: InlineStyle | undefined): boolean {
  return (
    (a?.bold ?? false) === (b?.bold ?? false) &&
    (a?.italic ?? false) === (b?.italic ?? false) &&
    (a?.strike ?? false) === (b?.strike ?? false) &&
    (a?.code ?? false) === (b?.code ?? false)
  )
}

/** Splits text on newlines into text runs and breaks. */
export function textRuns(text: string, style?: InlineStyle): Inline[] {
  const out: Inline[] = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (i > 0) out.push({ kind: 'break' })
    if (line.length > 0) out.push(style ? { kind: 'text', text: line, style } : { kind: 'text', text: line })
  })
  return out
}

/**
 * `textRuns`, with the URLs, addresses and domains in it as links. Slack's
 * clients send those as `link` elements; a text element holds one only when
 * a bot or an older Juno sent it, and it shows as a link all the same. Code
 * stays as it is.
 */
export function linkedRuns(text: string, style?: InlineStyle): Inline[] {
  const found = style?.code === true ? [] : findLinks(text)
  if (found.length === 0) return textRuns(text, style)
  const out: Inline[] = []
  let last = 0
  for (const link of found) {
    out.push(...textRuns(text.slice(last, link.start), style))
    out.push(style ? { kind: 'link', url: link.url, text: link.text, style } : { kind: 'link', url: link.url, text: link.text })
    last = link.end
  }
  out.push(...textRuns(text.slice(last), style))
  return out
}

/** At most one blank line between two lines of text. */
const MAX_BREAK_RUN = 2

const isBlankLine = (inline: Inline | undefined) => inline === undefined || inline.kind === 'break'

/**
 * Merges adjacent text runs with the same style and drops empty ones. Blank
 * lines are tidied the way a reader expects: a line of only spaces is a
 * blank line, more than one blank line in a row collapses to one, and a run
 * never starts or ends with a blank line.
 */
export function normalize(inlines: ReadonlyArray<Inline>): Inline[] {
  const merged: Inline[] = []
  for (const inline of inlines) {
    if (inline.kind === 'text' && inline.text.length === 0) continue
    const last = merged[merged.length - 1]
    if (inline.kind === 'text' && last?.kind === 'text' && sameStyle(last.style, inline.style)) {
      merged[merged.length - 1] = { ...last, text: last.text + inline.text }
      continue
    }
    merged.push(inline)
  }
  const out: Inline[] = []
  let breaks = 0
  for (const [index, inline] of merged.entries()) {
    if (inline.kind === 'text' && inline.text.trim() === '' && isBlankLine(merged[index - 1]) && isBlankLine(merged[index + 1])) continue
    if (inline.kind === 'break') {
      breaks += 1
      if (out.length === 0 || breaks > MAX_BREAK_RUN) continue
    } else {
      breaks = 0
    }
    out.push(inline)
  }
  while (out[out.length - 1]?.kind === 'break') out.pop()
  return out
}

/** The name shown for a person whose name has not arrived yet. Never the raw id. */
export const UNKNOWN_PERSON = 'Someone'

export function userInline(id: string, lookups: Lookups, fallbackName?: string): Inline {
  return { kind: 'user', id, name: lookups.user?.(id) ?? fallbackName ?? UNKNOWN_PERSON, isMe: lookups.me !== undefined && lookups.me === id }
}

export function channelInline(id: string, fallbackName: string | undefined, lookups: Lookups): Inline {
  return { kind: 'channel', id, name: lookups.channel?.(id) ?? fallbackName ?? id }
}

export function usergroupInline(id: string, fallbackHandle: string | undefined, lookups: Lookups): Inline {
  return { kind: 'usergroup', id, handle: lookups.usergroup?.(id) ?? fallbackHandle ?? id }
}

export function emojiInline(rawName: string, lookups: Lookups, hex?: string): Inline {
  const unicode = (hex !== undefined ? unicodeFromHex(hex) : undefined) ?? emojiUnicode(rawName)
  if (unicode !== undefined) return { kind: 'emoji', name: rawName, unicode }
  const name = splitEmojiName(rawName).name
  const url = lookups.emoji?.(name)
  if (url !== undefined) return { kind: 'emoji', name: rawName, url }
  const target = lookups.emojiAlias?.(name)
  const aliased = target === undefined ? undefined : emojiUnicode(target)
  if (aliased !== undefined) return { kind: 'emoji', name: rawName, unicode: aliased }
  return { kind: 'emoji', name: rawName }
}

export function dateInline(timestamp: number, format: string, fallback?: string, url?: string): Inline {
  const date = new Date(timestamp * 1000)
  const text = fallback || (Number.isNaN(date.getTime()) ? String(timestamp) : date.toISOString())
  return { kind: 'date', timestamp, format, fallback: text, ...(url === undefined ? {} : { url }) }
}

/** Text of a run of inlines, for previews, search and code blocks. */
export function inlineText(inlines: ReadonlyArray<Inline>, breakAs = '\n'): string {
  let out = ''
  for (const inline of inlines) {
    switch (inline.kind) {
      case 'text':
      case 'link':
        out += inline.text
        break
      case 'date':
        out += inline.fallback
        break
      case 'user':
        out += `@${inline.name}`
        break
      case 'channel':
        out += `#${inline.name}`
        break
      case 'usergroup':
        out += `@${inline.handle}`
        break
      case 'broadcast':
        out += `@${inline.range}`
        break
      case 'emoji':
        out += inline.unicode ?? `:${inline.name}:`
        break
      case 'break':
        out += breakAs
        break
    }
  }
  return out
}
