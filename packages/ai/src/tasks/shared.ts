/** Input shapes and prompt rules every task shares. */

/** A message as the model reads it: who, when, what. Ids stay out; names are enough. */
export interface AiMessage {
  readonly sender: string
  readonly text: string
  /** ISO time. */
  readonly at: string
  readonly fromMe?: boolean
}

export function renderMessages(messages: ReadonlyArray<AiMessage>): string {
  if (messages.length === 0) return '(no messages)'
  return messages.map((m) => `[${m.at}] ${m.sender}${m.fromMe ? ' (me)' : ''}: ${oneLine(m.text)}`).join('\n')
}

/** The same messages as JSON state for a decision model. */
export function messagesState(messages: ReadonlyArray<AiMessage>): Array<{ at: string; sender: string; fromMe: boolean; text: string }> {
  return messages.map((m) => ({ at: m.at, sender: m.sender, fromMe: m.fromMe ?? false, text: m.text }))
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** SPEC section 15: AI organizes, summarizes, routes and gates. It does not write for the user. */
export const PLAIN_TEXT_RULES = `Write plain text only: no markdown, no asterisks, no bullet characters, no headings, no emoji.
Never write a message on the user's behalf and never rewrite the user's words.
Use the names given. Do not invent people, channels or facts.`

export const DECISION_RULES = `Answer only by calling the tool. Never answer in prose.
When unsure, choose the quiet option (no match, a low score, null) so the interface shows nothing.`
