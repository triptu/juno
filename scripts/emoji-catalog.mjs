#!/usr/bin/env node
// Writes packages/richtext/src/emoji-catalog.ts, the standard emoji with
// Slack's short names, from emoji-datasource's emoji.json (the data Slack's
// own names come from), and packages/richtext/src/emoji-keywords.ts, the
// search words for each of them, in the same order, from the English CLDR
// annotations (Unicode License v3) and the model-written everyday phrases in
// scripts/emoji-intent.json (written by scripts/emoji-intent.ts).
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
const INTENT = fileURLToPath(new URL('emoji-intent.json', import.meta.url))

// Words people use in chat that CLDR does not list, by emoji.
const extraWords = {
  '😆': 'lol',
  '🤣': 'lol',
  '😹': 'lol',
  '👍': 'yes ok agree approve',
  '✅': 'yes ok approve done',
  '✔️': 'yes ok done',
  '☑️': 'yes done',
  '👌': 'yes',
  '🆗': 'yes',
  '👎': 'no nope disagree',
  '🙅‍♀️': 'nope',
  '🙅‍♂️': 'nope',
  '⛔': 'no',
  '❌': 'no wrong',
  '✖️': 'no',
  '🙏': 'thanks thank please',
  '🙇': 'thanks thank sorry apology',
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
  '😂': 'lol laugh',
  '😭': 'sad cry',
  '😢': 'sad cry',
  '😞': 'sad sorry',
  '😔': 'sad sorry',
  '💔': 'sad',
  '🎉': 'party celebrate celebration',
  '🥳': 'party celebrate celebration',
  '🎊': 'party celebrate celebration',
  '❤️': 'love',
  '😍': 'love',
  '🥰': 'love',
  '😘': 'love',
  '😎': 'cool',
  '😮': 'wow',
  '🤩': 'wow',
  '😳': 'wow',
  '😵': 'dead',
  '💀': 'dead',
  '☠️': 'dead',
  '🆘': 'help',
  '🛟': 'help rescue',
}

