/**
 * Word rules per task. Each returns the raw arguments the model would have put
 * in the tool call; the provider validates them like any other output.
 */
import type { CatchUpInput } from '../tasks/catchUp'
import type { ForYouInput } from '../tasks/forYou'
import type { GroupRunInput } from '../tasks/groupRun'
import type { ParseCommandInput } from '../tasks/parseCommand'
import type { RouteCheckInput } from '../tasks/routeCheck'
import type { SettledScoreInput } from '../tasks/settledScore'
import type { TitleTopicInput } from '../tasks/titleTopic'
import type { TopicArtInput } from '../tasks/topicArt'
import type { UrgencyGateInput } from '../tasks/urgencyGate'
import { CHATTER, CLOSING, PROMISE, URGENT, contentWords, firstName, firstSentence, firstWords, overlap, sentenceCase } from './text'

export function fakeRouteCheck(input: RouteCheckInput): unknown {
  const draft = contentWords(input.draft)
  let best: { id: string; n: number } | undefined
  for (const topic of input.topics) {
    const words = contentWords(`${topic.title} ${topic.recent.map((m) => m.text).join(' ')}`)
    const n = overlap(draft, words)
    if (n >= 2 && (!best || n > best.n)) best = { id: topic.id, n }
  }
  return best ? { replyTo: best.id, confidence: Math.min(0.95, 0.5 + 0.15 * best.n) } : { replyTo: null, confidence: 0.9 }
}

export function fakeSettledScore(input: SettledScoreInput): unknown {
  const last = input.messages.at(-1)
  if (!last) return { score: 0, reason: 'no messages' }
  if (CLOSING.test(last.text)) return { score: 0.9, reason: 'closing message' }
  if (/\?\s*$/.test(last.text.trim())) return { score: 0.1, reason: 'open question' }
  return { score: 0.4, reason: 'no closing message' }
}

export function fakeGroupRun(input: GroupRunInput): unknown {
  // A run: messages whose words overlap with an earlier message of the run.
  let bestRun: Array<GroupRunInput['messages'][number]> = []
  for (let start = 0; start < input.messages.length; start++) {
    const first = input.messages[start]!
    const run = [first]
    let words = contentWords(first.text)
    for (const next of input.messages.slice(start + 1)) {
      const theirs = contentWords(next.text)
      if (overlap(words, theirs) >= 1) {
        run.push(next)
        words = new Set([...words, ...theirs])
      }
    }
    if (run.length > bestRun.length) bestRun = run
  }
  if (bestRun.length < 3) return { group: null, confidence: 0.9 }
  return {
    group: { messageTs: bestRun.map((m) => m.ts), title: sentenceCase(firstWords(firstSentence(bestRun[0]!.text), 6)) },
    confidence: Math.min(0.95, 0.6 + 0.1 * bestRun.length),
  }
}

export function fakeUrgencyGate(input: UrgencyGateInput): unknown {
  if (CHATTER.test(input.text)) return { urgent: 0.05, chatter: 0.9 }
  if (URGENT.test(input.text)) return { urgent: 0.9, chatter: 0.05 }
  if (input.mentionsMe && /\?/.test(input.text)) return { urgent: 0.7, chatter: 0.1 }
  if (input.channelKind === 'im') return { urgent: 0.5, chatter: 0.2 }
  return { urgent: 0.2, chatter: 0.3 }
}

