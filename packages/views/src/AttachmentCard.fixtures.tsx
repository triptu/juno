import type { BodyBlock } from '@juno/contract'
import { defineFixtures, fixture, hueForId } from '@juno/ui'
import { MessageBody, type MessageBodyProps } from './MessageBody'

const pr: BodyBlock = {
  kind: 'attachment', tint: 'success', title: [{ kind: 'link', url: 'https://example.test/pull/42', text: '#42 Improve cache' }],
  blocks: [{ kind: 'paragraph', children: [{ kind: 'text', text: 'Reuse cached results while the next request completes.' }] }],
  footer: [{ kind: 'text', text: 'Code review · Today at 10:30' }],
}
const fields: BodyBlock = { kind: 'fields', items: [[{ kind: 'text', text: 'Service\nAPI' }], [{ kind: 'text', text: 'Status\nInvestigating' }]] }
const state = (...blocks: BodyBlock[]) => fixture<MessageBodyProps>({ body: { blocks }, now: 1700000000000, hueOf: hueForId, tabbable: true, onLink: () => {} })

export default defineFixtures(MessageBody, {
  pr: state(pr),
  alert: state({ kind: 'attachment', tint: 'danger', title: [{ kind: 'text', text: 'Latency increased' }], blocks: [fields], footer: [{ kind: 'text', text: 'Monitor · Today at 10:32' }] }),
  section: state({ kind: 'paragraph', children: [{ kind: 'text', text: 'Issue updated', style: { bold: true } }] }, fields),
  image: state({ ...pr, blocks: [{ kind: 'image', url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="400"%3E%3Crect width="600" height="400" fill="lightgray"/%3E%3Cpath d="M40 320L160 260L280 290L400 140L560 80" fill="none" stroke="gray" stroke-width="8"/%3E%3C/svg%3E', alt: 'Synthetic latency chart', width: 600, height: 400 }] }),
}, { width: 520 })
