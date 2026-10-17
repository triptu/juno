import { useState } from 'react'
import type { Banner, ChatItem, Ending } from '@juno/agent-contract'
import { defineFixtures, fixture, scene, type FixtureFrame } from '@juno/ui'
import { noopActions } from './commands'
import { useFixtureControl } from './fixtures/control'
import { bubbles, budget, conversation, day, essay, failedSend, jobs, juno, junoReplies, longText, manyCards, messageId, NOW, owner, ownerReplies, reacted, reactions, richReply, rightToLeft, scheduled, sourced, status, unusualReactions, withNewDivider } from './fixtures/data'
import { JunoChatList, type JunoChatListProps } from './JunoChatList'

const noop = () => {}

const base: Omit<JunoChatListProps, 'items'> = { banner: { _tag: 'none' }, moreAbove: false, moreBelow: false, now: NOW, actions: noopActions, onSuggest: noop, enterEmpty: false }

const list = (items: ReadonlyArray<ChatItem>, overrides: Partial<JunoChatListProps> = {}, frame?: FixtureFrame) => fixture<JunoChatListProps>({ ...base, items, ...overrides }, frame)

const MINUTE = 60_000

const ask = (id: string, t: string, delivery: Parameters<typeof owner>[3]) => [day(0), owner(id, t, 'single', delivery, NOW - MINUTE)]

const reply = (id: string, ending: Ending, body = 'The plan is in the thread, and Maya asked for a reviewer. I started looking at the') => [
  day(0),
  owner(`${id}-q`, 'What did I miss in #eng?', 'single', { _tag: 'sent' }, NOW - 2 * MINUTE),
  ...juno(id, body, { ending, at: NOW - MINUTE }),
]

/**
 * A bubble arrives whole while the dots wait under the newest one. The new
 * bubble is a new row above the status bubble, so it moves the list's end;
 * the test drives it through `window.__fixtureControls.bubble` and checks
 * the rows above.
 */
function BubbleArrives() {
  const [count, setCount] = useState(1)
  useFixtureControl('bubble', () => setCount((n) => Math.min(n + 1, 3)))
  const lines = ['Two things in #eng this morning.', 'Maya posted the Postgres 16 migration plan and asked for a reviewer.', 'And the CI flake on the sidebar test is back.']
  const items: ReadonlyArray<ChatItem> = [
    ...ask('m-b', 'What did I miss in #eng?', { _tag: 'sent' }),
    ...lines.slice(0, count).flatMap((line, i) => juno(`m-b-${i}`, line, { group: count === 1 ? 'single' : i === 0 ? 'first' : i === count - 1 ? 'last' : 'middle', at: NOW })),
    status('m-b', 'Reading the thread'),
  ]
  return <JunoChatList {...base} items={items} />
}

/** A reaction lands on a bubble and on an owner message, and leaves again. Out of flow: nothing may move. Driven as above. */
function ReactionArrives() {
  const [on, setOn] = useState(false)
  useFixtureControl('reaction', () => setOn((v) => !v))
  const items: ReadonlyArray<ChatItem> = [
    day(0),
    owner('m-r', 'thanks!', 'single', { _tag: 'sent' }, NOW - 2 * MINUTE, { reactions: on ? [reacted('juno', '👍')] : [] }),
    ...juno('m-r-1', 'The plan is in the thread.', { at: NOW - MINUTE, reactions: on ? [reacted('owner', '🎉')] : [] }),
  ]
  return <JunoChatList {...base} items={items} />
}

/** The status bubble's text changes: the dots stay put and the bubble keeps its height. Driven as above. */
function StatusTextChanges() {
  const [step, setStep] = useState(0)
  const texts = [undefined, 'Reading 3 topics', 'Looking back through March', 'Reading 3 topics and looking back through March for the room booking']
  useFixtureControl('status-text', () => setStep((n) => (n + 1) % texts.length))
  const items: ReadonlyArray<ChatItem> = [...ask('m-u', 'Find the room booking', { _tag: 'sent' }), status('m-u', texts[step])]
  return <JunoChatList {...base} items={items} />
}

/** The same bubbles with their sources as links and as plain words: a source is styled text in the line, so the swap moves nothing. Driven as above. */
function SourcesLink() {
  const [linked, setLinked] = useState(false)
  useFixtureControl('sources', () => setLinked((v) => !v))
  return <JunoChatList {...base} items={sourced(linked)} />
}

/** The chat ends with the AI-off line only when the banner says so. Driven as above. */
function BannerToAiOff() {
  const [banner, setBanner] = useState<Banner>({ _tag: 'none' })
  useFixtureControl('ai', () => setBanner((b) => (b._tag === 'none' ? { _tag: 'aiOff' } : { _tag: 'none' })))
  return <JunoChatList {...base} items={conversation} banner={banner} />
}

const frame: FixtureFrame = { width: 816, height: 640, padded: false }

