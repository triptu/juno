/**
 * Canned Juno chat turns. A pattern on the last user message picks a reply or a
 * tool call; a tool result in the context is read back as the answer.
 */
import type { ChatContext, ChatToolCall } from '../provider'
import { firstName, sentenceCase } from './text'

export interface FakeTurn {
  readonly text: string
  readonly toolCalls: ReadonlyArray<ChatToolCall>
}

const TELL = /^(?:tell|message|dm|ping)\s+(\w+)\s+(?:that\s+)?(.+)$/i
const SUMMARIZE = /\b(summari[sz]e|catch me up|what did i miss|tl;?dr|recap)\b/i
const RESOLVE = /\b(resolve|tidy up|clean up|close)\b/i
const FIND = /\b(find|search|where|who said)\b/i

export function fakeChatTurn(context: ChatContext): FakeTurn {
  const messages = context.messages
  const last = messages.at(-1)
  if (!last) return reply('Ask me to summarize, find or draft something.')

  if (last.role === 'tool') {
    const asked = messages.toReversed().find((m) => m.role === 'user')
    if (last.name === 'read_topic') return reply(`Short version: ${last.result.slice(0, 200)}`)
    if (last.name === 'list_topics') return reply(`Here is what I found for "${asked?.role === 'user' ? asked.text : ''}": ${last.result.slice(0, 160)}`)
    return reply('Done. The card is ready when you want it.')
  }
  if (last.role !== 'user') return reply('Go on.')

  const text = last.text.trim()
  const tell = TELL.exec(text)
  if (tell?.[1] && tell[2]) {
    const name = sentenceCase(firstName(tell[1]))
    const target = context.viewing?.id ?? `m:${name.toLowerCase()}`
    return {
      text: `Ready to send to ${name}.`,
      toolCalls: [call('propose_message', { topicId: target, text: tell[2].trim() })],
    }
  }
  if (SUMMARIZE.test(text)) {
    if (context.viewing) return { text: '', toolCalls: [call('read_topic', { topicId: context.viewing.id, limit: 50 })] }
    return reply('Open a topic first, then ask again, or name the topic.')
  }
  if (RESOLVE.test(text) && context.viewing) {
    return { text: `I can resolve ${context.viewing.title}.`, toolCalls: [call('propose_resolve', { topicIds: [context.viewing.id] })] }
  }
  if (FIND.test(text)) return { text: '', toolCalls: [call('list_topics', { query: text, limit: 10 })] }
  return reply('I can summarize a topic, find something, or draft a message or a resolve for you to confirm. Which one?')
}

let counter = 0

function call(name: string, args: Record<string, unknown>): ChatToolCall {
  counter++
  return { id: `fake_call_${counter}`, name, arguments: args }
}

function reply(text: string): FakeTurn {
  return { text, toolCalls: [] }
}
