import { defineFixtures, fixture } from '@juno/ui'
import { runId } from './fixtures/data'
import { StatusBubble, type StatusBubbleProps } from './StatusBubble'

const bubble = (text?: string) => fixture<StatusBubbleProps>({ item: { _tag: 'status', runId: runId('r1'), ...(text === undefined ? {} : { text }) } })

export default defineFixtures(
  StatusBubble,
  {
    Status: {
      dots: bubble(),
      text: bubble('Reading 3 topics'),
      'long-text': bubble('Looking back through March, April and the first half of May for anything about the offsite room booking'),
      'right-to-left': bubble('קורא 3 נושאים'),
    },
    Interaction: {
      hover: { ...bubble('Reading 3 topics'), frame: { width: 640, padded: true, hover: '[data-chat-status]' } },
    },
  },
  { width: 640, padded: true },
)