const LET_KNOW = /^(?:let|tell|remind)\s+(\w+)\s+(?:know\s+)?(?:that\s+)?(.+)$/i
const TALK_TO = /^(?:talk to|chat with|open|write to)\s+(\w+)$/i
const PUT_IN = /^(?:put|write|announce|post|say)\s+(?:in|to|on)\s+#?([\w-]+)\s+(?:that\s+)?(.+)$/i
const CLOSE = /^(?:close|finish|archive|mark done|wrap up)\s+(.+)$/i
const ASK = /^(?:what'?s new|anything new|find|search|who said|where did|when did|summary|recap|catch up)\b/i

export function fakeParseCommand(input: ParseCommandInput): unknown {
  const text = input.text.trim()
  const person = (name: string) => input.people.find((p) => firstName(p.name).toLowerCase() === name.toLowerCase())
  let m = LET_KNOW.exec(text)
  if (m?.[1] && m[2]) {
    const p = person(m[1])
    if (p) return { command: { kind: 'send_dm', userId: p.id, text: m[2].trim() }, confidence: 0.85 }
  }
  m = TALK_TO.exec(text)
  if (m?.[1]) {
    const p = person(m[1])
    if (p) return { command: { kind: 'open_dm', userId: p.id }, confidence: 0.8 }
  }
  const lone = person(text)
  if (lone && !/\s/.test(text)) return { command: { kind: 'open_dm', userId: lone.id }, confidence: 0.6 }
  m = PUT_IN.exec(text)
  if (m?.[1] && m[2]) {
    const ch = input.channels.find((c) => c.name.toLowerCase() === m![1]!.toLowerCase() && (c.kind === 'public' || c.kind === 'private'))
    if (ch) return { command: { kind: 'post', channelId: ch.id, text: m[2].trim() }, confidence: 0.85 }
  }
  m = CLOSE.exec(text)
  if (m?.[1]) {
    const words = contentWords(m[1])
    let best: { id: string; n: number } | undefined
    for (const t of input.topics) {
      const n = overlap(words, contentWords(`${t.title} ${t.channel}`))
      if (n > 0 && (!best || n > best.n)) best = { id: t.id, n }
    }
    if (best) return { command: { kind: 'resolve', topicId: best.id }, confidence: Math.min(0.9, 0.5 + 0.15 * best.n) }
  }
  if (ASK.test(text)) return { command: { kind: 'ask', prompt: text }, confidence: 0.8 }
  return { command: null, confidence: 0.9 }
}

export function fakeForYou(input: ForYouInput): unknown {
  const cards: Array<Record<string, unknown>> = []
  for (const topic of input.topics) {
    const last = topic.messages.at(-1)
    if (!last) continue
    if (!last.fromMe && /\?\s*$/.test(last.text.trim())) {
      cards.push({
        type: 'waiting_on_you',
        topicId: topic.id,
        title: `${firstName(last.sender)} is waiting on you`,
        body: `${firstName(last.sender)} asks: ${firstSentence(last.text)}`,
        options: ['Yes, that works', 'Not yet', 'Let me check'],
      })
    } else if (last.fromMe && PROMISE.test(last.text)) {
      cards.push({ type: 'follow_up', topicId: topic.id, title: `You said you would follow up`, body: `In ${topic.title}: ${firstSentence(last.text)}` })
    } else if (CLOSING.test(last.text) && topic.unread === 0) {
      cards.push({ type: 'tidy_up', topicId: topic.id, title: `${topic.title} looks settled`, body: `The last message closes it: ${firstSentence(last.text)}` })
    }
    if (cards.length === 5) break
  }
  return { cards }
}

export function fakeTitle(input: TitleTopicInput): string {
  const first = input.messages[0]
  if (!first) return 'Untitled'
  return sentenceCase(firstWords(firstSentence(first.text), 6))
}

export function fakeCatchUp(input: CatchUpInput): string {
  const senders = [...new Set(input.unread.map((m) => firstName(m.sender)))]
  const last = input.unread.at(-1)
  const who = senders.length <= 2 ? senders.join(' and ') : `${senders.slice(0, 2).join(', ')} and ${senders.length - 2} more`
  const head = `${input.unread.length} new from ${who}.`
  return last ? `${head} ${firstName(last.sender)}: ${firstSentence(last.text)}` : head
}

/**
 * Topic art: a small table of literal objects keyed by words in the topic,
 * a hue from a hash of the text, and `data-confident="false"` for a topic
 * that says nothing (a very short or emoji-only title, as the prompt asks).
 * A redraw (`avoid`) steps to the next hue and the next object so the
 * drawing visibly changes. The marker `::invalid-art::` in the text makes
 * the fake answer outside the vocabulary, so tests can see what the app does
 * with a drawing that fails validation.
 */
const ART_OBJECTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(bill|cost|budget|invoice|price|pricing|spend)\b/i, '<ellipse cx="20" cy="27" rx="11" ry="4.5" fill="soft"/><path d="M9 27 V20 A11 4.5 0 0 1 31 20 V27"/><path d="M9 20 A11 4.5 0 0 0 31 20"/><circle cx="30" cy="11" r="3" fill="accent" stroke="none" detail="1"/>'],
  [/\b(postgres|database|migration|replica|sql|db)\b/i, '<path d="M9 11 V29 A11 4.5 0 0 0 31 29 V11"/><path d="M9 20 A11 4.5 0 0 0 31 20" detail="1"/><ellipse cx="20" cy="11" rx="11" ry="4.5" fill="soft"/><circle cx="26" cy="29" r="2" fill="accent" stroke="none" detail="1"/>'],
  [/\b(offsite|meeting|schedule|calendar|slot|wednesday|friday|monday)\b/i, '<rect x="7" y="10" width="26" height="23" rx="5" fill="soft"/><line x1="7" y1="17" x2="33" y2="17"/><line x1="13" y1="7" x2="13" y2="12"/><line x1="27" y1="7" x2="27" y2="12"/><circle cx="20" cy="25" r="2.2" fill="accent" stroke="none"/>'],
  [/\b(hiring|candidate|onsite|offer|recruit|interview|headcount)\b/i, '<rect x="7" y="9" width="26" height="22" rx="4" fill="soft"/><circle cx="15" cy="18" r="3.5" fill="ink" stroke="none"/><line x1="22" y1="16" x2="29" y2="16" stroke-width="2"/><line x1="22" y1="21" x2="29" y2="21" stroke-width="2" detail="1"/><circle cx="15" cy="26" r="1.5" fill="accent" stroke="none" detail="1"/>'],
  [/\b(alert|incident|outage|p95|queue|firing|down|error)\b/i, '<path d="M20 7 L34 31 H6 Z" fill="soft"/><line x1="20" y1="16" x2="20" y2="23" stroke-width="3"/><circle cx="20" cy="27.5" r="1.8" fill="accent" stroke="none"/>'],
  [/\b(deploy|release|ship|build|ci|flaky|spec|test)\b/i, '<path d="M8 14 L20 7 L32 14 V27 L20 34 L8 27 Z" fill="soft"/><path d="M8 14 L20 21 L32 14" detail="1"/><line x1="20" y1="21" x2="20" y2="34" detail="1"/><circle cx="26" cy="11" r="2" fill="accent" stroke="none" detail="1"/>'],
  [/\b(lunch|coffee|mug|ramen|dinner|drinks|board games|social)\b/i, '<path d="M9 16 H27 V26 A9 7 0 0 1 9 26 Z" fill="soft"/><path d="M27 18 H31 A3 3 0 0 1 31 24 H27" detail="1"/><line x1="12" y1="33" x2="26" y2="33" stroke-width="2"/><circle cx="18" cy="12" r="1.6" fill="accent" stroke="none" detail="1"/>'],
  [/\b(roadmap|plan|proposal|q[1-4]|cut|copy|design|spec)\b/i, '<rect x="8" y="7" width="24" height="26" rx="4" fill="soft"/><line x1="13" y1="15" x2="27" y2="15" stroke-width="2"/><line x1="13" y1="21" x2="24" y2="21" stroke-width="2" detail="1"/><line x1="13" y1="27" x2="20" y2="27" stroke-width="2" detail="1"/><circle cx="27" cy="27" r="2" fill="accent" stroke="none" detail="1"/>'],
]
const ART_DEFAULT = '<path d="M11 8 H24 L31 15 V32 H11 Z" fill="soft"/><path d="M24 8 V15 H31" detail="1"/><line x1="15" y1="21" x2="26" y2="21" stroke-width="2" detail="1"/><circle cx="20" cy="27" r="2" fill="accent" stroke="none" detail="1"/>'
const ART_HUES = ['coral', 'amber', 'olive', 'sage', 'teal', 'sky', 'periwinkle', 'plum'] as const

