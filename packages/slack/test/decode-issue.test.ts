import { Effect, Schema } from 'effect'
import { expect, it } from 'vitest'
import { Methods, ThreadView } from '@juno/slack-schema'
import { decodeIssueDetails } from '../src/client/decodeIssue.ts'
import { decodeResponse } from '../src/client/api.ts'
import { SlackConfig } from '../src/client/config.ts'

it('a failed Slack decode reports a schema path and issue kind without response values', async () => {
  for (const [body, schemaPath, issueKind] of [
    [{ ok: true, has_more: false, threads: [] }, 'total_unread_replies', 'missing'],
    [{ ok: true, has_more: 'private response', threads: [], total_unread_replies: 0 }, 'has_more', 'wrong_type'],
  ] as const) {
    const result = await Effect.runPromise(Effect.gen(function* () {
      const config = yield* SlackConfig
      return yield* Effect.result(decodeResponse('subscriptions.thread.getView', { status: 200, text: JSON.stringify(body), header: () => undefined }, Methods['subscriptions.thread.getView'].response, config))
    }))
    expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'SlackDecodeError', schemaPath, issueKind } })
    expect(JSON.stringify(result)).not.toContain('private response')
  }
})

it('does not expose record keys, unexpected keys or custom error text', () => {
  const schema = Schema.Record(Schema.String, Schema.Number)
  const result = Schema.decodeUnknownResult(schema)({ private_message: 'private value' })
  expect(result._tag).toBe('Failure')
  if (result._tag === 'Failure') expect(decodeIssueDetails(result.failure.issue)).toEqual({ schemaPath: 'unknown', issueKind: 'wrong_type' })
})

it('reports nested thread paths with array indexes and missing versus wrong type', () => {
  for (const [extra, issueKind] of [[{}, 'missing'], [{ latest_reply: 'private value' }, 'invalid']] as const) {
    const result = Schema.decodeUnknownResult(ThreadView)({ root_msg: { ts: '1700000000.000001', channel: 'C0TEST', thread_ts: '1700000000.000001', reply_count: 1, ...extra } })
    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure') expect(decodeIssueDetails(result.failure.issue, ['threads', 3])).toEqual({ schemaPath: 'threads[3].root_msg.latest_reply', issueKind })
  }
})
