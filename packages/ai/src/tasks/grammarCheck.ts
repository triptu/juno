import { editableRanges } from '@juno/domain'
import { Type, type Static } from '../schema'
import { defineStructuredTask } from '../task'
import { prompt } from './grammarCheck.prompt'

export interface GrammarCheckInput { readonly draft: string }

export const GrammarCheckOutput = Type.Object({
  edits: Type.Array(Type.Object({
    start: Type.Integer({ minimum: 0 }),
    from: Type.String({ minLength: 1, maxLength: 80 }),
    to: Type.String({ minLength: 1, maxLength: 80 }),
    kind: Type.Union([Type.Literal('confusion'), Type.Literal('missing'), Type.Literal('doubled'), Type.Literal('agreement'), Type.Literal('spelling')]),
  }), { maxItems: 12 }),
})
export type GrammarEdit = Static<typeof GrammarCheckOutput>['edits'][number]

const CONFUSIONS = [
  ['its', "it's"], ['your', "you're"], ['their', 'there', "they're"], ['then', 'than'],
  ['affect', 'effect'], ['affects', 'effects'], ['affected', 'effected'], ['affecting', 'effecting'],
  ['lose', 'loose'], ['loses', 'looses'], ['losing', 'loosing'], ['could of', 'could have'],
]
const VERBS = [['am', 'is', 'are'], ['was', 'were'], ['has', 'have'], ['does', 'do']]
const MISSING = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'do', 'does'])
const words = (text: string) => text.split(' ')
const sameCase = (from: string, to: string) => {
  if (from === from.toLowerCase()) return to === to.toLowerCase()
  if (from === from.toUpperCase()) return to === to.toUpperCase()
  return /^[A-Z][a-z ']+$/.test(from) && /^[A-Z][a-z ']+$/.test(to)
}

/** At most two letter changes in one word; the model still decides whether it is misspelled. */
function nearbySpelling(from: string, to: string): boolean {
  if (!/^[a-z]{3,}$/.test(from) || !/^[a-z]{3,}$/.test(to) || Math.abs(from.length - to.length) > 2) return false
  let previous = Array.from({ length: to.length + 1 }, (_, i) => i)
  for (let i = 1; i <= from.length; i++) {
    const row = [i]
    for (let j = 1; j <= to.length; j++) {
      row.push(Math.min(row[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (from[i - 1] === to[j - 1] ? 0 : 1)))
    }
    previous = row
  }
  return previous[to.length]! <= 2
}

/** Restricts the model to a small word edit; it cannot change case, punctuation or surrounding prose. */
function minimal(edit: GrammarEdit): boolean {
  const { from, to, kind } = edit
  if (!/^[A-Za-z]+(?:'[A-Za-z]+)?(?: [A-Za-z]+(?:'[A-Za-z]+)?){0,2}$/.test(from) || !/^[A-Za-z]+(?:'[A-Za-z]+)?(?: [A-Za-z]+(?:'[A-Za-z]+)?){0,2}$/.test(to)) return false
  if (from === to || !sameCase(from, to)) return false
  const a = from.toLowerCase(), b = to.toLowerCase()
  if (kind === 'spelling') return nearbySpelling(a, b)
  if (kind === 'confusion') return CONFUSIONS.some((group) => group.includes(a) && group.includes(b))
  if (kind === 'agreement') return !from.includes(' ') && !to.includes(' ') && (
    VERBS.some((group) => group.includes(a) && group.includes(b)) ||
    (a.length >= 2 && (b === `${a}s` || b === `${a}es` || (a.endsWith('y') && b === `${a.slice(0, -1)}ies`))) ||
    (b.length >= 2 && (a === `${b}s` || a === `${b}es` || (b.endsWith('y') && a === `${b.slice(0, -1)}ies`)))
  )
  const before = words(from), after = words(to)
  if (kind === 'doubled') return before.length === 2 && before[0] === before[1] && to === before[0]
  return after.length === before.length + 1 && after.some((word, i) => MISSING.has(word) && after.filter((_, index) => index !== i).join(' ') === from)
}

function clean(output: Static<typeof GrammarCheckOutput>, input: GrammarCheckInput): Static<typeof GrammarCheckOutput> {
  if ([...input.draft].length > 1000) return { edits: [] }
  const ranges = editableRanges(input.draft)
  let end = -1
  const edits = output.edits.toSorted((a, b) => a.start - b.start).filter((edit) => {
    const last = edit.start + edit.from.length
    if (edit.start < end || input.draft.slice(edit.start, last) !== edit.from || !minimal(edit)) return false
    if (/[\w']/u.test(input.draft[edit.start - 1] ?? '') || /[\w']/u.test(input.draft[last] ?? '')) return false
    if (!ranges.some((range) => range.start <= edit.start && range.end >= last)) return false
    end = last
    return true
  })
  return { edits }
}

/**
 * Started once a send is accepted, and nothing waits on it: the suggestion shows whenever the answer comes.
 * The 10-16 study measured a 1.39 s p50 for the full answer (docs/research/grammar-post-send.md); 20 s leaves
 * room for a slow provider. One attempt: each exact text is asked once.
 */
export const grammarCheck = defineStructuredTask<GrammarCheckInput, typeof GrammarCheckOutput>({
  name: 'grammarCheck', version: 3, tier: 'decision', timeoutMillis: 20_000, maxAttempts: 1, maxTokens: 256,
  prompt, tool: { name: 'grammar', description: 'Report only clear spelling and grammar errors as minimal word edits.' },
  output: GrammarCheckOutput, clean,
  render: ({ draft }) => {
    const ranges = editableRanges(draft)
    // Preserve UTF-16 offsets while withholding code, quotes, links and mentions.
    return draft.split('').map((char, i) => char === '\n' || ranges.some(({ start, end }) => i >= start && i < end) ? char : ' ').join('')
  },
  key: () => '',
})
