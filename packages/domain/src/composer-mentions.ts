/**
 * @ and # in the composer (spec section 8, inventory 7.1). Pure rules the
 * renderer runs on each keystroke, reached through `@juno/contract`.
 *
 * The field holds plain text. A person, user group or channel picked from
 * the suggestions shows as "@Maya", "@design-team" or "#eng", and the
 * composer keeps the list of what was picked. A token is a place in the text where a picked name
 * still stands whole; typing inside one breaks it back into plain text.
 * Drafts and sends carry the text with each token encoded as Slack does,
 * `<@U…|Maya>`, `<!subteam^S…|@design-team>` and `<#C…|eng>`, so a draft
 * keeps its mentions through a restart and `composeOutgoing` sends them by
 * id.
 */

export type MentionKind = 'person' | 'group' | 'channel'

/** A person, user group or channel picked from the suggestions. `name` has no "@" or "#"; a group's is its handle. */
export interface MentionPick {
  readonly kind: MentionKind
  readonly id: string
  readonly name: string
}

/** A picked name standing whole in the text, from `start` up to `end`. */
export interface MentionToken {
  readonly start: number
  readonly end: number
  readonly pick: MentionPick
}

/** The "@ma" being typed at the caret: the trigger at `start`, the query up to `end` (the caret). */
export interface MentionQuery {
  readonly trigger: '@' | '#'
  readonly start: number
  readonly end: number
  readonly text: string
}

/** "@Maya", "@design-team", "#eng": a pick as the field shows it. */
export const mentionText = (pick: MentionPick): string => `${pick.kind === 'channel' ? '#' : '@'}${pick.name}`

/** What may not come right before a trigger: it would be inside a word or an email. */
const WORD_BEFORE = /[\p{L}\p{N}_@#.-]/u
/** What may not come right after a token: the name would go on. */
const WORD_AFTER = /[\p{L}\p{N}_-]/u

/** The picked names standing whole in `text`, in order. The longest name wins where two start at one place. */
export function mentionTokens(text: string, picks: ReadonlyArray<MentionPick>): ReadonlyArray<MentionToken> {
  if (picks.length === 0) return []
  const byLength = picks.map((pick) => ({ pick, text: mentionText(pick) })).sort((a, b) => b.text.length - a.text.length)
  const tokens: MentionToken[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== '@' && ch !== '#') continue
    if (i > 0 && WORD_BEFORE.test(text[i - 1]!) && !(text[i - 1] === '_' && (i === 1 || !WORD_BEFORE.test(text[i - 2]!)))) continue
    for (const candidate of byLength) {
      const end = i + candidate.text.length
      if (!text.startsWith(candidate.text, i) || (end < text.length && WORD_AFTER.test(text[end]!) && !(text[end] === '_' && (end + 1 === text.length || !WORD_AFTER.test(text[end + 1]!))))) continue
      tokens.push({ start: i, end, pick: candidate.pick })
      i = end - 1
      break
    }
  }
  return tokens
}

