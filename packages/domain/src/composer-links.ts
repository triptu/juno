/**
 * Links in the composer (spec section 8). Pure rules the renderer runs on
 * each edit, reached through `@juno/contract`.
 *
 * The field holds plain text. A URL, address or domain typed or pasted
 * into it is a link as it stands (`findLinks`), and is sent as one. A URL
 * pasted over selected words, or set with ⌘K, puts a link on those words:
 * the composer keeps where they are, and moves them with each edit. Drafts
 * and sends carry such a link as Slack writes it, `<url|words>`, with the
 * words escaped as in mrkdwn, so `composeOutgoing` sends it as a `link`
 * element with that text.
 */
import { findLinks, linkOf } from '@juno/richtext'
import { decodeMentions, mentionTokens, type MentionPick } from './composer-mentions'

/** A link on the words from `start` up to `end`. */
export interface LinkRange {
  readonly start: number
  readonly end: number
  readonly url: string
}

/** The URL a paste is, when all of it is one link. */
export const pastedLink = (text: string): string | undefined => linkOf(text)

/**
 * The links after the text changed from `before` to `after`, with the caret
 * at `caret` after the change. Typing inside linked words keeps them linked;
 * typing at either end does not. A change that covers all of a link's words,
 * or turns them into a URL, removes the link; one that covers part of them
 * keeps the rest.
 */
export function moveLinks(before: string, after: string, links: ReadonlyArray<LinkRange>, caret?: number): ReadonlyArray<LinkRange> {
  if (links.length === 0 || before === after) return links
  let from: number
  let oldEnd: number
  let newEnd: number
  const delta = after.length - before.length
  // An insertion at the caret: the caret says where, which a diff cannot when the typed letter repeats the one beside it.
  if (caret !== undefined && delta > 0 && caret - delta >= 0 && after.slice(0, caret - delta) + after.slice(caret) === before) {
    from = caret - delta
    oldEnd = from
    newEnd = caret
  } else {
    from = 0
    const shortest = Math.min(before.length, after.length)
    while (from < shortest && before[from] === after[from]) from++
    let same = 0
    while (same < shortest - from && before[before.length - 1 - same] === after[after.length - 1 - same]) same++
    oldEnd = before.length - same
    newEnd = after.length - same
  }
  const out: LinkRange[] = []
  for (const link of links) {
    const { start, end } = link
    if (end <= from) out.push(link)
    else if (start >= oldEnd) out.push({ ...link, start: start + delta, end: end + delta })
    // Words that became a URL themselves (Undo of a paste over them) show as that URL's link instead.
    else if (from >= start && oldEnd <= end && !(from === start && oldEnd === end)) {
      if (linkOf(after.slice(start, end + delta)) === undefined) out.push({ ...link, end: end + delta })
    }
    else if (start < from) out.push({ ...link, end: from })
    else if (end > oldEnd) out.push({ ...link, start: newEnd, end: end + delta })
  }
  return out.filter((link) => link.end > link.start)
}

/** `links` with `url` on the words from `start` to `end`, or with no link there when `url` is undefined. */
export function setLink(links: ReadonlyArray<LinkRange>, start: number, end: number, url: string | undefined): ReadonlyArray<LinkRange> {
  const kept = links.filter((link) => link.end <= start || link.start >= end)
  return (url === undefined || end <= start ? kept : [...kept, { start, end, url }]).toSorted((a, b) => a.start - b.start)
}

/** Every link the field shows, in order: the linked words, then the URLs typed as they stand, where no link or mention is. */
export function shownLinks(text: string, links: ReadonlyArray<LinkRange>, picks: ReadonlyArray<MentionPick> = []): ReadonlyArray<LinkRange> {
  const taken = [...links, ...mentionTokens(text, picks)]
  const typed = findLinks(text)
    .filter((found) => !taken.some((range) => found.start < range.end && found.end > range.start))
    .map((found) => ({ start: found.start, end: found.end, url: found.url }))
  return [...links, ...typed].toSorted((a, b) => a.start - b.start)
}

/** The link at `offset` (a click, or the caret), if any. */
export const linkAt = (links: ReadonlyArray<LinkRange>, offset: number): LinkRange | undefined => links.find((link) => offset >= link.start && offset <= link.end)

const escapeWords = (words: string) => words.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unescapeWords = (words: string) => words.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
/** Slack's encoding has no escape for "|" or ">" in a URL; percent-encoding them opens the same page. */
const encodeUrl = (url: string) => url.replace(/\|/g, '%7C').replace(/>/g, '%3E').replace(/\s/g, '%20')

/**
 * The text as drafts store it and sends carry it: picked people and
 * channels as `<@U…|Maya>` and `<#C…|eng>`, linked words as `<url|words>`.
 * A mention inside linked words stays text.
 */
export function encodeDraft(text: string, picks: ReadonlyArray<MentionPick>, links: ReadonlyArray<LinkRange>): string {
  const linked = links.filter((link) => link.end <= text.length)
  const mentions = mentionTokens(text, picks).filter((token) => !linked.some((link) => token.start < link.end && token.end > link.start))
  const spans = [
    ...linked.map((link) => ({ start: link.start, end: link.end, out: `<${encodeUrl(link.url)}|${escapeWords(text.slice(link.start, link.end))}>` })),
    ...mentions.map((token) => ({ start: token.start, end: token.end, out: `<${token.pick.kind === 'person' ? '@' : '#'}${token.pick.id}|${token.pick.name.replace(/[>|]/g, '')}>` })),
  ].toSorted((a, b) => a.start - b.start)
  let out = ''
  let last = 0
  for (const span of spans) {
    if (span.start < last) continue
    out += text.slice(last, span.start) + span.out
    last = span.end
  }
  return out + text.slice(last)
}

const ENCODED_LINK = /<((?:https?:\/\/|mailto:)[^|>\s]+)\|([^>]+)>/g

/** The field's text, picks and links for a stored draft (`encodeDraft`). */
export function decodeDraft(encoded: string): { readonly text: string; readonly picks: ReadonlyArray<MentionPick>; readonly links: ReadonlyArray<LinkRange> } {
  const { text: withLinks, picks } = decodeMentions(encoded)
  const links: LinkRange[] = []
  let text = ''
  let last = 0
  for (const m of withLinks.matchAll(ENCODED_LINK)) {
    text += withLinks.slice(last, m.index)
    const words = unescapeWords(m[2]!)
    links.push({ start: text.length, end: text.length + words.length, url: m[1]! })
    text += words
    last = m.index + m[0].length
  }
  return { text: text + withLinks.slice(last), picks, links }
}
