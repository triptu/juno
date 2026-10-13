/**
 * The Juno chat tools (architecture section 10). Shapes only; the assistant
 * runs them. Cards carry a status and nothing is sent without a click.
 */
import type { ChatTool } from '../provider'
import { Type } from '../schema'

export const chatTools: ReadonlyArray<ChatTool> = [
  {
    name: 'list_topics',
    description: 'List recent topics, optionally filtered by channel name or a search query. Returns ids, titles, channels and unread counts.',
    parameters: Type.Object({
      channel: Type.Optional(Type.String({ description: 'Channel name without #, or a person for a DM.' })),
      query: Type.Optional(Type.String({ description: 'Words to match in titles and messages.' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }),
  },
  {
    name: 'read_topic',
    description: 'Read the messages of one topic, newest last.',
    parameters: Type.Object({
      topicId: Type.String(),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    }),
  },
  {
    name: 'list_channels',
    description: 'List the channels and DMs the user is in.',
    parameters: Type.Object({}),
  },
  {
    name: 'show_topics',
    description: 'Show topics as clickable links in the chat.',
    parameters: Type.Object({ topicIds: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }) }),
  },
  {
    name: 'propose_message',
    description: 'Prepare a message card for the user to confirm. It is sent only when they click Send.',
    parameters: Type.Object({
      topicId: Type.String({ description: 'Where it goes: a topic id (a Main topic id for a channel or DM).' }),
      text: Type.String({ minLength: 1 }),
    }),
  },
  {
    name: 'propose_resolve',
    description: 'Prepare a resolve card for one or more topics. They are resolved only when the user confirms.',
    parameters: Type.Object({ topicIds: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }) }),
  },
]
