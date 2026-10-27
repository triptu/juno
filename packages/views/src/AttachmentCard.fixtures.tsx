import type { BodyBlock, BodyInline } from '@juno/contract'
import { defineFixtures, fixture, hueForId } from '@juno/ui'
import { Files } from './FileCard'
import { clip } from './fixtures/media'
import { MessageBody, type MessageBodyProps } from './MessageBody'

const pr: BodyBlock = {
  kind: 'attachment', tint: 'success', title: [{ kind: 'link', url: 'https://example.test/pull/42', text: '#42 Improve cache' }],
  blocks: [{ kind: 'paragraph', children: [{ kind: 'text', text: 'Reuse cached results while the next request completes.' }] }],
  footer: [{ kind: 'text', text: 'Code review · Today at 10:30' }],
}
// As Slack sends them: a bold label, a line break, the value.
const field = (label: string, value: string): BodyInline[] => [{ kind: 'text', text: label, style: { bold: true } }, { kind: 'break' }, { kind: 'text', text: value }]
const fields: BodyBlock = { kind: 'fields', items: [field('Service', 'API'), field('Status', 'Investigating'), field('Region', 'eu-west-1'), field('Started', '10:28')] }
const longText = Array.from({ length: 12 }, (_, i) => `Step ${i + 1}: check the replica lag, then compare the write rate against the last hour before moving on.`).join(' ')
const state = (...blocks: BodyBlock[]) => fixture<MessageBodyProps>({ body: { blocks }, now: 1700000000000, hueOf: hueForId, tabbable: true, onLink: () => {} })

const icon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48"%3E%3Crect width="48" height="48" rx="24" fill="gray"/%3E%3Cpath d="M14 12L34 36M34 12L14 36" stroke="white" stroke-width="3"/%3E%3C/svg%3E'
const previewImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="400"%3E%3Crect width="600" height="400" fill="lightgray"/%3E%3Cpath d="M40 320L160 260L280 290L400 140L560 80" fill="none" stroke="gray" stroke-width="8"/%3E%3C/svg%3E'
const tweet: Extract<BodyBlock, { kind: 'attachment' }> = {
  kind: 'attachment', tint: 'neutral', author: { name: 'Avery Example (@avery_example)', icon },
  title: [{ kind: 'link', url: 'https://example.test/post/1', text: 'Avery Example on X' }],
  blocks: [{ kind: 'paragraph', children: [{ kind: 'text', text: 'Small experiments make the next decision clearer.' }] }],
  footer: [{ kind: 'text', text: 'X · Oct 16 at 10:30' }], footerIcon: icon,
}

// A shared Slack message: the sender, their words once, and where it was posted, as a link to it, with the time.
const sharedDate: BodyInline = { kind: 'date', timestamp: 1792178160, format: '{date_short} at {time}', fallback: '' }
const permalink = 'https://example.slack.com/archives/C0ENG/p1792178160000100'
const sharedWords: Extract<BodyBlock, { kind: 'attachment' }> = {
  kind: 'attachment', tint: 'neutral', author: { name: 'Maya', icon }, title: [],
  blocks: [{ kind: 'paragraph', children: [{ kind: 'text', text: 'Can someone look at the staging deploy before the release goes out?' }] }],
  footer: [sharedDate],
}
const shared: Extract<BodyBlock, { kind: 'attachment' }> = { ...sharedWords, source: { kind: 'public', name: 'eng', url: permalink, thread: false } }
// A shared message of only a video: the card draws it as the message would. Without the file's details, a quiet line names it.
const sharedVideo: BodyBlock = { ...shared, blocks: [{ kind: 'file', id: clip.id, name: clip.name, mimetype: 'video/mp4', width: 1280, height: 720 }] }
const sharedFiles: BodyBlock = { ...shared, blocks: [{ kind: 'file', id: 'F0REC', name: 'Screen Recording 2026-10-19 at 3.17.13 PM.mov', mimetype: 'video/quicktime' }, { kind: 'file', id: 'F0PLAN', name: 'q4-plan.pdf', mimetype: 'application/pdf' }] }
// A place Juno does not know keeps Slack's footer, as the link.
const sharedElsewhere: BodyBlock = { ...sharedWords, footer: [{ kind: 'link', url: permalink, text: 'Thread in Slack conversation' }, { kind: 'text', text: ' · ' }, sharedDate] }

