import type { Message, MethodArgs } from '@juno/slack-schema'
import { ApiError, requireConversation, type MethodContext, type MethodResult } from '../methods.ts'
import type { Workspace } from '../state.ts'
import type { FakeFeature } from './registry.ts'

/**
 * Ephemeral messages and the buttons on them (research
 * `integration-shapes.md`, "Buttons on a Slackbot message"). An ephemeral
 * message is sent only on the socket and is never in history, so it is kept
 * here, beside the workspace, until a press removes it.
 *
 * `mentionOutsiders` sends Slackbot's note about people mentioned outside
 * the channel, with Add Them, Let Them Know and Dismiss. A press on Add Them
 * adds them and replaces the note with one without buttons; any other press
 * removes it with `message_deleted`, as Dismiss does live. What Slack sends
 * after Add Them and Let Them Know was not recorded; this is a guess.
 */
export const buttonsFeature = {
  methods: {
    'chat.attachmentAction': (ctx, args) => press(ctx, args),
  },
  controls: {
    mentionOutsiders: (fake, input: { channel: string; users: ReadonlyArray<string> }) => mentionOutsiders(fake.workspace, input),
  },
} satisfies FakeFeature

const MENTIONS = 'consistentephemeralmentions'
const ephemerals = new WeakMap<Workspace, Map<string, Message>>()

function kept(ws: Workspace): Map<string, Message> {
  const known = ephemerals.get(ws)
  if (known !== undefined) return known
  const fresh = new Map<string, Message>()
  ephemerals.set(ws, fresh)
  return fresh
}

function mentionOutsiders(ws: Workspace, input: { channel: string; users: ReadonlyArray<string> }): Message {
  const ts = ws.nextTs()
  const names = input.users.map((user) => `<@${user}>`).join(' and ')
  const message: Message = {
    type: 'message',
    subtype: 'bot_message',
    ts,
    user: 'USLACKBOT',
    bot_id: 'B0SLACKBOT',
    username: 'Slackbot',
    is_ephemeral: true,
    text: `You mentioned ${names}, but they’re not in this channel.`,
    attachments: [{
      id: 1,
      fallback: 'Would you like to add them?',
      callback_id: `${MENTIONS}_${input.users.join(',')}_${ts.replace('.', '')}_0`,
      actions: [
        { id: '1', name: 'invite', text: 'Add Them', type: 'button', value: 'invite', style: '' },
        // Not recorded live: the name and value of Let Them Know are invented.
        { id: '2', name: 'send', text: 'Let Them Know', type: 'button', value: 'send', style: '' },
        { id: '3', name: 'ignore', text: 'Dismiss', type: 'button', value: 'ignore', style: '' },
      ],
    }],
  }
  kept(ws).set(`${input.channel}:${ts}`, message)
  ws.emit({ ...message, type: 'message', channel: input.channel, event_ts: ts })
  return message
}

function press(ctx: MethodContext, args: MethodArgs<'chat.attachmentAction'>): MethodResult<'chat.attachmentAction'> {
  const ws = ctx.workspace
  const { payload } = args
  const conversation = requireConversation(ctx, payload.channel_id)
  if (conversation instanceof ApiError) return conversation
  const key = `${payload.channel_id}:${payload.message_ts}`
  const message = kept(ws).get(key)
  const action = payload.actions[0]
  if (message === undefined || !payload.is_ephemeral || action === undefined) return new ApiError('message_not_found')
  const callback = message.attachments?.[0]?.callback_id ?? ''
  if (callback.startsWith(MENTIONS) && action.name === 'invite') {
    const users = (callback.split('_')[1] ?? '').split(',').filter((user) => user !== '')
    for (const user of users) if (!conversation.members.has(user)) ws.join(payload.channel_id, user)
    const replaced: Message = { ...message, text: `${users.map((user) => `<@${user}>`).join(' and ')} joined the channel.`, attachments: [] }
    kept(ws).set(key, replaced)
    ws.emit({ ...replaced, type: 'message', channel: payload.channel_id, event_ts: ws.eventTs() })
    return {}
  }
  kept(ws).delete(key)
  const eventTs = ws.eventTs()
  ws.emit({ type: 'message', subtype: 'message_deleted', channel: payload.channel_id, ts: eventTs, deleted_ts: payload.message_ts, event_ts: eventTs, hidden: true })
  return {}
}
