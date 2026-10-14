import { useState } from 'react'
import type { Card } from '@juno/agent-contract'
import { Button, defineFixtures, fixture, scene, type FixtureFrame } from '@juno/ui'
import { noopActions } from '../commands'
import {
  budget,
  change,
  connect,
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

const frame = { width: 600, padded: true } as const

export const sendMessageCard = defineFixtures(
  CardFixture,
  {
    'Send message': {
      open: card(sendMessage('s1')),
      'three-messages': card(sendMessage('s2', open, [results.pending, results.pending, results.pending])),
      sending: card(sendMessage('s3', working, [results.sending, results.sending])),
      sent: card(sendMessage('s4', done('Sent'), [results.sent])),
      'sent-three': card(sendMessage('s5', done('Sent 3'), [results.sent, results.sent, results.sent])),
      'sent-one-of-three': card(sendMessage('s6', done('Sent 1 of 3'), [results.sent, results.failed, results.failed])),
      failed: card(sendMessage('s7', failed('Failed'), [results.failed])),
      because: card(sendMessage('s9', open, [results.pending], { because: 'a message from #eng was in this reply' })),
      'may-have-happened': card(sendMessage('s10', mayHaveHappened)),
      dismissed: card(sendMessage('s11', dismissed)),
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
      applied: card(change('c3', done('Applied', { open: { _tag: 'url', url: 'https://notion.example/offsite', label: 'Open' } }))),
      failed: card(change('c4', failed('Failed'))),
    },
  },
  frame,
)

export const removeCard = defineFixtures(
  CardFixture,
  {
    'Remove': {
      open: card(remove('v1')),
      removed: card(remove('v2', done('Removed 2 messages'))),
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

export const chatCard = defineFixtures(
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