/** The longest query a suggestion list follows. */
const MAX_QUERY = 40
/** What a person query may hold: names, handles, and single spaces between words ("maya c"). */
const PERSON_QUERY = /^(?:[\p{L}\p{N}_.'-]+ ?)*$/u
/** Channel names have no spaces. */
const CHANNEL_QUERY = /^[\p{L}\p{N}_.-]*$/u

/**
 * The "@" or "#" query the caret is at the end of, if any: the trigger is
 * at a word start, on the caret's line, and not the start of a token.
 */
export function mentionQueryAt(text: string, caret: number, tokens: ReadonlyArray<MentionToken> = []): MentionQuery | undefined {
  const from = Math.max(0, caret - MAX_QUERY - 1)
  for (let i = caret - 1; i >= from; i--) {
    const ch = text[i]!
    if (ch === '\n') return undefined
    if (ch !== '@' && ch !== '#') continue
    if (i > 0 && WORD_BEFORE.test(text[i - 1]!)) continue
    if (tokens.some((token) => i >= token.start && i < token.end)) return undefined
    const query = text.slice(i + 1, caret)
    const shape = ch === '@' ? PERSON_QUERY : CHANNEL_QUERY
    return shape.test(query) ? { trigger: ch, start: i, end: caret, text: query } : undefined
  }
  return undefined
}

/** The text after a pick replaces the query: the name and one space, with the caret after the space. */
export function insertMention(text: string, query: MentionQuery, pick: MentionPick): { readonly text: string; readonly caret: number } {
  const after = text.slice(query.end)
  const inserted = mentionText(pick)
  const space = after.startsWith(' ') ? '' : ' '
  return { text: `${text.slice(0, query.start)}${inserted}${space}${after}`, caret: query.start + inserted.length + 1 }
}

/**
 * Backspace at `caret` with nothing selected: a caret at the end of a token,
 * or inside one, removes the whole token. Undefined when Backspace should
 * do what it always does.
 */
export function removeTokenBefore(text: string, caret: number, tokens: ReadonlyArray<MentionToken>): { readonly text: string; readonly caret: number } | undefined {
  const token = tokens.find((t) => caret > t.start && caret <= t.end)
  if (token === undefined) return undefined
  return { text: text.slice(0, token.start) + text.slice(token.end), caret: token.start }
}

/** The picks still standing in `text`, so a removed token is not sent or saved. */
export function picksIn(text: string, picks: ReadonlyArray<MentionPick>): ReadonlyArray<MentionPick> {
  const used = new Set(mentionTokens(text, picks).map((token) => token.pick))
  return picks.filter((pick) => used.has(pick))
}

/** Slack's encoding has no escape for ">" or "|", so a name loses them. */
const encodeName = (name: string) => name.replace(/[>|]/g, '')

/** A pick encoded as Slack does: `<@U…|Maya>`, `<!subteam^S…|@design-team>`, `<#C…|eng>`. */
export function encodePick({ kind, id, name }: MentionPick): string {
  switch (kind) {
    case 'person':
      return `<@${id}|${encodeName(name)}>`
    case 'group':
      return `<!subteam^${id}|@${encodeName(name)}>`
    case 'channel':
      return `<#${id}|${encodeName(name)}>`
  }
}

/** `text` with each token encoded as Slack does (`encodePick`). What drafts store and sends carry. */
export function encodeMentions(text: string, picks: ReadonlyArray<MentionPick>): string {
  const tokens = mentionTokens(text, picks)
  if (tokens.length === 0) return text
  let out = ''
  let last = 0
  for (const token of tokens) {
    out += `${text.slice(last, token.start)}${encodePick(token.pick)}`
    last = token.end
  }
  return out + text.slice(last)
}

const ENCODED = /<@([UW][A-Z0-9]+)\|([^>]*)>|<#([CG][A-Z0-9]+)\|([^>]*)>|<!subteam\^([A-Z0-9]+)\|@?([^>]*)>/g

/** The field's text and picks for an encoded draft (`encodeMentions`). */
export function decodeMentions(encoded: string): { readonly text: string; readonly picks: ReadonlyArray<MentionPick> } {
  const picks = new Map<string, MentionPick>()
  const text = encoded.replace(ENCODED, (_match, userId: string | undefined, userName: string | undefined, channelId: string | undefined, channelName: string | undefined, groupId: string | undefined, handle: string | undefined) => {
    const pick: MentionPick =
      userId !== undefined
        ? { kind: 'person', id: userId, name: userName ?? userId }
        : channelId !== undefined
          ? { kind: 'channel', id: channelId, name: channelName ?? channelId }
          : { kind: 'group', id: groupId!, name: handle || groupId! }
    picks.set(`${pick.kind}:${pick.id}:${pick.name}`, pick)
    return mentionText(pick)
  })
  return { text, picks: [...picks.values()] }
}

/**
 * A suggestion to rank. `tier` is the group it belongs to (people: in this
 * conversation 0, recent contacts 1, everyone else 2; channels: yours 0,
 * others 1); `order` is its place inside the tier (most recent first).
 * `names` are what a query matches, the shown name first: display name,
 * real name and handle for a person, the name for a channel.
 */
export interface Suggestible {
  readonly tier: number
  readonly order: number
  readonly names: ReadonlyArray<string>
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const wordsOf = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '')

/**
 * How well `query` matches `names`, lower is better: 0 the shown name
 * starts with it, 1 another name does, 2 every query word starts a word of
 * some name. Undefined for no match. An empty query matches everything.
 */
export function suggestionMatch(query: string, names: ReadonlyArray<string>): number | undefined {
  const q = fold(query.trim())
  if (q === '') return 0
  const folded = names.map(fold)
  if (folded[0]?.startsWith(q)) return 0
  if (folded.some((name) => name.startsWith(q))) return 1
  const words = names.flatMap(wordsOf)
  const wanted = wordsOf(q)
  if (wanted.length === 0) return undefined
  return wanted.every((w) => words.some((word) => word.startsWith(w))) ? 2 : undefined
}

/** The rows a suggestion list shows. */
export const SUGGESTION_LIMIT = 6

/** The matches for `query`, by tier, then how well they match, then `order`. */
export function rankSuggestions<T extends Suggestible>(items: ReadonlyArray<T>, query: string, limit: number = SUGGESTION_LIMIT): ReadonlyArray<T> {
  const scored: Array<{ readonly item: T; readonly score: number }> = []
  for (const item of items) {
    const score = suggestionMatch(query, item.names)
    if (score !== undefined) scored.push({ item, score })
  }
  scored.sort((a, b) => a.item.tier - b.item.tier || a.score - b.score || a.item.order - b.item.order)
  return scored.slice(0, limit).map((entry) => entry.item)
}
