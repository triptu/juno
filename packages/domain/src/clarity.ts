/**
 * The clarity check (spec section 8): typos from a small table, doubled
 * words, a lowercase "i", a missing question mark, and very long sentences.
 * Fixes are minimal corrections, never rewrites. Quote lines, code spans,
 * fenced code, urls, emails, mentions and emoji shortcodes are left alone.
 */

export const TYPOS: Readonly<Record<string, string>> = {
  teh: 'the',
  recieve: 'receive',
  recieved: 'received',
  definately: 'definitely',
  definitly: 'definitely',
  seperate: 'separate',
  seperately: 'separately',
  wierd: 'weird',
  occured: 'occurred',
  occurence: 'occurrence',
  untill: 'until',
  tommorow: 'tomorrow',
  tomorow: 'tomorrow',
  becuase: 'because',
  alot: 'a lot',
  thier: 'their',
  wich: 'which',
  adress: 'address',
  calender: 'calendar',
  accomodate: 'accommodate',
  acheive: 'achieve',
  publically: 'publicly',
  goverment: 'government',
  enviroment: 'environment',
  enviroments: 'environments',
  existance: 'existence',
  neccessary: 'necessary',
  occassion: 'occasion',
  recomend: 'recommend',
  succesful: 'successful',
  truely: 'truly',
  beleive: 'believe',
  freind: 'friend',
  independant: 'independent',
  dont: "don't",
  cant: "can't",
  wont: "won't",
  im: "I'm",
  doesnt: "doesn't",
  isnt: "isn't",
  didnt: "didn't",
}

/** Doubled words that are often correct English. */
const DOUBLE_OK = new Set(['had', 'that', 'is', 'was', 'very', 'no', 'bye', 'ha'])

const QUESTION_OPENER = /^(can|could|would|should|what|when|where|why|how|is|are|do|does|did|will|any|anyone|who|which)\b/i
export const LONG_SENTENCE_WORDS = 40
const MIN_QUESTION_WORDS = 4

export interface ClarityPrefs {
  readonly typos?: boolean
  readonly capitalI?: boolean
  readonly questionMarks?: boolean
  readonly longSentences?: boolean
}

export type FixKind = 'typo' | 'doubled' | 'capital-i' | 'question-mark'

export interface ClarityFix {
  readonly kind: FixKind
  readonly from: string
  readonly to: string
  /** "recieve → receive", "the the → the", "i → I", "add ?" */
  readonly label: string
}

export interface ClarityResult {
  readonly fixes: ReadonlyArray<ClarityFix>
  /** The text with every fix applied. Same as the input when there are only notes. */
  readonly fixed: string
  readonly longSentence: boolean
  /** 0..1, for the badge. */
  readonly confidence: number
  /** "3 fixes: recieve → receive, the the → the, add ?" or "Reads a bit long. …" */
  readonly summary: string
  /** "One sentence runs over 40 words." when applicable. */
  readonly note?: string
  readonly primaryLabel: 'Fix and send' | 'Send'
  readonly secondaryLabel: 'Send as is' | 'Keep editing'
}

type Segment = { readonly text: string; readonly protect: boolean }

const PROTECTED = /(\[[^\]\n]*\]\([^)\n]*\)|<[^>]+>|`+[^`\n]*(?:`+|$)|https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.-]+|[@#][\w'-]+(?: [A-Z][\w'-]+)*|:[a-z0-9_+\-']+(?:::skin-tone-[2-6])?:)/g

/** Splits a line into editable text and spans the check must not touch. */
function segments(line: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of line.matchAll(PROTECTED)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), protect: false })
    out.push({ text: m[0], protect: true })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ text: line.slice(last), protect: false })
  return out
}

function matchCase(original: string, replacement: string): string {
  if (replacement.startsWith('I')) return replacement
  return /^[A-Z]/.test(original) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement
}

function fixEditable(text: string, fixes: ClarityFix[], prefs: ClarityPrefs): string {
  let out = text.replace(/\b([A-Za-z']+)\b/g, (word) => {
    const to = prefs.typos === false ? undefined : TYPOS[word.toLowerCase()]
    if (to === undefined) return word
    const replacement = prefs.capitalI === false && word === word.toLowerCase() && to.startsWith('I') ? to.toLowerCase() : matchCase(word, to)
    if (replacement === word) return word
    fixes.push({ kind: 'typo', from: word, to: replacement, label: `${word} → ${replacement}` })
    return replacement
  })
  out = out.replace(/\b([A-Za-z]+)\s+\1\b/gi, (whole, word: string) => {
    if (prefs.typos === false || DOUBLE_OK.has(word.toLowerCase())) return whole
    fixes.push({ kind: 'doubled', from: whole, to: word, label: `${whole} → ${word}` })
    return word
  })
  out = out.replace(/(^|\s)i(?=$|[\s,!?;:']|\.(?!e\b))/g, (_whole, before: string) => {
    if (prefs.capitalI === false) return `${before}i`
    fixes.push({ kind: 'capital-i', from: 'i', to: 'I', label: 'i → I' })
    return `${before}I`
  })
  return out
}

interface Line {
  readonly raw: string
  readonly kind: 'text' | 'quote' | 'code'
}

function classifyLines(text: string): Line[] {
  const out: Line[] = []
  let inFence = false
  for (const raw of text.split('\n')) {
    if (raw.trimStart().startsWith('```')) {
      inFence = !inFence
      out.push({ raw, kind: 'code' })
      continue
    }
    if (inFence) out.push({ raw, kind: 'code' })
    else if (/^\s*>/.test(raw)) out.push({ raw, kind: 'quote' })
    else out.push({ raw, kind: 'text' })
  }
  return out
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length
}

