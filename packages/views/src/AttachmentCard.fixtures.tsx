import type { BodyBlock, BodyInline } from '@juno/contract'
import { defineFixtures, fixture, hueForId } from '@juno/ui'
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

export default defineFixtures(MessageBody, {
  pr: state(pr),
  'x-image': state({ ...tweet, blocks: [...tweet.blocks, { kind: 'image', url: previewImage, alt: 'Experiment results', width: 600, height: 400 }] }),
  'x-text': state(tweet),
  'failed-image': state({ ...tweet, blocks: [...tweet.blocks, { kind: 'image', url: 'data:image/png;base64,AAAA', alt: 'Unavailable preview', width: 1200, height: 630 }] }),
  youtube: state({ ...tweet, author: { name: 'Example Studio', icon }, title: [{ kind: 'link', url: 'https://example.test/watch/demo', text: 'How the demo works' }], blocks: [{ kind: 'image', url: previewImage, alt: 'Demo preview', width: 640, height: 360 }], footer: [{ kind: 'text', text: 'YouTube' }] }),
  generic: state({ ...pr, tint: 'neutral', title: [{ kind: 'link', url: 'https://example.test/article/1', text: 'A useful observation' }], blocks: [{ kind: 'paragraph', children: [{ kind: 'text', text: 'The summary supplied by the page.' }] }, { kind: 'image', url: previewImage, alt: 'Article preview', width: 800, height: 420 }], footer: [{ kind: 'text', text: 'Example Journal' }] }),
  alert: state({ kind: 'attachment', tint: 'danger', title: [{ kind: 'text', text: 'Latency increased' }], blocks: [fields], footer: [{ kind: 'text', text: 'Monitor · Today at 10:32' }] }),
  section: state({ kind: 'paragraph', children: [{ kind: 'text', text: 'Issue updated', style: { bold: true } }] }, fields),
  long: state({ kind: 'attachment', tint: 'info', title: [{ kind: 'text', text: 'Runbook updated' }], blocks: [{ kind: 'paragraph', children: [{ kind: 'text', text: longText }] }], footer: [{ kind: 'text', text: 'Docs · Today at 10:40' }] }),
  image: state({ ...pr, blocks: [{ kind: 'image', url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="400"%3E%3Crect width="600" height="400" fill="lightgray"/%3E%3Cpath d="M40 320L160 260L280 290L400 140L560 80" fill="none" stroke="gray" stroke-width="8"/%3E%3C/svg%3E', alt: 'Synthetic latency chart', width: 600, height: 400 }] }),
}, { width: 520 })
