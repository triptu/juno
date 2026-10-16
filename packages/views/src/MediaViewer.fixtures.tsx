import * as stylex from '@stylexjs/stylex'
import type { FileView } from '@juno/contract'
import { defineFixtures, scene } from '@juno/ui'
import { downloadable, PENDING_PICTURE, withDownloads } from './fixtures/messages'
import { NOW } from './fixtures/topics'
import { ImageViewer } from './ImageViewer'
import { MessageList } from './MessageList'

const noop = () => {}

const { download: _download, ...notDownloadable } = downloadable.portrait

/** The viewer over a topic's list. The frame holds the fixed viewer, as the window does in the app. */
function OverList({ file }: { readonly file: FileView }) {
  return (
    <div {...stylex.props(styles.window)}>
      <MessageList items={withDownloads} main={false} now={NOW} onOpenImage={noop} onDownload={noop} />
      <ImageViewer file={file} onClose={noop} onDownload={noop} />
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
  ImageViewer,
  {
    Open: {
      landscape: scene(() => <OverList file={downloadable.landscape} />),
      portrait: scene(() => <OverList file={downloadable.portrait} />),
      // The full image has not arrived: the thumbnail fills the same box.
      'full-loading': scene(() => <OverList file={{ ...downloadable.landscape, full: PENDING_PICTURE }} />),
      'no-download': scene(() => <OverList file={notDownloadable} />),
    },
  },
  { width: 816, height: 600, padded: false },
)
