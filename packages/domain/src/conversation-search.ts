/**
 * Conversation search (spec section 10), behind ⌘K's Conversations tab and
 * the New chat picker. The text is split into words, ignoring case,
 * accents and punctuation; each typed word must match a word of the
 * conversation, in any order. A conversation's words are its name's, its
 * people's names (display name, real name and handle) and, for a channel,
 * its name split at "-" and "_".
 *
 * A typed word matches the start of a word, then anywhere inside one (3 or
 * more letters), then with one typo (4 or more letters, or two letters
 * swapped in a word of 3). Results rank by tier: the exact name, then every
 * word a prefix, then inside, then typos. Within a tier, by use (own sends
 * and topic visits), then DMs before group DMs before channels, then group
 * DMs whose people match more of the typed words, then by activity.
 */
import type { ConversationKind } from './channel'
import { scoresOf, type Use } from './frequent'

const WORD = /[\p{L}\p{N}]+/gu

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** The words of `text` as search compares them: lower case, without accents or punctuation. */
export function searchWords(text: string): ReadonlyArray<string> {
  return [...fold(text).matchAll(WORD)].map((found) => found[0])
}

/** A word of the name, folded, and where it sits in the name as shown. */
interface NameWord {
  readonly text: string
  readonly start: number
  readonly end: number
  /** Folding kept its length, so a part of it maps to the same part of the name. */
  readonly aligned: boolean
}

/** A conversation as search sees it. */
export interface SearchSubject {
  readonly id: string
  readonly kind: ConversationKind
  /** The name its row shows: "eng", "Maya Chen", "Maya, Leo". */
  readonly name: string
  /** The people in it other than you, each with the names they go by: display name, real name, handle. */
  readonly people: ReadonlyArray<ReadonlyArray<string>>
}

/** A subject with its words worked out once, for every keystroke after. */
export interface IndexedSubject extends SearchSubject {
  readonly nameWords: ReadonlyArray<NameWord>
  readonly personWords: ReadonlyArray<ReadonlyArray<string>>
  /** Whole names that count as exact: its name, and for a DM the person's names. */
  readonly exact: ReadonlySet<string>
}

export function indexSubject(subject: SearchSubject): IndexedSubject {
  const nameWords = [...subject.name.matchAll(WORD)].map((found): NameWord => {
    const text = fold(found[0])
    return { text, start: found.index, end: found.index + found[0].length, aligned: text.length === found[0].length }
  })
  const personWords = subject.people.map((names) => [...new Set(names.flatMap(searchWords))])
  const exact = new Set([nameWords.map((word) => word.text).join(' '), ...(subject.kind === 'im' ? subject.people.flatMap((names) => names.map((name) => searchWords(name).join(' '))) : [])])
  exact.delete('')
  return { ...subject, nameWords, personWords, exact }
}

/** How a typed word matched: the start of a word, inside one, or with a typo. */
type Grade = 0 | 1 | 2

/** Shortest typed word matched inside a word rather than at its start. */
const INSIDE_MIN = 3
/** Shortest typed word allowed any one typo; a word of 3 may only have two letters swapped. */
const TYPO_MIN = 4

/** One edit apart: a letter added, dropped or changed, or two neighbours swapped. */
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let at = 0
  while (at < a.length && at < b.length && a[at] === b[at]) at++
  if (a.length === b.length) return a.slice(at + 1) === b.slice(at + 1) || swapped(a, b, at)
  return a.length > b.length ? a.slice(at + 1) === b.slice(at) : a.slice(at) === b.slice(at + 1)
}

/** `a` and `b` differ only by the letters at `at` and `at + 1` swapped. */
const swapped = (a: string, b: string, at: number): boolean => a.length === b.length && a[at] === b[at + 1] && a[at + 1] === b[at] && a.slice(at + 2) === b.slice(at + 2)

/** `word` is one typo away from how `own` starts. */
function nearStart(word: string, own: string): boolean {
  if (word.length >= TYPO_MIN) {
    for (const length of [word.length - 1, word.length, word.length + 1]) if (length <= own.length && oneEdit(word, own.slice(0, length))) return true
    return false
  }
  if (word.length !== INSIDE_MIN || own.length < word.length) return false
  const start = own.slice(0, word.length)
  let at = 0
  while (at < word.length && word[at] === start[at]) at++
  return swapped(word, start, at)
}

