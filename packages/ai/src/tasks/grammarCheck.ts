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
    kind: Type.Union([Type.Literal('confusion'), Type.Literal('missing'), Type.Literal('doubled'), Type.Literal('agreement')]),
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

/** Restricts the model to a small word edit; it cannot change case, punctuation or surrounding prose. */
function minimal(edit: GrammarEdit): boolean {
  const { from, to, kind } = edit
  if (!/^[A-Za-z]+(?:'[A-Za-z]+)?(?: [A-Za-z]+(?:'[A-Za-z]+)?){0,2}$/.test(from) || !/^[A-Za-z]+(?:'[A-Za-z]+)?(?: [A-Za-z]+(?:'[A-Za-z]+)?){0,2}$/.test(to)) return false
  if (from === to || !sameCase(from, to)) return false
  const a = from.toLowerCase(), b = to.toLowerCase()
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

export const grammarCheck = defineStructuredTask<GrammarCheckInput, typeof GrammarCheckOutput>({
  name: 'grammarCheck', version: 1, tier: 'decision', timeoutMillis: 800,
  prompt, tool: { name: 'grammar', description: 'Report only clear grammar errors as minimal word edits.' },
  output: GrammarCheckOutput, clean,
  render: ({ draft }) => draft,
  key: () => '',
})
