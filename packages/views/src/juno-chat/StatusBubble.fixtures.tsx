import { useState } from 'react'
import { Button, defineFixtures, fixture, scene } from '@juno/ui'
import { runId } from './fixtures/data'
import { StatusBubble, type StatusBubbleProps } from './StatusBubble'

const bubble = (text?: string) => fixture<StatusBubbleProps>({ item: { _tag: 'status', runId: runId('r1'), ...(text === undefined ? {} : { text }) } })

/** Calls to a connection in a row: the line changes in place, and the bubble does not move. */
const CONNECTION_STEPS = ['Checking with Littlebird', 'Searching Notion', 'Creating a page in Notion']

function ConnectionSteps() {
  const [step, setStep] = useState(0)
  return (
    <>
      <StatusBubble item={{ _tag: 'status', runId: runId('r1'), text: CONNECTION_STEPS[step]! }} />
      <Button variant="secondary" size="sm" onClick={() => setStep((s) => (s + 1) % CONNECTION_STEPS.length)}>
        Next call
      </Button>
    </>
  )
}

export default defineFixtures(
  StatusBubble,
  {
    Status: {
      dots: bubble(),
      text: bubble('Reading 3 topics'),
      'long-text': bubble('Looking back through March, April and the first half of May for anything about the offsite room booking'),
      'right-to-left': bubble('קורא 3 נושאים'),
      // A connection call names the connection and what the tool does, as its card would (SPEC 13.2).
      connection: bubble('Creating a page in Notion'),
      'connection-read': bubble('Checking with Littlebird'),
      'connection-steps': scene(() => <ConnectionSteps />),
    },
    Interaction: {
      hover: { ...bubble('Reading 3 topics'), frame: { width: 640, padded: true, hover: '[data-chat-status]' } },
    },
  },
  { width: 640, padded: true },
)
