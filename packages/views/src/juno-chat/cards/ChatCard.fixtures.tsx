import { useState } from 'react'
import type { Card, CardStatus } from '@juno/agent-contract'
import { Button, defineFixtures, fixture, scene, type FixtureFrame } from '@juno/ui'
import { noopActions, type ChatActions } from '../commands'
import {
  budget,
  change,
  connect,
  connectionCall,
  dismissed,
  done,
  expired,
  failed,
  mayHaveHappened,
  NOW,
  open,
  proposedSchedule,
  proposedTask,
  provider,
  question,
  remove,
  resolve,
  results,
  schedule,
  sendMessage,
  task,
  topicsCard,
  unknownCard,
  working,
} from '../fixtures/data'
import { ChangeCard } from './ChangeCard'
import { renderCard } from './index'

/**
 * One card through the registry, as the chat renders it. Each kind is its
 * own fixture set, so the gallery lists them apart and the shift guard
 * shares them between its parts.
 */
function CardFixture({ card }: { readonly card: Card }) {
  return renderCard(card, noopActions, NOW, false)
}

const card = (value: Card, frame?: FixtureFrame) => fixture<{ readonly card: Card }>({ card: value }, frame)

const pr = { _tag: 'url', url: 'https://github.com/example/juno/pull/412', label: 'Open PR 412' } as const
const thread = { _tag: 'url', url: 'https://t3.example/thread/1', label: 'Open' } as const

/** Open, then working, then done: the footer keeps its height through every step. */
function Settles({ make }: { readonly make: (step: 0 | 1 | 2) => Card }) {
  const [step, setStep] = useState<0 | 1 | 2>(0)
  return (
    <>
      <CardFixture card={make(step)} />
      <Button variant="secondary" size="sm" onClick={() => setStep((s) => (s === 2 ? 0 : ((s + 1) as 1 | 2)))}>
        Next step
      </Button>
    </>
  )
}

/**
 * A card that goes working on its first click, as in the app, and logs every
 * action it is sent. The log shows that a working card's buttons send nothing.
 */
function ClickThenWorking({ make }: { readonly make: (status: CardStatus) => Card }) {
  const [status, setStatus] = useState<CardStatus>(open)
  const [log, setLog] = useState<ReadonlyArray<string>>([])
  const actions: ChatActions = {
    ...noopActions,
    onCard: (_id, action) => {
      setLog((entries) => [...entries, action._tag])
      setStatus(working)
    },
  }
  return (
    <>
      {renderCard(make(status), actions, NOW, false)}
      <output hidden data-activation-log="">{log.join(' ')}</output>
    </>
  )
}

const frame = { width: 600, padded: true } as const

const IMPLIED = { rule: 'auto', intent: 'implied', risk: 'reversible', line: "Asked because your message didn't ask for this exact change." } as const
const ALWAYS = { rule: 'always', line: 'Asked because your rule for this tool is Always ask.' } as const
const LONG_LINE = 'Offsite agenda for the Lisbon week, with travel, rooms, the Thursday dinner and who presents what on each of the three days'
const LONG_RESULT = Array.from({ length: 30 }, (_, i) => `row ${i + 1}: event ${1000 + i}, pageview, /pricing`).join('\n')
const PAGE_RESULT = 'page:\n  id: 2f1c9a7e\n  title: Offsite agenda\n  url: https://notion.example/offsite-agenda\ncreated: 2026-10-18'
const SEARCH_RESULT = 'results:\n  • Prefers short messages\n  • Works on the Juno desktop app\n  • Reviews pull requests in the morning\n  • Writes in plain English'

export const sendMessageCard = defineFixtures(
  CardFixture,
  {
    'Send message': {
      open: card(sendMessage('s1')),
      'three-messages': card(sendMessage('s2', open, [results.pending, results.pending, results.pending])),
      approved: card(sendMessage('s13', working, [results.pending, results.pending])),
      sending: card(sendMessage('s3', working, [results.sending, results.sending])),
      sent: card(sendMessage('s4', done('Sent'), [results.sent])),
      'sent-three': card(sendMessage('s5', done('Sent 3'), [results.sent, results.sent, results.sent])),
      'sent-one-of-three': card(sendMessage('s6', done('Sent 1 of 3'), [results.sent, results.failedNotInChannel, results.failed])),
      failed: card(sendMessage('s7', failed('Failed'), [results.failed])),
      'failed-reason': card(sendMessage('s14', failed('Failed'), [results.failedNotInChannel])),
      because: card(sendMessage('s9', open, [results.pending], { because: 'a message from #eng was in this reply' })),
      'may-have-happened': card(sendMessage('s10', mayHaveHappened)),
      dismissed: card(sendMessage('s11', dismissed)),
      // The Juno tab's column at the minimum window (336 beside the sidebar, less 32 on each side): the pill keeps its kind
      // and "in {topic}" moves under it; the kind label and the buttons keep their words.
      'minimum-window': card(sendMessage('s12', open, [results.pending, results.pending, results.pending]), { width: 320, padded: true }),
    },
  },
  frame,
)