function grade(word: string, own: string): Grade | undefined {
  if (own.startsWith(word)) return 0
  if (word.length >= INSIDE_MIN && own.includes(word)) return 1
  return nearStart(word, own) ? 2 : undefined
}

/** 0 the exact name, 1 every word a prefix, 2 some word inside a word, 3 some word with a typo. */
export type MatchTier = 0 | 1 | 2 | 3

export interface SubjectMatch {
  readonly tier: MatchTier
  /** Typed words matched by different people: two for "dmitriy wi" in a group DM with Dmitriy and Wience. */
  readonly people: number
  /** The parts of the name to highlight, as [start, end) offsets, in order, not overlapping. */
  readonly ranges: ReadonlyArray<readonly [number, number]>
}

/** The most typed words that each match a different person (a small bipartite matching). */
function peopleCovering(hits: ReadonlyArray<ReadonlySet<number>>): number {
  const owner = new Map<number, number>()
  const assign = (word: number, seen: Set<number>): boolean => {
    for (const person of hits[word]!) {
      if (seen.has(person)) continue
      seen.add(person)
      const held = owner.get(person)
      if (held === undefined || assign(held, seen)) {
        owner.set(person, word)
        return true
      }
    }
    return false
  }
  let count = 0
  for (let word = 0; word < hits.length; word++) if (assign(word, new Set())) count++
  return count
}

function merged(ranges: ReadonlyArray<readonly [number, number]>): ReadonlyArray<readonly [number, number]> {
  const out: Array<[number, number]> = []
  for (const [start, end] of ranges.toSorted((a, b) => a[0] - b[0])) {
    const last = out.at(-1)
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end)
    else out.push([start, end])
  }
  return out
}

/** How `subject` matches the typed `words` (from `searchWords`), or undefined when some word matches nothing. */
export function matchSubject(subject: IndexedSubject, words: ReadonlyArray<string>): SubjectMatch | undefined {
  if (words.length === 0) return undefined
  let worst: Grade = 0
  const hits: Array<Set<number>> = []
  const ranges: Array<readonly [number, number]> = []
  for (const word of words) {
    let best: Grade | undefined
    const inName: Array<{ readonly grade: Grade; readonly range: readonly [number, number] }> = []
    for (const own of subject.nameWords) {
      const found = grade(word, own.text)
      if (found === undefined) continue
      best = best === undefined ? found : (Math.min(best, found) as Grade)
      const inside = own.text.indexOf(word)
      const range: readonly [number, number] = !own.aligned || found === 2 ? [own.start, own.end] : found === 0 ? [own.start, own.start + word.length] : [own.start + inside, own.start + inside + word.length]
      inName.push({ grade: found, range })
    }
    const people = new Set<number>()
    subject.personWords.forEach((names, person) => {
      for (const own of names) {
        const found = grade(word, own)
        if (found === undefined) continue
        people.add(person)
        best = best === undefined ? found : (Math.min(best, found) as Grade)
      }
    })
    if (best === undefined) return undefined
    worst = Math.max(worst, best) as Grade
    hits.push(people)
    for (const part of inName) if (part.grade === best) ranges.push(part.range)
  }
  const tier: MatchTier = subject.exact.has(words.join(' ')) ? 0 : ((worst + 1) as MatchTier)
  return { tier, people: peopleCovering(hits), ranges: merged(ranges) }
}

/** A matched conversation, with its activity in epoch milliseconds. */
export interface SearchResult {
  readonly id: string
  readonly kind: ConversationKind
  readonly lastActivityAt: number
  readonly match: SubjectMatch
}

const kindOrder: Record<ConversationKind, number> = { im: 0, mpim: 1, public: 2, private: 2 }

/** The results' ids in the order the module comment gives. */
export function rankSearchResults(results: ReadonlyArray<SearchResult>, uses: ReadonlyArray<Use>, now: number): ReadonlyArray<string> {
  const scores = scoresOf(uses, now)
  return results
    .toSorted((a, b) => {
      if (a.match.tier !== b.match.tier) return a.match.tier - b.match.tier
      const left = scores.get(a.id)
      const right = scores.get(b.id)
      if (left !== undefined && right !== undefined) return right.score - left.score || right.latest - left.latest || a.id.localeCompare(b.id)
      if (left !== undefined) return -1
      if (right !== undefined) return 1
      return kindOrder[a.kind] - kindOrder[b.kind] || b.match.people - a.match.people || b.lastActivityAt - a.lastActivityAt || a.id.localeCompare(b.id)
    })
    .map(({ id }) => id)
}
