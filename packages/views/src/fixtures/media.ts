/**
 * A message's several pictures, for its grid (MessageList, Media) and the
 * media viewer's filmstrip. Split from `messages.ts`.
 */
import type { FileView } from '@juno/contract'
import { downloadable, downloadUrl, image, picture, window } from './messages'
import { people } from './topics'

/** Six pictures of different shapes, Slack's copies with full images: a message's grid and the viewer's filmstrip. */
export const album: ReadonlyArray<FileView> = [
  { ...image('F0AL1', 'rack-front.png', 1600, 1000, picture(1600, 1000, '#8EB5C9')), full: picture(1600, 1000, '#8EB5C9'), download: downloadUrl('F0AL1') },
  { ...image('F0AL2', 'rack-back.jpg', 900, 1400, picture(900, 1400, '#C9A98E')), full: picture(900, 1400, '#C9A98E'), download: downloadUrl('F0AL2') },
  { ...image('F0AL3', 'cable-map.png', 1200, 1200, picture(1200, 1200, '#A7B8A0')), full: picture(1200, 1200, '#A7B8A0'), download: downloadUrl('F0AL3') },
  { ...image('F0AL4', 'patch-panel.png', 2000, 900, picture(2000, 900, '#D9C7E8')), full: picture(2000, 900, '#D9C7E8'), download: downloadUrl('F0AL4') },
  { ...image('F0AL5', 'label-maker.jpg', 1000, 1300, picture(1000, 1300, '#E8D9C7')), full: picture(1000, 1300, '#E8D9C7'), download: downloadUrl('F0AL5') },
  { ...image('F0AL6', 'floor-plan.png', 1500, 1000, picture(1500, 1000, '#B9C7D9')), full: picture(1500, 1000, '#B9C7D9'), download: downloadUrl('F0AL6') },
]

/** A message with the first `count` pictures of the album. */
export const albumOf = (count: number) => window([{ ago: 20, from: people.priya, text: 'Photos from the rack move.', files: album.slice(0, count) }])

/** Pictures and a PDF: the pictures make the grid, the PDF keeps its card. */
export const mediaAndPdf = window([{ ago: 20, from: people.priya, text: 'Photos and the cabling plan.', files: [album[0]!, downloadable.pdf, album[1]!, album[2]!] }])

/**
 * A video Slack made a poster for: the player shows the poster until Play.
 * The gallery plays nothing; `preload="none"` fetches only the poster.
 */
export const clip: FileView = {
  ...image('F0CLIP', 'standup-recording.mp4', 1280, 720, picture(1280, 720, '#7F8FA6')),
  kind: 'video',
  mimetype: 'video/mp4',
  video: '/__fixture/standup-recording.mp4',
  download: downloadUrl('F0CLIP'),
}

/** One picture, one video, and pictures with a video, each a message of its own. */
export const singleImage = window([{ ago: 20, from: people.priya, text: 'The new floor plan.', files: [album[0]!] }])
export const singleVideo = window([{ ago: 20, from: people.priya, text: 'Recording of the stand-up.', files: [clip] }])
export const mixedMedia = window([{ ago: 20, from: people.priya, text: 'Photos and the walkthrough.', files: [album[0]!, clip, album[2]!] }])


/** Files the viewer opens from their cards (SPEC section 8, "Other files"). The gallery serves no content, so `documentText` stands in for it. */
export const documents = {
  markdown: { id: 'F0NOTES', name: 'release-notes.md', kind: 'text', textKind: 'markdown', mimetype: 'text/plain', size: 1_200, lines: 24, content: 'fixture:markdown', download: downloadUrl('F0NOTES') },
  csv: { id: 'F0CSV', name: 'cluster-metrics.csv', kind: 'text', textKind: 'csv', mimetype: 'text/csv', size: 18_400, content: 'fixture:csv', download: downloadUrl('F0CSV') },
  code: { id: 'F0PY', name: 'rotate_keys.py', kind: 'text', textKind: 'code', language: 'Python', mimetype: 'text/plain', size: 640, lines: 18, content: 'fixture:code', download: downloadUrl('F0PY') },
  log: { id: 'F0LOG', name: 'deploy.log', kind: 'text', textKind: 'plain', mimetype: 'text/plain', size: 160_000, content: 'fixture:log', download: downloadUrl('F0LOG') },
  html: { id: 'F0HTML', name: 'weekly-digest.html', kind: 'html', mimetype: 'text/html', size: 2_400, content: 'data:text/html,<body style="font-family:Georgia;padding:24px"><h1>Weekly digest</h1><p>Queue latency is back under 200 ms.</p></body>', download: downloadUrl('F0HTML') },
  audio: { id: 'F0AUDIO', name: 'standup-recording.wav', kind: 'audio', mimetype: 'audio/wav', size: 2_400_000, durationMs: 300_000, audio: '/__fixture/standup-recording.wav', download: downloadUrl('F0AUDIO') },
  zip: { id: 'F0ZIP', name: 'build-logs.zip', kind: 'file', mimetype: 'application/zip', size: 4_100, download: downloadUrl('F0ZIP') },
} satisfies Record<string, FileView>

const DOCUMENT_TEXT: Readonly<Record<string, string>> = {
  'fixture:markdown': '# Release 4.2\n\nShips on **Monday**. The plan is in [the tracker](https://example.com).\n\n## What changes\n\n- Search reads the local index first\n- Threads keep their scroll position\n- [x] Offline drafts survive a restart\n\n```sh\ndeploy rollback --to 4.1.3\n```\n\n> Tell the support channel before you roll back.\n',
  'fixture:csv': [Array.from({ length: 40 }, (_, c) => (c === 0 ? 'host' : `metric_${String(c).padStart(2, '0')}`)).join(','), ...Array.from({ length: 60 }, (_, r) => Array.from({ length: 40 }, (_, c) => (c === 0 ? `node-${r + 1}` : String(((r + 1) * (c + 3) * 37) % 1000))).join(','))].join('\n'),
  'fixture:code': 'import os\n\n\ndef rotate(keys, days=30):\n    """Rotate keys older than `days`."""\n    for key in keys:\n        if key.age_days > days:\n            key.rotate()\n    return len(keys)\n',
  'fixture:log': Array.from({ length: 400 }, (_, n) => `2026-10-20T09:${String(Math.floor(n / 20) % 60).padStart(2, '0')}:${String((n * 3) % 60).padStart(2, '0')}Z INFO  deploy[4101] step ${n + 1}: health check passed on /healthz after a slow start of the worker pool`).join('\n'),
}

/** The text behind a fixture document's `content`, as the container would read it. */
export const documentText = (url: string) => Promise.resolve(DOCUMENT_TEXT[url] === undefined ? undefined : { text: DOCUMENT_TEXT[url], truncated: false })

/** One message with a file of each kind the viewer opens, and a zip with Quick Look. */
export const withDocuments = window([{ ago: 20, from: people.priya, text: 'Notes, metrics, the script, the digest and the build logs.', files: [documents.markdown, documents.csv, documents.code, documents.html, documents.zip] }])
/** A lone audio file: a player in its card. */
export const singleAudio = window([{ ago: 20, from: people.priya, text: 'Recording of the stand-up.', files: [documents.audio] }])
