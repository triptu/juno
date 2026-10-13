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
