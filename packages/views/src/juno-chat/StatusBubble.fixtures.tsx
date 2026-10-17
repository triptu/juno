import * as stylex from '@stylexjs/stylex'
import { defineFixtures, fixture } from '@juno/ui'
import { runId } from './fixtures/data'
import { StatusBubble, type StatusBubbleProps } from './StatusBubble'

/**
 * The bubble in a column as wide as the chat's, as the list lays it out: its widest is a share of
 * the row, so a row only as wide as its content would wrap the line early.
 */
function InChat(props: StatusBubbleProps) {
  return (
    <div {...stylex.props(styles.column)}>
      <StatusBubble {...props} />
    </div>
  )
}

const bubble = (text?: string) => fixture<StatusBubbleProps>({ item: { _tag: 'status', runId: runId('r1'), ...(text === undefined ? {} : { text }) } })

export default defineFixtures(
  InChat,
  {
    Status: {
      dots: bubble(),
      text: bubble('Reading 3 topics'),
      'long-text': bubble('Looking back through March, April and the first half of May for anything about the offsite room booking'),
      'right-to-left': bubble('קורא 3 נושאים'),
      // A connection call names the connection and what the tool does, as its card would (SPEC 13.2).
      // Calls in a row swap the line in place: the bubble keeps its height and place.
      'connection-read': bubble('Checking with Littlebird'),
      'connection-search': bubble('Searching Notion'),
      'connection-create': bubble('Creating a page in Notion'),
    },
    Interaction: {
      hover: { ...bubble('Reading 3 topics'), frame: { width: 640, padded: true, hover: '[data-chat-status]' } },
    },
  },
  { width: 640, padded: true },
)

const styles = stylex.create({
  column: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
})