export const resolveCard = defineFixtures(
  CardFixture,
  {
    'Resolve': {
      open: card(resolve('r1')),
      one: card(resolve('r2', open, 1)),
      working: card(resolve('r3', working)),
      'click-then-working': scene(() => <ClickThenWorking make={(status) => resolve('r7', status)} />),
      resolved: card(resolve('r4', done('Resolved 2', { undo: true }))),
      expired: card(resolve('r5', expired)),
      'may-have-happened': card(resolve('r6', mayHaveHappened)),
    },
  },
  frame,
)

export const topicsCardSet = defineFixtures(
  CardFixture,
  {
    'Topics': {
      links: card(topicsCard('t1')),
      'link-hover': card(topicsCard('t2'), { width: 600, padded: true, hover: '[data-topic-link]' }),
    },
  },
  frame,
)

export const taskCard = defineFixtures(
  CardFixture,
  {
    'Task': {
      running: card(task('k1', 'running', { state: 'Tests running, 2 of 5', open: thread })),
      'needs-you': card(task('k2', 'needsYou', { state: 'Waiting for your answer', open: thread })),
      'lost-sight': card(task('k4', 'lostSight', { open: thread })),
      stopping: card(task('k5', 'stopping', { open: thread })),
      'stop-failed': card(task('k12', 'running', { stopFailed: true, open: thread })),
      done: card(task('k6', 'done', { open: pr })),
      failed: card(task('k7', 'failed')),
      stopped: card(task('k8', 'stopped')),
      subagent: card(task('k10', 'running', { kind: 'subagent', where: 'Claude Haiku 5.5', state: 'Reading 12 topics' })),
      because: card(task('k11', 'running', { state: 'Tests running', because: 'a report from T3 Code was in this reply' })),
    },
  },
  frame,
)

export const proposedTaskCard = defineFixtures(
  CardFixture,
  {
    'Proposed task': {
      open: card(proposedTask('p1')),
      started: card(proposedTask('p2', done('Started'))),
      failed: card(proposedTask('p3', failed('Failed'))),
    },
  },
  frame,
)

export const questionCard = defineFixtures(
  CardFixture,
  {
    'Question': {
      'juno-asks': card(question('q1', 'juno', false)),
      't3-asks': card(question('q2', 't3', true)),
      'free-text': card(question('q3', 'juno', true)),
      chose: card(question('q4', 'juno', false, done('You chose Keep both'))),
      replied: card(question('q5', 't3', true, done('You replied'))),
    },
  },
  frame,
)

export const scheduleCard = defineFixtures(
  CardFixture,
  {
    'Schedule': {
      open: card(schedule('h1')),
      kept: card(schedule('h2', done('Kept'))),
      paused: card(schedule('h3', done('Paused'))),
      deleted: card(schedule('h4', done('Deleted'))),
    },
  },
  frame,
)

export const proposedScheduleCard = defineFixtures(
  CardFixture,
  {
    'Proposed schedule': {
      open: card(proposedSchedule('g1')),
      started: card(proposedSchedule('g2', done('Started'))),
    },
  },
  frame,
)

export const connectCard = defineFixtures(
  CardFixture,
  {
    'Connect': {
      open: card(connect('n1')),
      connected: card(connect('n2', done('Connected'))),
    },
  },
  frame,
)

