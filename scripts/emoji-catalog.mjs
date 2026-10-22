#!/usr/bin/env node
// Writes packages/richtext/src/emoji-catalog.ts, the standard emoji with
// Slack's short names, from emoji-datasource's emoji.json (the data Slack's
// own names come from), and packages/richtext/src/emoji-keywords.ts, the
// search words for each of them, in the same order, from the English CLDR
// annotations (Unicode License v3).
//
//   node scripts/emoji-catalog.mjs              downloads the pinned versions
//   node scripts/emoji-catalog.mjs emoji.json annotations.json annotationsDerived.json
//                                               reads local copies
//
// Skips the Component category (bare skin tones and hair), entries replaced
// by another (`obsoleted_by`) and entries with no Apple image, since macOS
// cannot draw them. Rerunning with the same input writes the same file.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const VERSION = '16.0.0'
const SOURCE = `https://cdn.jsdelivr.net/npm/emoji-datasource@${VERSION}/emoji.json`
const OUT = fileURLToPath(new URL('../packages/richtext/src/emoji-catalog.ts', import.meta.url))
const CLDR = '48.2.0'
const ANNOTATIONS = `https://cdn.jsdelivr.net/npm/cldr-annotations-full@${CLDR}/annotations/en/annotations.json`
const DERIVED = `https://cdn.jsdelivr.net/npm/cldr-annotations-derived-full@${CLDR}/annotationsDerived/en/annotations.json`
const KEYWORDS_OUT = fileURLToPath(new URL('../packages/richtext/src/emoji-keywords.ts', import.meta.url))

// Words people use in chat that CLDR does not list, by emoji.
const extraWords = {
  '😆': 'lol',
  '🤣': 'lol',
  '😹': 'lol',
  '👍': 'ok agree approve',
  '✅': 'yes ok approve',
  '✔️': 'yes ok',
  '☑️': 'yes',
  '👌': 'yes',
  '🆗': 'yes',
  '👎': 'disagree',
  '🙅‍♀️': 'nope',
  '🙅‍♂️': 'nope',
  '⛔': 'no',
  '❌': 'no wrong',
  '✖️': 'no',
  '🙏': 'thank',
  '🙇': 'thanks thank',
  '🤝': 'thanks deal',
  '💸': 'pay',
  '💵': 'cash',
  '🍻': 'party',
  '🪩': 'party',
  '🎂': 'party',
  '🤔': 'think',
  '🧠': 'think',
  '🐛': 'bug',
  '🚢': 'ship shipped shipit',
  '🚀': 'ship launch',
  '👋': 'hi',
  '🙋‍♀️': 'hi',
  '🙋‍♂️': 'hi',
  '😊': 'happy',
}

// Slack's picker order, with sentence-case headings.
const categories = [
  ['Smileys & Emotion', 'Smileys & emotion'],
  ['People & Body', 'People & body'],
  ['Animals & Nature', 'Animals & nature'],
  ['Food & Drink', 'Food & drink'],
  ['Activities', 'Activities'],
  ['Travel & Places', 'Travel & places'],
  ['Objects', 'Objects'],
  ['Symbols', 'Symbols'],
  ['Flags', 'Flags'],
]

async function load(path, url) {
  if (path !== undefined) return JSON.parse(await readFile(path, 'utf8'))
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

// Single-quoted like the rest of the code. No name or emoji has a quote or a backslash.
const quote = (text) => {
  if (/['\\\n]/.test(text)) throw new Error(`Cannot quote ${text}`)
  return `'${text}'`
}

const unicode = (hex) => String.fromCodePoint(...hex.split('-').map((h) => Number.parseInt(h, 16)))

const data = await load(process.argv[2], SOURCE)
const plain = (text) => text.replaceAll('\uFE0F', '')
const annotations = new Map()
for (const [path, url, key] of [[process.argv[3], ANNOTATIONS, 'annotations'], [process.argv[4], DERIVED, 'annotationsDerived']]) {
  for (const [glyph, entry] of Object.entries((await load(path, url))[key].annotations)) {
    if (!annotations.has(plain(glyph))) annotations.set(plain(glyph), [...entry.default ?? [], ...entry.tts ?? []])
  }
}
const extras = new Map(Object.entries(extraWords).map(([glyph, words]) => [plain(glyph), words]))
const nameWords = (names) => new Set(names.flatMap((name) => name.toLowerCase().split(/[_-]+/)))
const wordsOf = (text) => text.toLowerCase().split(/[^\p{L}\p{N}+]+/u).filter((word) => word !== '')

// The search words for one emoji: CLDR's keywords and name, then the extra
// words, lowercased, split into words, once each, leaving out its short names' words.
function keywords(glyph, names) {
  const own = nameWords(names)
  const words = [...(annotations.get(plain(glyph)) ?? []), extras.get(plain(glyph)) ?? ''].flatMap(wordsOf)
  return [...new Set(words)].filter((word) => !own.has(word))
}
const keywordLines = []
const emitted = new Set()
const known = new Set(categories.map(([source]) => source))
const unexpected = new Set(data.map((e) => e.category).filter((c) => c !== 'Component' && !known.has(c)))
if (unexpected.size > 0) throw new Error(`Unknown categories: ${[...unexpected].join(', ')}. Add them to the list.`)

let count = 0
const sections = categories.map(([source, heading]) => {
  const entries = data
    .filter((e) => e.category === source && !e.obsoleted_by && e.has_img_apple)
    .toSorted((a, b) => a.sort_order - b.sort_order)
    .map((e) => {
      const names = [e.short_name, ...e.short_names.filter((n) => n !== e.short_name)]
      if (names.some((n) => /\s/.test(n))) throw new Error(`A short name has a space: ${names.join(', ')}`)
      count += 1
      emitted.add(plain(unicode(e.unified)))
      keywordLines.push(keywords(unicode(e.unified), names).join(' '))
      return `    ${quote([unicode(e.unified), ...names].join(' '))},`
    })
  return `  [\n    ${quote(heading)},\n${entries.join('\n')}\n  ],`
})

const file = `// Generated by scripts/emoji-catalog.mjs from emoji-datasource ${VERSION}. Do not edit.
// Regenerate with \`node scripts/emoji-catalog.mjs\`.
//
// One array per category in Slack's picker order: the heading, then one
// string per emoji, "<unicode> <short name> <alias> ...".

export const catalogData: ReadonlyArray<ReadonlyArray<string>> = [
${sections.join('\n')}
]
`

await writeFile(OUT, file)
console.log(`Wrote ${count} emoji, ${Buffer.byteLength(file)} bytes, to ${OUT}`)

const unused = [...extras.keys()].filter((glyph) => !emitted.has(glyph))
if (unused.length > 0) throw new Error(`Extra words for emoji not in the catalog: ${unused.join(' ')}`)
if (keywordLines.some((line) => /[`\\$]/.test(line))) throw new Error('A keyword has a character a template string cannot hold as is')

const keywordFile = `// Generated by scripts/emoji-catalog.mjs from the English CLDR ${CLDR}
// annotations (Unicode License v3, https://www.unicode.org/license.txt) and
// the script's extra words. Do not edit.
//
// One line per emoji of \`catalogData\`, in its order: the words a search
// matches besides the emoji's short names, separated by spaces.

export const keywordData = \`${keywordLines.join('\n')}\`
`
await writeFile(KEYWORDS_OUT, keywordFile)
console.log(`Wrote search words for ${keywordLines.filter((line) => line !== '').length} emoji, ${Buffer.byteLength(keywordFile)} bytes, to ${KEYWORDS_OUT}`)
