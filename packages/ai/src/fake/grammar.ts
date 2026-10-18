import type { GrammarCheckInput, GrammarEdit } from '../tasks/grammarCheck'

/** Invented grammatical contexts, deliberately small. Production uses the model. */
export function fakeGrammarCheck({ draft }: GrammarCheckInput): { edits: GrammarEdit[] } {
  const rules: ReadonlyArray<{ pattern: RegExp; to: string; kind: GrammarEdit['kind'] }> = [
    { pattern: /\bgrammer\b/gi, to: 'grammar', kind: 'spelling' },
    { pattern: /\bchek\b/gi, to: 'check', kind: 'spelling' },
    { pattern: /\bits(?= broken\b)/gi, to: "it's", kind: 'confusion' },
    { pattern: /\bit's(?= owner\b)/gi, to: 'its', kind: 'confusion' },
    { pattern: /\byour(?= welcome\b)/gi, to: "you're", kind: 'confusion' },
    { pattern: /\byou're(?= report\b)/gi, to: 'your', kind: 'confusion' },
    { pattern: /\btheir(?= is\b)/gi, to: 'there', kind: 'confusion' },
    { pattern: /\bthere(?= ready\b)/gi, to: "they're", kind: 'confusion' },
    { pattern: /\bthey're(?= report\b)/gi, to: 'their', kind: 'confusion' },
    { pattern: /(?<=faster )then\b/gi, to: 'than', kind: 'confusion' },
    { pattern: /(?<=will )effect\b/gi, to: 'affect', kind: 'confusion' },
    { pattern: /(?<=the )affect(?= was\b)/gi, to: 'effect', kind: 'confusion' },
    { pattern: /(?<=might )loose\b/gi, to: 'lose', kind: 'confusion' },
    { pattern: /\bcould of\b/gi, to: 'could have', kind: 'confusion' },
    { pattern: /\bneed(?= (?:send|check)\b)/gi, to: 'need to', kind: 'missing' },
    { pattern: /\bthe the\b/gi, to: 'the', kind: 'doubled' },
    { pattern: /(?<=they )has\b/gi, to: 'have', kind: 'agreement' },
    { pattern: /(?<=she )have\b/gi, to: 'has', kind: 'agreement' },
    { pattern: /(?<=we )was\b/gi, to: 'were', kind: 'agreement' },
    { pattern: /(?<=he )go\b/gi, to: 'goes', kind: 'agreement' },
    { pattern: /(?<=they )is\b/gi, to: 'are', kind: 'agreement' },
  ]
  return { edits: rules.flatMap(({ pattern, to, kind }) => [...draft.matchAll(pattern)].map((match) => ({
    start: match.index, from: match[0], to: /^[A-Z]/.test(match[0]) ? to[0]!.toUpperCase() + to.slice(1) : to, kind,
  }))) }
}
