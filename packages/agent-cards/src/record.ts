import { Schema } from 'effect'
import { ChildEvidence, childOutcome, expandChildActions } from './actions'
import { actionDigest, canonicalJson } from './identity'
import { payloadSchemas, SendMessagePayload, TaskPayload } from './payload'
import * as P from './presentation'

const recordBase = {
  id: P.CardId,
  createdAt: Schema.Number,
  sourceValid: Schema.Boolean,
}
const { sendMessage: _sendMessage, task: _task, ...clickPayloads } = payloadSchemas
/** A job's phase as recorded. `unknown`: Juno cannot tell whether it started or still runs (plan v3 §6.5); the card shows it as `failed`. */
export const JobRecordPhase = Schema.Literals([...P.JobPhase.literals, 'unknown'])
export type JobRecordPhase = typeof JobRecordPhase.Type
export const CardRecord = Schema.Union([
  Schema.Struct({ ...recordBase, payload: SendMessagePayload, status: P.CardStatus, children: Schema.Array(ChildEvidence) }).check(
    Schema.makeFilter((record) => {
      const children = expandChildActions(record.payload)
      return new Set(record.children.map((e) => e.id)).size === record.children.length && record.children.every((e) =>
        children.some((child) => child.id === e.id && child.rev === e.rev && actionDigest(child.payload) === e.digest)) || 'Evidence must match the exact child revision and payload'
    })),
  Schema.Struct({ ...recordBase, payload: TaskPayload, job: Schema.Struct({ phase: JobRecordPhase,
    state: Schema.optionalKey(Schema.String), open: Schema.optionalKey(P.OpenTarget) }) }),
  Schema.Struct({ ...recordBase, payload: Schema.Union(Object.values(clickPayloads)), status: P.CardStatus }),
])
export type CardRecord = typeof CardRecord.Type
export const CARD_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

export type CardEvent =
  | { readonly _tag: 'click' }
  | { readonly _tag: 'dismiss' }
  | { readonly _tag: 'expire' }
  | { readonly _tag: 'result'; readonly status: Extract<P.CardStatus, { _tag: 'done' | 'failed' }> }

/**
 * A card runs once: only an `open` card takes a click, and a settled one never does (Quint
 * `noRepeatAuthorization`). Clicks are UI state only. WP15 must validate revision, digest and
 * authority before dispatch.
 */
export function transitionCard(status: P.CardStatus, event: CardEvent): P.CardStatus {
  switch (event._tag) {
    case 'click':
      return status._tag === 'open' ? { _tag: 'working' } : status
    case 'dismiss': return status._tag === 'open' ? { _tag: 'dismissed' } : status
    case 'expire': return status._tag === 'open' ? { _tag: 'expired' } : status
    case 'result':
      // An action shown as failed because Juno could not confirm it turns done on later positive evidence.
      if (status._tag === 'working' || (status._tag === 'failed' && event.status._tag === 'done')) return event.status
      return status
  }
}

/** Decode the returned shape with WP7's Card at the wire boundary. No reverse package dependency. */
export function toCard(record: CardRecord, now: number): P.Card {
  if ('job' in record) {
    const { phase, ...job } = record.job
    return { ...record.payload, id: record.id, ...job, phase: phase === 'unknown' ? 'failed' : phase }
  }
  const p = record.payload
  const base = {
    id: record.id,
    ...(p.because === undefined ? {} : { because: p.because }),
    status: (!record.sourceValid || now >= record.createdAt + CARD_LIFETIME_MS)
      ? transitionCard(record.status, { _tag: 'expire' }) : record.status,
  }
  switch (p._tag) {
    case 'sendMessage': {
      const messages: P.ProposedMessage[] = p.messages.map((m) => {
        const evidence = 'children' in record ? record.children.find((e) => e.id === m.actionId) : undefined
        const outcome = evidence === undefined ? 'pending' : childOutcome(evidence)
        const target: P.OpenTarget = { _tag: 'topic', topicId: m.inTopic?.topicId ?? `m:${m.target.channelId}` }
        const result: P.SendResult = outcome === 'sent' ? { _tag: 'sent', open: target } : { _tag: outcome }
        return { id: m.id, target: m.target, text: m.text, result, ...(m.inTopic ? { inTopic: m.inTopic } : {}) }
      })
      return { ...base, _tag: p._tag, messages,
        status: 'children' in record && record.children.some((e) => e.attempts.length > 0) ? P.sendMessageStatus(messages) : base.status }
    }
    case 'resolve': return { ...base, _tag: p._tag, topics: p.topics }
    case 'topics': return { ...base, _tag: p._tag, links: p.links, status: { _tag: 'open' } }
    case 'proposedTask': return { ...base, _tag: p._tag, kind: p.kind, title: p.title, where: p.where }
    case 'question': return { ...base, _tag: p._tag, asks: p.asks, prompt: p.prompt, options: p.options, freeText: p.freeText }
    case 'proposedSchedule': return { ...base, _tag: p._tag, what: p.what, when: p.when, deliver: p.deliver, prompt: p.prompt }
    case 'schedule': return { ...base, _tag: p._tag, what: p.what, when: p.when, deliver: p.deliver, scheduleId: p.scheduleId }
    case 'connect': return { ...base, _tag: p._tag, server: p.server, scopes: p.scopes, leaves: p.leaves }
    case 'change': {
      const args = p.action.payload.args
      const fields = typeof args === 'object' && args !== null && !Array.isArray(args)
        ? Object.entries(args).toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, value]) => ({ name, after: canonicalJson(value) }))
        : [{ name: 'Arguments', after: canonicalJson(args) }]
      return { ...base, _tag: p._tag, server: p.server, target: p.target,
        fields: (fields.length ? fields : [{ name: 'Arguments', after: '{}' }]).map((field) => ({ ...field, ...(field.after.length > 280 ? { long: true as const } : {}) })),
        ...(p.caption === undefined ? {} : { caption: p.caption }) }
    }
    case 'remove': return { ...base, _tag: p._tag, messages: p.messages, ...(p.offerReply === undefined ? {} : { offerReply: p.offerReply }) }
    case 'budget': return { ...base, _tag: p._tag, spentTodayUsd: p.spentTodayUsd, capUsd: p.capUsd }
    case 'provider': return { ...base, _tag: p._tag, options: p.options }
  }
}

export type JobEvent = 'progress' | 'needsYou' | 'quiet' | 'lostSight' | 'stop' | 'cancelled' | 'done' | 'failed' | 'unknown'
export function transitionJob(phase: JobRecordPhase, event: JobEvent): JobRecordPhase {
  if (phase === 'done' || event === 'done') return 'done'
  if (phase === 'failed' || phase === 'stopped') return phase
  switch (event) {
    case 'progress': return phase === 'stopping' ? phase : 'running'
    case 'stop': return 'stopping'
    case 'cancelled': return 'stopped'
    case 'needsYou': case 'quiet': case 'lostSight': return phase === 'stopping' ? phase : event
    case 'failed': case 'unknown': return event
  }
}

export const unknownCard = (id: typeof P.CardId.Type, kind: string): P.UnknownCard => ({ _tag: 'unknown', id, kind })