function artHash(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** The words the drawing is picked from: the title and the messages, or the channel and its recent messages. */
function artText(input: TopicArtInput): string {
  return input.kind === 'thread' ? `${input.title} ${input.first} ${input.last}` : `${input.channel} ${input.purpose ?? ''} ${input.topic ?? ''} ${input.recent.join(' ')}`
}

export function fakeTopicArt(input: TopicArtInput): string {
  const text = artText(input)
  if (text.includes('::invalid-art::')) return '<svg viewBox="0 0 40 40" data-hue="teal"><text x="4" y="24">no</text></svg>'
  const subject = input.kind === 'thread' ? input.title : input.channel
  // A channel is a subject by itself; a thread says nothing when its title is a word or an emoji.
  const words = subject.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const confident = input.kind === 'main' || (words.length >= 4 && !/^(hmm+|ok|yes|no|thanks)$/i.test(words))
  let objectIndex = ART_OBJECTS.findIndex(([re]) => re.test(text))
  let hueIndex = artHash(subject) % ART_HUES.length
  if (input.avoid !== undefined) {
    hueIndex = (ART_HUES.indexOf(input.avoid.hue as (typeof ART_HUES)[number]) + 1 + ART_HUES.length) % ART_HUES.length
    objectIndex = (objectIndex + 1) % ART_OBJECTS.length
  }
  const body = objectIndex < 0 ? ART_DEFAULT : ART_OBJECTS[objectIndex]![1]
  return `<svg viewBox="0 0 40 40" data-hue="${ART_HUES[hueIndex]}"${confident ? '' : ' data-confident="false"'}>${body}</svg>`
}