// A /giphy post: the GIF in the box its size gives, then the context line with the app's logo as an icon and the GIF's author.
const gif = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="480" height="270"%3E%3Crect width="480" height="270" fill="lightgray"/%3E%3Ccircle cx="240" cy="135" r="70" fill="gray"/%3E%3C/svg%3E'
const giphy: BodyBlock[] = [
  { kind: 'image', url: gif, alt: 'dancing cat', width: 480, height: 270 },
  { kind: 'context', icons: [{ url: icon, alt: 'app logo' }], children: [{ kind: 'text', text: 'Posted using /giphy | GIF by ' }, { kind: 'link', url: 'https://example.test/studio', text: 'Example Studio' }] },
]

export default defineFixtures(MessageBody, {
  pr: state(pr),
  giphy: fixture<MessageBodyProps>({ ...state(...giphy).props, onOpenImage: () => {} }),
  'x-image': state({ ...tweet, blocks: [...tweet.blocks, { kind: 'image', url: previewImage, alt: 'Experiment results', width: 600, height: 400 }] }),
  'x-text': state(tweet),
  'shared-message': state({ kind: 'paragraph', children: [{ kind: 'text', text: 'Worth a look' }] }, shared),
  'shared-thread-private': state({ ...shared, source: { kind: 'private', name: 'release-war-room', url: `${permalink}?thread_ts=1792178000.000050&cid=C0ENG`, thread: true } }),
  'shared-dm': state({ ...shared, source: { kind: 'im', name: 'Maya Chen', url: permalink, thread: false } }),
  'shared-elsewhere': state(sharedElsewhere),
  'shared-video': fixture<MessageBodyProps>({ ...state(sharedVideo).props, renderFiles: () => <Files files={[clip]} onOpenMedia={() => {}} flush /> }),
  'shared-files-quiet': state(sharedFiles),
  'failed-image': state({ ...tweet, blocks: [...tweet.blocks, { kind: 'image', url: 'data:image/png;base64,AAAA', alt: 'Unavailable preview', width: 1200, height: 630 }] }),
  youtube: state({ ...tweet, author: { name: 'Example Studio', icon }, title: [{ kind: 'link', url: 'https://example.test/watch/demo', text: 'How the demo works' }], blocks: [{ kind: 'image', url: previewImage, alt: 'Demo preview', width: 640, height: 360 }], footer: [{ kind: 'text', text: 'YouTube' }] }),
  generic: state({ ...pr, tint: 'neutral', title: [{ kind: 'link', url: 'https://example.test/article/1', text: 'A useful observation' }], blocks: [{ kind: 'paragraph', children: [{ kind: 'text', text: 'The summary supplied by the page.' }] }, { kind: 'image', url: previewImage, alt: 'Article preview', width: 800, height: 420 }], footer: [{ kind: 'text', text: 'Example Journal' }] }),
  alert: state({ kind: 'attachment', tint: 'danger', title: [{ kind: 'text', text: 'Latency increased' }], blocks: [fields], footer: [{ kind: 'text', text: 'Monitor · Today at 10:32' }] }),
  section: state({ kind: 'paragraph', children: [{ kind: 'text', text: 'Issue updated', style: { bold: true } }] }, fields),
  long: state({ kind: 'attachment', tint: 'info', title: [{ kind: 'text', text: 'Runbook updated' }], blocks: [{ kind: 'paragraph', children: [{ kind: 'text', text: longText }] }], footer: [{ kind: 'text', text: 'Docs · Today at 10:40' }] }),
  image: state({ ...pr, blocks: [{ kind: 'image', url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="400"%3E%3Crect width="600" height="400" fill="lightgray"/%3E%3Cpath d="M40 320L160 260L280 290L400 140L560 80" fill="none" stroke="gray" stroke-width="8"/%3E%3C/svg%3E', alt: 'Synthetic latency chart', width: 600, height: 400 }] }),
}, { width: 520 })
