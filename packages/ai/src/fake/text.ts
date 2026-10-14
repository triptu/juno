/** Word helpers the fake's rules share. Deterministic, no model. */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'are', 'was', 'were', 'will', 'would', 'could', 'should',
  'you', 'your', 'our', 'they', 'them', 'their', 'what', 'when', 'where', 'which', 'who', 'how', 'can', 'just', 'also', 'into',
  'about', 'then', 'than', 'there', 'here', 'been', 'being', 'does', 'did', 'not', 'but', 'yes', 'okay', 'sure', 'thanks', 'please',
])

/** Lowercase content words of 4 or more letters, stopwords removed. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>()
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 4 && !STOPWORDS.has(word)) out.add(word)
  }
  return out
}

export function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const word of a) if (b.has(word)) n++
  return n
}

export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const match = /^(.+?[.!?])(\s|$)/.exec(flat)
  return (match?.[1] ?? flat).trim()
}

export function firstWords(text: string, n: number): string {
  return text.replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' ')
}

/** "Postgres 16 migration plan": first letter up, trailing punctuation off, quotes off. */
export function sentenceCase(text: string): string {
  const cleaned = text.replace(/^["'“‘]+|["'”’]+$/g, '').replace(/[.!?,;:]+$/, '').trim()
  return cleaned.length === 0 ? cleaned : cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

export const CLOSING = /\b(thanks|thank you|thx|done|merged|shipped|resolved|fixed|sounds good|lgtm|closing|all good|works now)\b|👍|✅/i
export const URGENT = /\b(urgent|asap|down|outage|incident|blocked|blocker|prod|production|p0|p1|sev\d|deadline|broken|failing|errors?|5\d\ds?|not working|customers?|right now|immediately)\b/i
export const CHATTER = /\b(lol|haha|lunch|coffee|congrats|happy (birthday|friday)|weekend|cheers|nice one)\b|^\s*(\p{Extended_Pictographic}|\s)+$/iu
