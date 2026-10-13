import type { ChatContext } from '../provider'
import { defineTextTask } from '../task'
import { prompt } from './chat.prompt'

export { chatTools } from './chat.tools'

/**
 * Generation with tools. The provider streams it; the task row carries the
 * prompt, the tier and the timeout. `render` gives the facts block that goes
 * under the prompt: the time and the topic "this" refers to.
 */
export const chat = defineTextTask<ChatContext>({
  name: 'chat',
  version: 1,
  tier: 'generation',
  maxChars: 2000,
  prompt,
  render: (context) =>
    [`Now: ${context.now}`, context.viewing ? `Last viewed topic: "${context.viewing.title}" in ${context.viewing.channel} (id ${context.viewing.id})` : 'No topic is being viewed.'].join('\n'),
  key: () => '',
})
