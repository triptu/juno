import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import type { PickConversation, PickConversations, PickThread } from '@juno/contract'
import { Composer } from './Composer'
import { DestinationPickers, type PickerName } from './DestinationPickers'
import { thread as postgresThread } from './fixtures/messages'
import { conversations, cutoverThreads, engThreads, jonQuery, noConversations, recentConversations } from './fixtures/newChat'
import { NOW } from './fixtures/topics'
import { MessageList } from './MessageList'
import { NewChat, startOfConversation, type NewChatProps } from './NewChat'

const noop = () => {}

const DRAFT = 'Can we move the cutover to Thursday night? Dev needs one more day on the replica check.'

interface Scene {
  readonly conversation?: PickConversation
  readonly thread?: PickThread
  readonly open?: PickerName
  readonly query?: string
  readonly list?: PickConversations
  readonly threads?: ReadonlyArray<PickThread>
  readonly draft?: string
  readonly preview?: boolean
  readonly note?: string
  readonly sending?: boolean
}

const placeholder = ({ conversation, thread }: Scene) =>
  conversation === undefined ? 'Message' : thread !== undefined ? 'Reply' : conversation.kind === 'public' || conversation.kind === 'private' ? `Message #${conversation.name}` : `Message ${conversation.name}`

const page = (input: Scene, frame?: FixtureFrame) =>
  scene<NewChatProps>(
    () => (
      <NewChat
        {...(input.preview === true ? { preview: <MessageList items={postgresThread.slice(-4)} main={false} now={NOW} onOpenThread={noop} onChannel={noop} onLink={noop} /> } : {})}
        {...(input.note === undefined ? {} : { note: input.note })}
        composer={
          <Composer
            value={input.draft ?? DRAFT}
            onChange={noop}
            onSend={noop}
            placeholder={placeholder(input)}
            sending={input.sending ?? false}
            above={
              <DestinationPickers
                conversation={input.conversation}
                thread={input.thread}
                open={input.open}
                onOpen={noop}
                query={input.query ?? ''}
                onQuery={noop}
                conversations={input.list}
                threads={input.threads}
                now={NOW}
                onPickConversation={noop}
                onPickThread={noop}
              />
            }
          />
        }
      />
    ),
    frame,
  )

export default defineFixtures(
  NewChat,
  {
    Flow: {
      // The composer has focus; nothing above it but one line.
      'write-first': page({}),
      'conversation-list': page({ open: 'conversation', list: recentConversations }),
      // With no conversation the thread list searches recent threads everywhere.
      'thread-first': page({ open: 'thread', query: 'cutover', threads: cutoverThreads(NOW) }),
      'destination-set': page({ conversation: conversations.eng, thread: cutoverThreads(NOW)[0], preview: true }),
      'thread-list': page({ conversation: conversations.eng, open: 'thread', threads: engThreads(NOW), preview: true }),
      // Everyone in the workspace is in the list; someone never messaged says so.
      'person-never-messaged': page({ conversation: conversations.jonas, open: 'conversation', query: 'jon', list: jonQuery, note: startOfConversation('Jonas Weber'), draft: 'Welcome aboard. Your laptop arrives Monday; ping me if anything is blocked.' }),
      sending: page({ conversation: conversations.eng, thread: cutoverThreads(NOW)[0], preview: true, sending: true }),
    },
    Tints: {
      private: page({ conversation: conversations.hiring, preview: true, draft: '' }),
      'direct-message': page({ conversation: conversations.maya, preview: true, draft: '' }),
      'group-dm': page({ conversation: conversations.group, preview: true, draft: '' }),
    },
    Data: {
      'conversations-loading': page({ open: 'conversation', query: 'eng' }),
      'no-match': page({ open: 'conversation', query: 'zzz', list: noConversations }),
      'no-threads': page({ conversation: conversations.sam, open: 'thread', query: 'deploy', threads: [] }),
      'long-names': page({ conversation: conversations.long, thread: engThreads(NOW)[2], preview: true }),
    },
    Window: {
      'minimum-window': page({ conversation: conversations.eng, open: 'thread', threads: engThreads(NOW), preview: true }, { width: 480, height: 480 }),
    },
  },
  { width: 816, height: 640, padded: false },
)