export default defineFixtures(
  JunoChatList,
  {
    Chat: {
      conversation: list(conversation),
      // The Juno tab at the minimum window with the sidebar shown.
      'minimum-window': list(conversation, {}, { width: 336, height: 436, padded: false }),
      empty: list([]),
      'new-divider': list(withNewDivider),
      'scheduled-group': list(scheduled),
      'jobs-group': list(jobs),
      'more-above': list(conversation, { moreAbove: true }),
    },
    Working: {
      'status-dots': list([...ask('m-w1', 'Catch me up on today', { _tag: 'sent' }), status('m-w1')]),
      'status-text': list([...ask('m-w2', 'Catch me up on today', { _tag: 'sent' }), status('m-w2', 'Reading 3 topics')]),
      'bubbles-then-dots': list(bubbles),
      'sent-while-working': list([...ask('m-w5', 'Catch me up on today', { _tag: 'sent' }), ...juno('m-w5-r', 'Two things in #eng this morning.', { at: NOW }), owner('m-w6', 'Also check #hiring', 'single', { _tag: 'sent' }, NOW), status('m-w5', 'Reading 3 topics')]),
      'nothing-marked': list([...ask('m-w7', 'ok, thanks', { _tag: 'sent' }), status('m-w7')]),
    },
    Delivery: {
      'waiting-network': list(ask('m-d1', 'Catch me up on today', { _tag: 'waiting', for: 'network' }), { banner: { _tag: 'offline' } }),
      'waiting-resume': list(ask('m-d2', 'Catch me up on today', { _tag: 'waiting', for: 'resume' }), { banner: { _tag: 'paused' } }),
      'waiting-review': list(ask('m-d3', 'Catch me up on today', { _tag: 'waiting', for: 'review' }), { banner: { _tag: 'recovery', pending: 2 } }),
      'not-delivered': list(ask('m-d4', 'Catch me up on today', { _tag: 'failed', reason: 'notDelivered' })),
      'too-long': list(ask('m-d5', 'Here is the whole document pasted in, all of it, every section and every appendix.', { _tag: 'failed', reason: 'tooLong' })),
    },
    Endings: {
      interrupted: list(reply('m-e2', { _tag: 'interrupted', retry: 'op-m-e2-q' as never })),
      'interrupted-no-retry': list(reply('m-e3', { _tag: 'interrupted' })),
      'failed-provider': list(reply('m-e4', { _tag: 'failed', reason: 'provider', retry: 'op-m-e4-q' as never }, '')),
      'failed-key-rejected': list(reply('m-e5', { _tag: 'failed', reason: 'keyRejected', retry: 'op-m-e5-q' as never }, '')),
      'failed-codex-signed-out': list(reply('m-e6', { _tag: 'failed', reason: 'codexSignedOut', retry: 'op-m-e6-q' as never }, '')),
      'failed-offline': list(reply('m-e7', { _tag: 'failed', reason: 'offline', retry: 'op-m-e7-q' as never }, '')),
      'blocked-too-large': list(reply('m-e8', { _tag: 'blocked', reason: 'tooLarge' }, '')),
      'blocked-budget': list([...reply('m-e9', { _tag: 'blocked', reason: 'budget' }, 'Here is the first half of the summary. Maya posted the migration plan and'), ...juno('m-e9-b', '', { cards: [budget('c-e9')], at: NOW })]),
    },
    Notes: {
      'remembered-undo': list([day(0), owner('m-n1', 'Remember that the offsite is on the 23rd', 'single', { _tag: 'sent' }, NOW - MINUTE), { _tag: 'note', id: messageId('m-n1-n'), kind: 'remembered', text: 'The offsite is on the 23rd', undo: true }]),
      remembered: list([day(0), owner('m-n2', 'Remember that the offsite is on the 23rd', 'single', { _tag: 'sent' }, NOW - MINUTE), { _tag: 'note', id: messageId('m-n2-n'), kind: 'remembered', text: 'The offsite is on the 23rd' }]),
      removed: list([day(0), owner('m-n3', 'What did I miss?', 'single', { _tag: 'sent' }, NOW - 3 * MINUTE), { _tag: 'note', id: messageId('m-n3-n'), kind: 'removed' }, ...juno('m-n3-r', 'Two things in #eng this morning.', { at: NOW - MINUTE })]),
      'secret-blocked': list([day(0), owner('m-n4', 'Post the deploy key to #eng', 'single', { _tag: 'sent' }, NOW - MINUTE), { _tag: 'note', id: messageId('m-n4-n'), kind: 'secretBlocked' }, ...juno('m-n4-r', 'I will not post a key anywhere. If you want the deploy to run, tell me which job and I can start it.', { at: NOW })]),
    },
    Hostile: {
      'long-text': list(longText),
      'right-to-left': list(rightToLeft),
      'many-cards': list(manyCards, {}, { ...frame, height: 880 }),
      'failed-send': list(failedSend),
      essay: list(essay, {}, { ...frame, height: 880 }),
    },
    Sources: {
      linked: list(sourced(true)),
      hover: list(sourced(true), {}, { ...frame, hover: '[data-source]' }),
    },
    Formatting: {
      'rich-text': list(richReply, {}, { ...frame, height: 880 }),
      'rich-text-hover': list(richReply, {}, { ...frame, height: 880, hover: '[data-source]' }),
    },
    Reactions: {
      'both-ways': list(reactions),
      'unusual-emoji': list(unusualReactions),
    },
    Replies: {
      'owner-replies': list(ownerReplies),
      'juno-replies': list(junoReplies),
      'narrow-quote': list(ownerReplies, {}, { width: 336, height: 640, padded: false }),
    },
    States: {
      'ai-off': list(conversation, { banner: { _tag: 'aiOff' } }),
      // AI assist off before the first message: the one line, with no suggestions.
      'ai-off-empty': list([], { banner: { _tag: 'aiOff' } }),
      'citation-hover': list(conversation, {}, { ...frame, hover: '[data-cite]' }),
      'bubble-hover': list(conversation, {}, { ...frame, hover: '[data-chat-owner="op-m-2"] p' }),
    },
    Shift: {
      'bubble-arrives': scene(() => <BubbleArrives />),
      'reaction-arrives': scene(() => <ReactionArrives />),
      'status-text-changes': scene(() => <StatusTextChanges />),
      'banner-ai-off': scene(() => <BannerToAiOff />),
      'sources-link': scene(() => <SourcesLink />),
    },
  },
  frame,
)
