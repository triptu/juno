import { defineFixtures, fixture } from '@juno/ui'
import { messageId, NOW } from './fixtures/data'
import { RemoveSheet, type RemoveSheetProps } from './RemoveSheet'

const noop = () => {}
const DAY = 86_400_000

const sheet = (props: Pick<RemoveSheetProps, 'sheet'>) => fixture<RemoveSheetProps>({ ...props, now: NOW, onRemove: noop, onKeep: noop })

export default defineFixtures(
  RemoveSheet,
  {
    Sheet: {
      'one-message': sheet({ sheet: { messages: [{ messageId: messageId('m-1'), preview: 'The offsite is on the 22nd, book the room by Friday', at: NOW - 2 * DAY }] } }),
      'with-reply': sheet({
        sheet: {
          messages: [
            { messageId: messageId('m-1'), preview: 'The offsite is on the 22nd, book the room by Friday', at: NOW - 2 * DAY },
            { messageId: messageId('m-2'), preview: 'Actually make that the 23rd', at: NOW - 2 * DAY + 300_000 },
          ],
          offerReply: messageId('m-3'),
        },
      }),
    },
  },
  { width: 640, padded: true, surface: 'subtle' },
)