/** Runs the check. Returns `undefined` when there is nothing to say, so the message just sends. */
export function clarityCheck(text: string, prefs: ClarityPrefs = {}): ClarityResult | undefined {
  const fixes: ClarityFix[] = []
  const lines = classifyLines(text)
  const fixedLines = lines.map((line) => {
    if (line.kind !== 'text') return line.raw
    return segments(line.raw)
      .map((s) => (s.protect ? s.text : fixEditable(s.text, fixes, prefs)))
      .join('')
  })

  const bodyText = fixedLines
    .filter((_, i) => lines[i]?.kind === 'text')
    .join(' ')
    .trim()
  // The last sentence decides: "Did you get it? Yes." is not a question.
  const lastSentence = bodyText.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 0).at(-1) ?? ''
  const bodyLooksLikeQuestion = QUESTION_OPENER.test(lastSentence) && wordCount(lastSentence) >= MIN_QUESTION_WORDS && !/\?\s*$/.test(bodyText)
  if (prefs.questionMarks !== false && bodyLooksLikeQuestion) {
    let lastText = -1
    fixedLines.forEach((l, i) => {
      if (lines[i]?.kind === 'text' && l.trim().length > 0) lastText = i
    })
    if (lastText >= 0) {
      const before = fixedLines[lastText] ?? ''
      const after = before.replace(/[\s.!]*$/, '?')
      fixedLines[lastText] = after
      fixes.push({ kind: 'question-mark', from: before.trim(), to: after.trim(), label: 'add ?' })
    }
  }

  const longest = Math.max(0, ...bodyText.split(/[.!?]+/).map((s) => wordCount(s)))
  const longSentence = prefs.longSentences !== false && longest > LONG_SENTENCE_WORDS
  const note = longSentence ? `One sentence runs over ${LONG_SENTENCE_WORDS} words.` : undefined

  const unique = fixes.filter((fix, i) => fixes.findIndex((f) => f.label === fix.label) === i)
  if (unique.length === 0 && !longSentence) return undefined

  const fixed = fixedLines.join('\n')
  if (unique.length === 0) {
    return {
      fixes: [],
      fixed: text,
      longSentence: true,
      confidence: 0.74,
      summary: `Reads a bit long. ${note}`,
      note,
      primaryLabel: 'Send',
      secondaryLabel: 'Keep editing',
    }
  }
  const count = unique.length === 1 ? '1 fix' : `${unique.length} fixes`
  return {
    fixes: unique,
    fixed,
    longSentence,
    confidence: 0.9,
    summary: `${count}: ${unique.map((f) => f.label).join(', ')}${note ? ` · ${note}` : ''}`,
    ...(note ? { note } : {}),
    primaryLabel: 'Fix and send',
    secondaryLabel: 'Send as is',
  }
}

/** Editable ranges shared by local and grammar checks. Offsets are UTF-16, like string.slice. */
export function editableRanges(text: string): ReadonlyArray<{ readonly start: number; readonly end: number }> {
  const ranges: { start: number; end: number }[] = []
  let offset = 0
  for (const line of classifyLines(text)) {
    if (line.kind === 'text') {
      let start = offset
      for (const segment of segments(line.raw)) {
        if (!segment.protect) ranges.push({ start, end: start + segment.text.length })
        start += segment.text.length
      }
    }
    offset += line.raw.length + 1
  }
  return ranges
}