export const changeCard = defineFixtures(
  CardFixture,
  {
    'Change': {
      open: card(change('c1')),
      'long-field': card(change('c2', open, true)),
      // Every change that ran says Done, whatever its button said.
      done: card(change('c3', done('Done', { open: { _tag: 'url', url: 'https://notion.example/offsite', label: 'Open' } }))),
      failed: card(change('c4', failed('Failed'))),
      // The auto-review asked (SPEC 13.9): one fixed line says why.
      'asked-delete': card(change('c5', open, false, { rule: 'auto', intent: 'explicit', risk: 'delete', line: "Asked because deleting can't be undone." })),
      'asked-implied': card(change('c6', open, false, { rule: 'auto', intent: 'implied', risk: 'reversible', line: "Asked because your message didn't ask for this exact change." })),
      // A connection call named by what it does, with its verb on the button, and its result once it ran.
      'call-open': card(connectionCall('c7', 'create', open, { rule: 'auto', intent: 'implied', risk: 'reversible', line: "Asked because your message didn't ask for this exact change." })),
      'call-done': card(connectionCall('c8', 'create', done('Done', { detail: 'Offsite agenda', result: PAGE_RESULT }), IMPLIED)),
      'call-failed': card(connectionCall('c9', 'create', failed('Failed', 'Notes are full for this workspace.', 'error: Notes are full for this workspace.\ncode: quota_exceeded'), IMPLIED)),
      // Everything the call gave back, as a person reads it, under "Hide result".
      'call-result-shown': scene(() => <ChangeCard card={connectionCall('c12', 'create', done('Done', { detail: 'Offsite agenda', result: PAGE_RESULT }), IMPLIED)} actions={noopActions} enter={false} resultShown />),
      // A long result line cuts first: Open and Show result stay whole at the end.
      'call-long-line': card(connectionCall('c14', 'create', done('Done', { detail: LONG_LINE, result: PAGE_RESULT, open: { _tag: 'url', url: 'https://notion.example/offsite', label: 'Open' } }), IMPLIED)),
      // A long result shows twelve lines, then its box scrolls.
      'call-result-long': scene(() => <ChangeCard card={connectionCall('c15', 'create', done('Done', { detail: 'Found 30 results', result: LONG_RESULT }), IMPLIED)} actions={noopActions} enter={false} resultShown />),
      // Argument values as a person reads them: strings bare, short lists on one line, the rest as indented lines.
      'call-arguments': card(connectionCall('c13', 'nested', open, IMPLIED)),
      // A read the owner's rule asked about.
      'search-asked': card(connectionCall('c10', 'search', open, ALWAYS)),
      'search-done': card(connectionCall('c11', 'search', done('Done', { detail: 'Found 4 results', result: SEARCH_RESULT }), ALWAYS)),
    },
  },
  frame,
)

export const removeCard = defineFixtures(
  CardFixture,
  {
    'Remove': {
      open: card(remove('v1')),
      working: card(remove('v3', working)),
      'click-then-working': scene(() => <ClickThenWorking make={(status) => remove('v4', status)} />),
      removed: card(remove('v2', done('Removed 2 messages'))),
      interrupted: card(remove('v5', failed('Interrupted · Nothing was removed'))),
    },
  },
  frame,
)

export const budgetCard = defineFixtures(
  CardFixture,
  {
    'Budget': {
      open: card(budget('b1')),
      allowed: card(budget('b2', done('Allowed until midnight'))),
    },
  },
  frame,
)

export const providerCard = defineFixtures(
  CardFixture,
  {
    'Provider': {
      open: card(provider('o1')),
      using: card(provider('o2', done('Using Claude Sonnet 5.5'))),
    },
  },
  frame,
)

export const unknownCardSet = defineFixtures(
  CardFixture,
  {
    'Unknown': {
      'newer-juno': card(unknownCard('u1')),
    },
  },
  frame,
)

const chatCard = defineFixtures(
  CardFixture,
  {
    'Shift': {
      'resolve-settles': scene(() => <Settles make={(step) => resolve('x1', step === 0 ? open : step === 1 ? working : done('Resolved 2', { undo: true }))} />),
      'send-settles': scene(() => <Settles make={(step) => sendMessage('x2', step === 0 ? open : step === 1 ? working : done('Sent 2'), step === 0 ? [results.pending, results.pending] : step === 1 ? [results.sending, results.sending] : [results.sent, results.sent])} />),
      'send-fails': scene(() => <Settles make={(step) => sendMessage('x3', step === 0 ? open : step === 1 ? working : failed('Failed'), step === 0 ? [results.pending] : step === 1 ? [results.sending] : [results.failed])} />),
      'task-state-changes': scene(() => <Settles make={(step) => task('x4', step === 2 ? 'done' : 'running', step === 2 ? { open: pr } : { state: step === 0 ? 'Tests running, 2 of 5' : 'Opening the pull request', open: thread })} />),
      'question-settles': scene(() => <Settles make={(step) => question('x5', 'juno', true, step === 0 ? open : step === 1 ? working : done('You chose Keep both'))} />),
    },
  },
  frame,
)

export default chatCard