// Hand-written phrases that replace the model's for an emoji, comma separated.
// Fix a bad or missing phrase here, not in emoji-intent.json, so a rerun of the
// model keeps the fix.
const intentOverrides = {
  '🙃': 'fine, sure, whatever, great just great, this is fine, living the dream, chaos, im fine, sarcasm',
  '🫠': 'melting, embarrassed, awkward, overwhelmed, cringe, so hot, cant deal, dying inside, exhausted, send help',
  '🤪': 'wild, derp, unhinged, silly, freaking out, going mad, nuts, bonkers, goofy',
  '🤯': 'insane, unbelievable, shook, holy cow, jaw dropped, mind boggling, cant believe it, whoa',
  '😮': 'gasp, are you serious, no way, shut up, jaw drop, speechless, unreal, omg',
  '🤬': 'fuming, livid, swearing, furious, screaming, rage, angry, so mad',
  '😾': 'grumpy, annoyed, mad, angry, irritated, cranky, furious',
  '🥵': 'boiling, sweaty, spicy, burning up, sunburn, too warm, so hot, heatwave',
  '🥴': 'tipsy, hungover, buzzed, woozy, dizzy, confused, out of it',
  '😴': 'asleep, gn, good night, knocked out, out cold, resting, nap time, lights out, so tired, boring',
  '😎': 'deal with it, vibes, feeling good, like a boss, too cool, smooth, swag, confident, chill',
  '😩': 'ugh, exhausted, monday, so done, over it, please no, why me, cant even, groan, mood',
  '💀': 'dead, dying, im dead, lmao, crying, hilarious, deceased, screaming, too funny, rip, wheezing',
  '💯': 'facts, no cap, for real, fr, absolutely, period, totally, real talk, on god, preach, big mood, mood, same, bet',
  '💦': 'sweating, hard work, hot, exhausting, nervous, splash',
  '👍': 'sounds good, cool, all good, great, got it, nice, perfect, will do, on it, no problem, deal, bet',
  '👎': 'hate it, boo, terrible, awful, sucks, unacceptable, nope, worst',
  '👆': 'see above, this, that, agree, second this, previous message, plus one, look up',
  '🤌': 'chefs kiss, perfect, italian, delicious, what do you mean, mamma mia, perfection, exquisite',
  '🤝': 'agreed, partner, collab, lets do it, pleasure, deal done, fair enough, welcome, contract, bet',
  '🙌': 'amen, lets go, lfg, we did it, blessed, hallelujah, hyped, finally, woohoo, cheers, yesss',
  '💪': 'workout, you got this, stay strong, keep pushing, pumped, fitness, power, work hard, killing it, lfg',
  '💕': 'crush, bff, sweetheart, cuties, besties, sweet',
  '👀': 'looking, watching, interesting, drama, sus, side eye, tell me more, spill the tea, what is this, suspicious, checking, im listening',
  '🕵️‍♂️': 'investigating, on the case, sus, shady, looking into it, private investigator, clues',
  '🕵️‍♀️': 'investigating, on the case, sus, shady, looking into it, private investigator, clues',
  '🧜‍♂️': 'under the sea, ocean, water, swimming',
  '🧜‍♀️': 'under the sea, ocean, underwater, swimming, fish tail',
  '🧝‍♂️': 'archer, fantasy, rpg, dnd, magic',
  '🧝‍♀️': 'archer, fantasy, rpg, dnd, magic',
  '🦇': 'halloween, spooky, vampire, cave, night owl',
  '🐠': 'aquarium, coral reef, underwater, fishy',
  '🦈': 'danger, sharp teeth, loan shark, predator',
  '🍑': 'peachy, summer fruit',
  '🍆': 'vegetable, veggies',
  '🍄‍🟫': 'foraging, fungi',
  '🔪': 'chop, sharp, cooking, cut, slice',
  '🔫': 'pew pew, squirt gun, super soaker, water fight',
  '🏅': 'achievement, well done, good job, honor, winner',
  '⚽': 'goal, match day, pitch, world cup, game time, football',
  '🏰': 'fairytale, princess, kingdom, royal, medieval',
  '🚕': 'need a ride, rideshare, calling a cab, ride',
  '🚖': 'taxi, ride is here, cab, ride',
  '🚢': 'ship it, shipped, shipping, launch, release, deploy, cruise, voyage, sail',
  '🚀': 'to the moon, blast off, lfg, ship it, launch, launched, release, growth, scaling, hyped, lets go',
  '📦': 'order arrived, unboxing, care package, shipment, delivered, delivery, shipped',
  '🐛': 'coding bug, software bug, debug, debugging, caterpillar, creepy crawler',
  '💐': 'congrats, flowers, thank you, congratulations, feel better, for you, mothers day',
  '☀️': 'good morning, gm, morning, rise and shine, summer, sunny day, sunshine, warm',
  '🌅': 'dawn, sunset, golden hour, new day, good morning, gm, early start',
  '☕': 'gm, morning, good morning, wake up, espresso, latte, need energy, coffee break, cuppa, caffeine',
  '🌙': 'good night, gn, night, sleep tight, nighty night, sweet dreams, sleepy, bedtime',
  '✨': 'vibes, magic, sparkle, clean, shiny, special, glitter, glowing, fabulous, fresh, new',
  '🎶': 'groove, jamming, listening, melody, playlist, singing, tunes, vibes, vibing',
  '🎷': 'jazz, blues, solo, smooth jazz',
  '🪫': 'tired, exhausted, need sleep, running on empty, no energy, drained, depleted, low energy',
  '🔁': 'on repeat, loop, again, play again, replay, do over',
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
const intents = new Map(Object.entries(JSON.parse(await readFile(INTENT, 'utf8'))).map(([glyph, phrases]) => [plain(glyph), phrases.join(' ')]))
for (const [glyph, phrases] of Object.entries(intentOverrides)) intents.set(plain(glyph), phrases)
const nameWords = (names) => new Set(names.flatMap((name) => name.toLowerCase().split(/[_-]+/)))
const wordsOf = (text) => text.toLowerCase().split(/[^\p{L}\p{N}+]+/u).filter((word) => word !== '')

// Keep curated chat words, broad CLDR associations and everyday phrases apart for ranking.
// A phrase is searched by its words; "i'm dead" is "im dead".
function keywords(glyph, names) {
  const own = nameWords(names)
  const chat = new Set(wordsOf(extras.get(plain(glyph)) ?? ''))
  const related = new Set((annotations.get(plain(glyph)) ?? []).flatMap(wordsOf))
  const intent = new Set(wordsOf((intents.get(plain(glyph)) ?? '').replace(/['’]/g, '')))
  return [
    [...chat].filter((word) => !own.has(word)).join(' '),
    [...related].filter((word) => !own.has(word) && !chat.has(word)).join(' '),
    [...intent].filter((word) => !own.has(word) && !chat.has(word) && !related.has(word)).join(' '),
  ].join('|').replace(/\|+$/, '')
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
      keywordLines.push(keywords(unicode(e.unified), names))
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

const unused = [...extras.keys(), ...intents.keys()].filter((glyph) => !emitted.has(glyph))
if (unused.length > 0) throw new Error(`Extra words or phrases for emoji not in the catalog: ${unused.join(' ')}`)
if (keywordLines.some((line) => /[`\\$]/.test(line))) throw new Error('A keyword has a character a template string cannot hold as is')

const keywordFile = `// Generated by scripts/emoji-catalog.mjs from the English CLDR ${CLDR}
// annotations (Unicode License v3, https://www.unicode.org/license.txt), the
// script's extra words and the model-written phrases in scripts/emoji-intent.json.
// See apps/desktop/THIRD_PARTY_NOTICES.txt. Do not edit.
//
// One line per emoji of \`catalogData\`, in its order: curated chat words,
// then |, then CLDR words, then |, then the words of everyday phrases. Words
// are separated by spaces; trailing empty groups are left out.

export const keywordData = \`${keywordLines.join('\n')}\`
`
await writeFile(KEYWORDS_OUT, keywordFile)
console.log(`Wrote search words for ${keywordLines.filter((line) => line !== '').length} emoji, ${Buffer.byteLength(keywordFile)} bytes, to ${KEYWORDS_OUT}`)
