import * as stylex from '@stylexjs/stylex'
import type { FileView } from '@juno/contract'
import { defineFixtures, scene } from '@juno/ui'
import type { MediaFile } from './MediaGrid'
import { album, albumOf } from './fixtures/media'
import { downloadable, image, PENDING_PICTURE, picture } from './fixtures/messages'
import { NOW, people } from './fixtures/topics'
import { MediaViewer, type MediaViewing } from './MediaViewer'
import { MessageList } from './MessageList'

const noop = () => {}

const { download: _download, ...notDownloadable } = downloadable.portrait

const media = (files: ReadonlyArray<FileView>) => files as ReadonlyArray<MediaFile>
/** As the message behind it (`albumOf`) says: its sender and its time. */
const viewing = (items: ReadonlyArray<FileView>, index = 0): MediaViewing => ({ items: media(items), index, sender: people.priya.name, at: NOW - 20 * 60_000 })

/** A video Slack made a poster for; the fixture plays nothing. */
const video: FileView = { ...image('F0VID', 'standup-recording.mp4', 1280, 720, picture(1280, 720, '#7F8FA6')), kind: 'video', mimetype: 'video/mp4' }

/** The viewer over a topic's list. The frame holds the fixed viewer, as the window does in the app. */
function OverList({ open }: { readonly open: MediaViewing }) {
  return (
    <div {...stylex.props(styles.window)}>
      <MessageList items={albumOf(open.items.length)} main={false} now={NOW} onOpenMedia={noop} onDownload={noop} />
      <MediaViewer viewing={open} now={NOW} onClose={noop} onDownload={noop} onOpenFile={noop} onCopyImage={noop} />
    </div>
  )
}

const styles = stylex.create({
  // Paint containment makes this box the fixed viewer's containing block, so it stays in the frame.
  window: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    contain: 'layout paint',
  },
})

export default defineFixtures(
  MediaViewer,
  {
    Open: {
      landscape: scene(() => <OverList open={viewing([downloadable.landscape])} />),
      portrait: scene(() => <OverList open={viewing([downloadable.portrait])} />),
      // The full image has not arrived: the thumbnail fills the same box.
      'full-loading': scene(() => <OverList open={viewing([{ ...downloadable.landscape, full: PENDING_PICTURE }])} />),
      'no-download': scene(() => <OverList open={viewing([notDownloadable])} />),
    },
    Filmstrip: {
      // Four pictures, opened at the third: the strip marks it.
      'at-third': scene(() => <OverList open={viewing(album.slice(0, 4), 2)} />),
      // The first: Previous is off.
      'at-first': scene(() => <OverList open={viewing(album, 0)} />),
      // A video in the strip, shown by its poster.
      'with-video': scene(() => <OverList open={viewing([album[0]!, video, album[2]!], 1)} />),
    },
  },
  { width: 816, height: 600, padded: false },
)
