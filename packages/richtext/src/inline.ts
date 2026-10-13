/** Helpers shared by the block and mrkdwn parsers. */
import type { Inline, InlineStyle, Lookups } from './model'
import type { RichTextStyle } from '@juno/slack-schema'
import { emojiUnicode, splitEmojiName, unicodeFromHex } from './emoji'

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

/** Merges adjacent text runs with the same style and drops empty ones. */
export function normalize(inlines: ReadonlyArray<Inline>): Inline[] {
  const out: Inline[] = []
  for (const inline of inlines) {
    if (inline.kind === 'text' && inline.text.length === 0) continue
    const last = out[out.length - 1]
    if (inline.kind === 'text' && last?.kind === 'text' && sameStyle(last.style, inline.style)) {
      out[out.length - 1] = { ...last, text: last.text + inline.text }
      continue
    }
    out.push(inline)
  }
  // A body never starts or ends with a break.
  while (out[0]?.kind === 'break') out.shift()
  while (out[out.length - 1]?.kind === 'break') out.pop()
  return out
}

export function userInline(id: string, lookups: Lookups, fallbackName?: string): Inline {
  return { kind: 'user', id, name: lookups.user?.(id) ?? fallbackName ?? id, isMe: lookups.me !== undefined && lookups.me === id }
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
  const url = lookups.emoji?.(splitEmojiName(rawName).name)
  if (url !== undefined) return { kind: 'emoji', name: rawName, url }
  return { kind: 'emoji', name: rawName }
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
